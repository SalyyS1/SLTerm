// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Lightweight Rem Aqua Anime Ambient Backdrop for SLTerm.
// Renders delicate drifting 6-point ice crystals, soft aqua bokeh orbs, and
// Rem-ribbon sakura-pink petals at z-index 0 with pointer-events: none.
// Auto-pauses when window is hidden or prefers-reduced-motion is enabled (<1% CPU).

import * as React from "react";

export type RemFxMode = "calm" | "dreamy" | "off";
export type RemThemeName = "rem-aqua" | "rem-twilight" | "glacier-mist";

const STORAGE_KEY = "slterm-rem-fx";
const EVENT_NAME = "slterm:rem-fx-change";
const THEME_KEY = "slterm-rem-theme";
const THEME_EVENT = "slterm:rem-theme-change";

export function getRemTheme(): RemThemeName {
    try {
        const s = localStorage.getItem(THEME_KEY);
        if (s === "rem-aqua" || s === "rem-twilight" || s === "glacier-mist") {
            return s;
        }
    } catch {
        // ignore storage errors
    }
    return "rem-aqua";
}

export function setRemTheme(theme: RemThemeName): void {
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch {
        // ignore
    }
    if (typeof document !== "undefined") {
        document.documentElement.dataset.remTheme = theme;
    }
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}

export function cycleRemTheme(): RemThemeName {
    const order: RemThemeName[] = ["rem-aqua", "rem-twilight", "glacier-mist"];
    const cur = getRemTheme();
    const next = order[(order.indexOf(cur) + 1) % order.length];
    setRemTheme(next);
    return next;
}

export function getRemFxMode(): RemFxMode {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "calm" || stored === "dreamy" || stored === "off") {
            return stored;
        }
    } catch {
        // ignore storage restrictions
    }
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        return "off";
    }
    return "calm";
}

export function setRemFxMode(mode: RemFxMode): void {
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // ignore storage restrictions
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: mode }));
}

export function cycleRemFxMode(): RemFxMode {
    const order: RemFxMode[] = ["calm", "dreamy", "off"];
    const cur = getRemFxMode();
    const next = order[(order.indexOf(cur) + 1) % order.length];
    setRemFxMode(next);
    return next;
}

interface Particle {
    kind: "orb" | "crystal" | "petal";
    x: number;
    y: number;
    r: number;
    vx: number;
    vy: number;
    rot: number;
    vrot: number;
    phase: number;
    alpha: number;
}

function makeParticle(w: number, h: number, randomY: boolean): Particle {
    const roll = Math.random();
    const kind: Particle["kind"] = roll < 0.45 ? "orb" : roll < 0.83 ? "crystal" : "petal";
    return {
        kind,
        x: Math.random() * (w || 1280),
        y: randomY ? Math.random() * (h || 800) : -20 - Math.random() * 50,
        r: kind === "orb" ? 6 + Math.random() * 16 : kind === "crystal" ? 3 + Math.random() * 5 : 3.5 + Math.random() * 4,
        vx: (Math.random() - 0.5) * 0.24,
        vy: 0.14 + Math.random() * 0.3,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.01,
        phase: Math.random() * Math.PI * 2,
        alpha: kind === "orb" ? 0.045 + Math.random() * 0.065 : 0.14 + Math.random() * 0.22,
    };
}

export const RemAmbientBackdrop: React.FC = () => {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const [mode, setMode] = React.useState<RemFxMode>(() => getRemFxMode());
    const [theme, setTheme] = React.useState<RemThemeName>(() => getRemTheme());

    React.useEffect(() => {
        document.documentElement.dataset.remTheme = theme;
    }, [theme]);

    React.useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<RemFxMode>).detail;
            if (detail === "calm" || detail === "dreamy" || detail === "off") {
                setMode(detail);
            }
        };
        const onTheme = (e: Event) => {
            const detail = (e as CustomEvent<RemThemeName>).detail;
            if (detail === "rem-aqua" || detail === "rem-twilight" || detail === "glacier-mist") {
                setTheme(detail);
            }
        };
        window.addEventListener(EVENT_NAME, handler);
        window.addEventListener(THEME_EVENT, onTheme);
        return () => {
            window.removeEventListener(EVENT_NAME, handler);
            window.removeEventListener(THEME_EVENT, onTheme);
        };
    }, []);

    React.useEffect(() => {
        if (mode === "off") {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }

        let w = window.innerWidth;
        let h = window.innerHeight;
        let rafId = 0;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener("resize", resize);

        const count = mode === "dreamy" ? 38 : 20;
        const particles: Particle[] = [];
        for (let i = 0; i < count; i++) {
            particles.push(makeParticle(w, h, true));
        }

        const tick = (ts: number) => {
            rafId = window.requestAnimationFrame(tick);
            if (document.hidden) {
                return;
            }
            ctx.clearRect(0, 0, w, h);
            const t = ts * 0.00045;
            const boost = mode === "dreamy" ? 1.25 : 1;

            for (const p of particles) {
                p.y += p.vy;
                p.x += p.vx + Math.sin(t + p.phase) * 0.2;
                p.rot += p.vrot;
                if (p.y > h + 24) {
                    p.y = -18;
                    p.x = Math.random() * w;
                }
                if (p.x < -24) p.x = w + 18;
                if (p.x > w + 24) p.x = -18;

                const twinkle = 0.78 + 0.22 * Math.sin(t * 2 + p.phase);
                const a = p.alpha * twinkle * boost;
                if (p.kind === "orb") {
                    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
                    g.addColorStop(0, `rgba(95, 212, 244, ${a.toFixed(3)})`);
                    g.addColorStop(1, "rgba(95, 212, 244, 0)");
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                    ctx.fill();
                } else if (p.kind === "crystal") {
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.rot);
                    ctx.strokeStyle = `rgba(95, 212, 244, ${a.toFixed(3)})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    for (let i = 0; i < 3; i++) {
                        const ang = (i * Math.PI) / 3;
                        ctx.moveTo(-Math.cos(ang) * p.r, -Math.sin(ang) * p.r);
                        ctx.lineTo(Math.cos(ang) * p.r, Math.sin(ang) * p.r);
                    }
                    ctx.stroke();
                    ctx.restore();
                } else {
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.rot);
                    ctx.fillStyle = `rgba(244, 143, 177, ${(a * 0.85).toFixed(3)})`;
                    ctx.beginPath();
                    ctx.ellipse(0, 0, p.r * 1.15, p.r * 0.52, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
            }
        };

        rafId = window.requestAnimationFrame(tick);
        return () => {
            window.cancelAnimationFrame(rafId);
            window.removeEventListener("resize", resize);
        };
    }, [mode]);

    if (mode === "off") {
        return null;
    }

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            style={{
                position: "fixed",
                inset: 0,
                width: "100vw",
                height: "100vh",
                pointerEvents: "none",
                zIndex: 0,
            }}
        />
    );
};
