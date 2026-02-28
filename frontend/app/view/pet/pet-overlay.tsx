// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/store/global";
import * as jotai from "jotai";
import * as React from "react";
import { getBehaviorDuration, pickRandomBehavior } from "./pet-behaviors";
import { petController } from "./pet-controller";
import {
    DEFAULT_CATALOGUE,
    droppedFoodAtom,
    FOOD_SHOP,
    isGrabbedAtom,
    isHoveringPetAtom,
    petBehaviorAtom,
    petCoinsAtom,
    petEdgeAtom,
    petEnabledAtom,
    petInstanceAtom,
    petPositionAtom,
    petSizeAtom,
    speechBubbleAtom,
    type DroppedFood,
} from "./pet-model";
import "./pet-overlay.scss";
import type { PetBehavior, PetMood, PetPosition } from "./pet-types";

// ============================================================
// Sprite URLs
// ============================================================
const SHOWDOWN_ANI = "https://play.pokemonshowdown.com/sprites/ani";
const SHOWDOWN_SHINY = "https://play.pokemonshowdown.com/sprites/ani-shiny";
const POKESPRITE_STATIC = "https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/regular";

// ============================================================
// Terminal reactions — 8 second COOLDOWN
// ============================================================
const TERMINAL_REACTIONS: Array<{ pattern: RegExp; reaction: () => string }> = [
    { pattern: /git pus\b/i, reaction: () => "git push cơ ba ơi!" },
    { pattern: /git pul\b/i, reaction: () => "git pull chứ boss!" },
    { pattern: /git comit/i, reaction: () => "commit chứ comit gì vậy!" },
    { pattern: /command not found/i, reaction: () => "Bịa lệnh hả boss?" },
    { pattern: /permission denied/i, reaction: () => "Bị chặn rồi! sudo đi~" },
    { pattern: /No such file/i, reaction: () => "File đâu mất rồi?" },
    { pattern: /not recognized/i, reaction: () => "Máy tính không hiểu!" },
    { pattern: /error|Error|ERROR/, reaction: () => "Lỗi kìa! Bình tĩnh nha~" },
    { pattern: /npm install/i, reaction: () => "Cài package... chờ 84 năm!" },
    { pattern: /success|Done!|completed/i, reaction: () => "Thành công! Giỏi quá boss!" },
    { pattern: /warning|WARN/i, reaction: () => "Warning nè, coi chừng!" },
    { pattern: /rm -rf/i, reaction: () => "KHOAN! Boss điên à?!" },
    { pattern: /npm ERR!/i, reaction: () => "npm nổ! Xóa node_modules đi!" },
    { pattern: /fatal:/i, reaction: () => "FATAL! Nhưng sửa được mà~" },
    { pattern: /exit/i, reaction: () => "Đi đâu vậy boss?" },
];

let lastReactionTime = 0;
const REACTION_COOLDOWN_MS = 8000;

function tryReact(text: string): void {
    const now = Date.now();
    if (now - lastReactionTime < REACTION_COOLDOWN_MS) return;
    for (const { pattern, reaction } of TERMINAL_REACTIONS) {
        if (pattern.test(text)) {
            lastReactionTime = now;
            petController.showTerminalReaction(reaction());
            return;
        }
    }
}

