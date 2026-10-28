export const DEFAULT_FONT_SIZE = 12;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 30;

export function nextFontSize(current: number, delta: number | "reset"): number {
    return delta === "reset" ? DEFAULT_FONT_SIZE : Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, current + delta));
}

export function fontKey(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "metaKey" | "isComposing" | "keyCode">) {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.keyCode === 229) return;
    if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") return 1;
    if (event.key === "-" || event.code === "NumpadSubtract") return -1;
    if (event.key === "0" || event.code === "Numpad0") return "reset" as const;
}

export function installTerminalFont(
    root: HTMLElement,
    controls: { decrease: HTMLButtonElement; increase: HTMLButtonElement; reset: HTMLButtonElement },
    apply: (size: number) => void
) {
    let size = DEFAULT_FONT_SIZE;
    const change = (delta: number | "reset") => {
        const next = nextFontSize(size, delta);
        if (next === size) return;
        size = next;
        controls.decrease.disabled = size === MIN_FONT_SIZE;
        controls.increase.disabled = size === MAX_FONT_SIZE;
        controls.reset.textContent = size + " px";
        apply(size);
    };
    // Fit xterm after changing its font, rather than scaling the whole WebView.
    window.addEventListener("keydown", (event) => {
        const delta = fontKey(event);
        if (delta === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        change(delta);
    }, true);
    root.addEventListener("wheel", (event) => {
        if (!event.ctrlKey || event.altKey || event.metaKey || event.deltaY === 0) return;
        event.preventDefault();
        event.stopPropagation();
        change(event.deltaY < 0 ? 1 : -1);
    }, { passive: false, capture: true });
    controls.decrease.addEventListener("click", () => change(-1));
    controls.increase.addEventListener("click", () => change(1));
    controls.reset.addEventListener("click", () => change("reset"));
    return { get size() { return size; } };
}