// ============================================================
// PetOverlay — with throw physics & food drops
// ============================================================
const PetOverlay: React.FC = () => {
    const petEnabled = jotai.useAtomValue(petEnabledAtom);
    const petInstance = jotai.useAtomValue(petInstanceAtom);
    const [position, setPosition] = jotai.useAtom(petPositionAtom);
    const [behavior, setBehavior] = jotai.useAtom(petBehaviorAtom);
    const speechBubble = jotai.useAtomValue(speechBubbleAtom);
    const [isGrabbed, setIsGrabbed] = jotai.useAtom(isGrabbedAtom);
    const [, setIsHovering] = jotai.useAtom(isHoveringPetAtom);
    const petSize = jotai.useAtomValue(petSizeAtom);
    const petEdge = jotai.useAtomValue(petEdgeAtom);
    const [droppedFood, setDroppedFood] = jotai.useAtom(droppedFoodAtom);
    const [isPetted, setIsPetted] = React.useState(false);

    const containerRef = React.useRef<HTMLDivElement>(null);
    const animFrameRef = React.useRef<number>(0);
    const lastTimeRef = React.useRef<number>(0);
    const behaviorTimerRef = React.useRef<number>(0);
    const behaviorDurationRef = React.useRef<number>(3000);
    const behaviorRef = React.useRef<PetBehavior>(behavior);
    const grabOffsetRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    // Track mouse velocity for THROW physics
    const lastMouseRef = React.useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });
    const throwVelocityRef = React.useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });

    React.useEffect(() => {
        behaviorRef.current = behavior;
    }, [behavior]);

    // Start pet controller
    React.useEffect(() => {
        if (petEnabled) petController.start();
        return () => petController.stop();
    }, [petEnabled]);

    // Coin generator
    React.useEffect(() => {
        if (!petEnabled) return;
        const t = setInterval(() => {
            try {
                const c = globalStore.get(petCoinsAtom);
                globalStore.set(petCoinsAtom, c + 1);
            } catch (_) {
                /* */
            }
        }, 60000);
        return () => clearInterval(t);
    }, [petEnabled]);

    // Terminal watching — THROTTLED to avoid perf issues during high-throughput AI output
    // MutationObserver fires for every DOM change xterm.js makes; we batch and sample
    React.useEffect(() => {
        if (!petEnabled) return;
        let pendingText: string | null = null;
        let throttleTimer: ReturnType<typeof setTimeout> | null = null;
        const THROTTLE_MS = 500; // only check terminal output every 500ms

        const observer = new MutationObserver((mutations) => {
            // Just capture the last added text node — don't process immediately
            for (let i = mutations.length - 1; i >= 0; i--) {
                const m = mutations[i];
                for (let j = m.addedNodes.length - 1; j >= 0; j--) {
                    const node = m.addedNodes[j];
                    if (!(node instanceof HTMLElement)) continue;
                    const text = node.textContent || "";
                    if (text.length >= 3 && text.length <= 500) {
                        pendingText = text;
                        // Schedule throttled processing
                        if (!throttleTimer) {
                            throttleTimer = setTimeout(() => {
                                throttleTimer = null;
                                if (pendingText) {
                                    tryReact(pendingText);
                                    pendingText = null;
                                }
                            }, THROTTLE_MS);
                        }
                        return;
                    }
                }
            }
        });
        const watch = () => {
            document.querySelectorAll(".xterm-rows").forEach((el) => {
                observer.observe(el, { childList: true }); // removed subtree:true — only direct children
            });
        };
        watch();
        const r = setInterval(watch, 10000); // reduced re-watch frequency from 5s to 10s
        return () => {
            observer.disconnect();
            clearInterval(r);
            if (throttleTimer) clearTimeout(throttleTimer);
        };
    }, [petEnabled]);

    // ============================================================
    // Food falling animation — falls to BOTTOM of container
    // ============================================================
    React.useEffect(() => {
        if (droppedFood.length === 0) return;
        const containerHeight = containerRef.current?.clientHeight ?? 500;
        const bottomY = containerHeight - 40; // food sprite height

        const fallInterval = setInterval(() => {
            setDroppedFood((prev: DroppedFood[]) => {
                let changed = false;
                const next = prev.map((f) => {
                    if (f.falling && f.y < bottomY) {
                        changed = true;
                        return { ...f, y: Math.min(f.y + 5, bottomY) };
                    }
                    if (f.falling && f.y >= bottomY) {
                        changed = true;
                        return { ...f, y: bottomY, falling: false };
                    }
                    return f;
                });
                return changed ? next : prev;
            });
        }, 25);
        return () => clearInterval(fallInterval);
    }, [droppedFood.length > 0]);

    // ============================================================
    // Main animation loop — movement + physics (OPTIMIZED)
    // Skips frames when document hidden; skips position update for stationary behaviors
    // ============================================================
    React.useEffect(() => {
        if (!petEnabled || !petInstance || isGrabbed) return;

        const GRAVITY = 1200;
        const BOUNCE = 0.5;
        const FRICTION = 0.98;
        // Stationary behaviors that don't need position updates every frame
        const STATIONARY = new Set(["IDLE", "SIT", "SLEEP", "SNOOZE", "CELEBRATE", "HAPPY", "SAD", "CRY"]);

        const animate = (time: number) => {
            // Skip frames when document is hidden (tab in background)
            if (document.hidden) {
                lastTimeRef.current = 0;
                animFrameRef.current = requestAnimationFrame(animate);
                return;
            }

            if (!lastTimeRef.current) lastTimeRef.current = time;
            const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05); // cap dt
            lastTimeRef.current = time;
            const curBehavior = behaviorRef.current;

            // Behavior timer — SKIP during interactive states
            const interactiveStates = ["PET", "GRABBED", "EAT", "FALL", "DIZZY"];
            if (!interactiveStates.includes(curBehavior)) {
                behaviorTimerRef.current += dt * 1000;
                if (behaviorTimerRef.current >= behaviorDurationRef.current) {
                    behaviorTimerRef.current = 0;
                    const mood = (petInstance?.mood || "neutral") as PetMood;
                    const newBehavior = pickRandomBehavior(mood);
                    setBehavior(newBehavior);
                    behaviorDurationRef.current = getBehaviorDuration(newBehavior);
                    if ((newBehavior === "WALK" || newBehavior === "RUN") && Math.random() > 0.5) {
                        setPosition((prev: PetPosition) => ({
                            ...prev,
                            facing: prev.facing === "left" ? "right" : "left",
                        }));
                    }
                }
            }

            // Skip position update for stationary behaviors with no velocity
            // This eliminates ~60 unnecessary React state updates/second when pet is idle
            const hasVelocity = Math.abs(position.velocityX || 0) > 1 || Math.abs(position.velocityY || 0) > 1;
            if (STATIONARY.has(curBehavior) && !hasVelocity) {
                animFrameRef.current = requestAnimationFrame(animate);
                return;
            }

            setPosition((prev: PetPosition) => {
                const bounds = containerRef.current?.parentElement?.getBoundingClientRect();
                const maxX = (bounds?.width ?? 600) - petSize;
                const newPos = { ...prev };

                // Apply throw velocity (decays via friction)
                if (Math.abs(newPos.velocityX || 0) > 1 || Math.abs(newPos.velocityY || 0) > 1) {
                    newPos.x += (newPos.velocityX || 0) * dt;
                    newPos.velocityX = (newPos.velocityX || 0) * FRICTION;

                    // Apply gravity
                    newPos.velocityY = (newPos.velocityY || 0) + GRAVITY * dt;
                    newPos.y -= newPos.velocityY * dt;

                    // Bounce off floor
                    if (newPos.y <= 0) {
                        newPos.y = 0;
                        if (Math.abs(newPos.velocityY) > 50) {
                            newPos.velocityY = -newPos.velocityY * BOUNCE;
                        } else {
                            newPos.velocityY = 0;
                            newPos.velocityX = 0;
                        }
                    }

                    // Bounce off walls
                    if (newPos.x <= 0) {
                        newPos.x = 0;
                        newPos.velocityX = Math.abs(newPos.velocityX || 0) * BOUNCE;
                    } else if (newPos.x >= maxX) {
                        newPos.x = maxX;
                        newPos.velocityX = -Math.abs(newPos.velocityX || 0) * BOUNCE;
                    }

                    // Stop movement when velocity is low enough
                    if (Math.abs(newPos.velocityX || 0) < 1 && Math.abs(newPos.velocityY || 0) < 1 && newPos.y <= 0) {
                        newPos.velocityX = 0;
                        newPos.velocityY = 0;
                    }
                } else {
                    // Normal walking movement
                    const dir = prev.facing === "right" ? 1 : -1;
                    if (curBehavior === "WALK") {
                        newPos.x += dir * 40 * dt;
                    } else if (curBehavior === "RUN") {
                        newPos.x += dir * 100 * dt;
                    } else if (curBehavior === "JUMP") {
                        newPos.x += dir * 25 * dt;
                    }

                    // Turn at boundaries
                    if (newPos.x <= 5) {
                        newPos.x = 5;
                        newPos.facing = "right";
                    } else if (newPos.x >= maxX) {
                        newPos.x = maxX;
                        newPos.facing = "left";
                    }
                }

                return newPos;
            });

            animFrameRef.current = requestAnimationFrame(animate);
        };

        animFrameRef.current = requestAnimationFrame(animate);
        return () => {
            cancelAnimationFrame(animFrameRef.current);
            lastTimeRef.current = 0;
        };
    }, [petEnabled, petInstance, behavior, isGrabbed, petSize]);

    // ============================================================
    // Grab + THROW handlers
    // ============================================================
    const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsGrabbed(true);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        grabOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        lastMouseRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
        throwVelocityRef.current = { vx: 0, vy: 0 };
        setBehavior("GRABBED");

        const onMove = (me: MouseEvent) => {
            if (!containerRef.current) return;
            const parentRect = containerRef.current.parentElement?.getBoundingClientRect();
            if (!parentRect) return;

            // Track velocity for throw
            const now = Date.now();
            const dtMs = now - lastMouseRef.current.time;
            if (dtMs > 0) {
                throwVelocityRef.current = {
                    vx: ((me.clientX - lastMouseRef.current.x) / (dtMs / 1000)) * 0.3,
                    vy: ((lastMouseRef.current.y - me.clientY) / (dtMs / 1000)) * 0.3,
                };
            }
            lastMouseRef.current = { x: me.clientX, y: me.clientY, time: now };

            setPosition((prev: PetPosition) => ({
                ...prev,
                x: me.clientX - parentRect.left - grabOffsetRef.current.x,
                y: parentRect.bottom - me.clientY - grabOffsetRef.current.y,
            }));
        };

        const onUp = () => {
            setIsGrabbed(false);
            // Apply throw velocity
            const { vx, vy } = throwVelocityRef.current;
            setPosition((prev: PetPosition) => ({
                ...prev,
                velocityX: vx,
                velocityY: vy,
            }));
            setBehavior("FALL");
            setTimeout(() => {
                setBehavior("DIZZY");
                setTimeout(() => setBehavior("IDLE"), 1500);
            }, 800);
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }, []);

    // Double click → happy reaction
    const handleDoubleClick = React.useCallback(() => {
        if (isGrabbed) return;
        setBehavior("PET");
        setIsPetted(true);
        petController.interact("pet");
        setTimeout(() => {
            setIsPetted(false);
            setBehavior("IDLE");
        }, 3000);
    }, [isGrabbed]);

    // ============================================================
    // Food drag & drop onto pet
    // ============================================================
    const handleFoodDragStart = React.useCallback((e: React.DragEvent, food: DroppedFood) => {
        e.dataTransfer.setData("text/plain", food.id);
        e.dataTransfer.effectAllowed = "move";
    }, []);

    const handlePetDragOver = React.useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    }, []);

    const handlePetDrop = React.useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const foodDropId = e.dataTransfer.getData("text/plain");
        if (!foodDropId) return;
        const petInst = globalStore.get(petInstanceAtom);
        if (!petInst) return;
        const allDropped = globalStore.get(droppedFoodAtom);
        const foodDrop = allDropped.find((f: DroppedFood) => f.id === foodDropId);
        if (!foodDrop) return;
        const shopItem = FOOD_SHOP.find((f) => f.id === foodDrop.itemId);
        if (!shopItem) return;

        // Full check
        if ((petInst.hunger ?? 0) <= 0.02) {
            petController.showTerminalReaction("Không ăn nữa đâu! No lắm rồi boss~");
            return; // food stays!
        }

        // Remove food, feed pet
        globalStore.set(
            droppedFoodAtom,
            allDropped.filter((f: DroppedFood) => f.id !== foodDropId)
        );
        globalStore.set(petInstanceAtom, {
            ...petInst,
            hunger: Math.max(0, (petInst.hunger ?? 0) - shopItem.hungerRestore),
            energy: Math.min(1, (petInst.energy ?? 0.5) + shopItem.happinessBoost * 0.5),
        });
        setBehavior("EAT");
        petController.showTerminalReaction("Ngon quá! Cảm ơn boss~");
        setTimeout(() => {
            setBehavior("CELEBRATE");
            setTimeout(() => setBehavior("IDLE"), 2000);
        }, 2000);
    }, []);

    // ============================================================
    // Render
    // ============================================================
    if (!petEnabled || !petInstance) return null;

    // Determine sprite URL — NEVER change URL on click (CSS glow handles petting)
    const catalogueEntry = DEFAULT_CATALOGUE.find((e) => e.id === petInstance.petId);
    const isWaifu = catalogueEntry?.type === "waifu";
    const spriteUrl = catalogueEntry?.customSpriteUrl || `${SHOWDOWN_ANI}/${petInstance.petId}.gif`;
    const staticUrl = catalogueEntry?.customSpriteUrl || `${POKESPRITE_STATIC}/${petInstance.petId}.png`;
    const animClass = getAnimClass(behavior);
    // Showdown ani/ sprites face LEFT by default
    // Flip when facing RIGHT
    const facingRight = position.facing === "right";

    const posStyle: React.CSSProperties = { left: `${position.x}px`, cursor: isGrabbed ? "grabbing" : "grab" };
    if (petEdge === "top") {
        posStyle.top = `${Math.max(0, position.y)}px`;
    } else {
        posStyle.bottom = `${Math.max(0, position.y)}px`;
    }

    return (
        <div className="pet-overlay-container" ref={containerRef}>
            {/* Dropped Food */}
            {droppedFood.map((food) => {
                const item = FOOD_SHOP.find((f) => f.id === food.itemId);
                if (!item) return null;
                return (
                    <div
                        key={food.id}
                        className={`dropped-food-item ${food.falling ? "falling" : "landed"}`}
                        style={{ left: `${food.x}px`, top: `${food.y}px` }}
                        draggable
                        onDragStart={(e) => handleFoodDragStart(e, food)}
                    >
                        <img
                            src={item.spriteUrl}
                            alt={item.name}
                            className="dropped-food-sprite"
                            draggable={false}
                            onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                img.style.display = "none";
                                // Insert emoji fallback AFTER the img
                                const span = document.createElement("span");
                                span.className = "dropped-food-emoji";
                                span.textContent = item?.emoji ?? "🍎";
                                img.parentElement?.appendChild(span);
                            }}
                        />
                    </div>
                );
            })}

            {/* Pet Character */}
            <div
                className={`pet-character ${animClass} ${isGrabbed ? "grabbed" : ""} ${isPetted ? "petted" : ""}`}
                style={posStyle}
                onMouseDown={handleMouseDown}
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
                onDoubleClick={handleDoubleClick}
                onDragOver={handlePetDragOver}
                onDrop={handlePetDrop}
            >
                <div className="pet-sprite" style={{ transform: facingRight ? "scaleX(-1)" : "none" }}>
                    <img
                        src={spriteUrl}
                        alt={petInstance.name}
                        draggable={false}
                        style={{
                            width: `${petSize}px`,
                            height: `${petSize}px`,
                            imageRendering: isWaifu ? "auto" : "pixelated",
                            objectFit: "contain",
                        }}
                        onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            // Waifu SVGs should never fallback to pokesprite
                            if (isWaifu) return;
                            if (!img.src.includes("pokesprite")) img.src = staticUrl;
                        }}
                    />
                </div>
                <div className="pet-shadow" style={{ width: `${petSize * 0.6}px` }} />
                {speechBubble.visible && (
                    <div className={`pet-speech-bubble ${speechBubble.type}`}>
                        <span>{speechBubble.text}</span>
                        <div className="speech-tail" />
                    </div>
                )}
            </div>
        </div>
    );
};

function getAnimClass(b: PetBehavior): string {
    return (
        (
            {
                WALK: "anim-walk",
                RUN: "anim-run",
                JUMP: "anim-jump",
                IDLE: "anim-idle",
                SIT: "anim-sit",
                SLEEP: "anim-sleep",
                CELEBRATE: "anim-celebrate",
                PET: "anim-pet",
                EAT: "anim-eat",
                GRABBED: "anim-grabbed",
                FALL: "anim-fall",
                DIZZY: "anim-dizzy",
                HAPPY: "anim-happy",
                SAD: "anim-sad",
                CRY: "anim-cry",
                WAG: "anim-wag",
                PLAY: "anim-play",
                SNOOZE: "anim-snooze",
            } as any
        )[b] || "anim-idle"
    );
}

export { PetOverlay };
