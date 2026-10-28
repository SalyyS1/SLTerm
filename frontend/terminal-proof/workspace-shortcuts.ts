export const defaultShortcuts = {
    newWorkspace: "Ctrl+Shift+KeyT", newTerminal: null,
    splitHorizontal: "Ctrl+Shift+KeyD", splitVertical: "Ctrl+Shift+KeyE",
    closePane: "Ctrl+Shift+KeyW", stopPane: null, zoomPane: "Ctrl+Shift+Enter",
    hidePane: null, showAllPanes: null,
    nextWorkspace: "Ctrl+Tab", previousWorkspace: "Ctrl+Shift+Tab", search: "Ctrl+KeyF",
    fontIncrease: "Ctrl+Equal", fontDecrease: "Ctrl+Minus", fontReset: "Ctrl+Digit0",
    toggleSidebar: null, settings: null, toggleLayout: null,
} satisfies Record<string, string | null>;

export type ShortcutAction = keyof typeof defaultShortcuts;
export type ShortcutBindings = Record<ShortcutAction, string | null>;
export const shortcutActions = Object.keys(defaultShortcuts) as ShortcutAction[];
export const shortcutLabels: Record<ShortcutAction, string> = {
    newWorkspace: "Workspace mới", newTerminal: "Terminal mới",
    splitHorizontal: "Chia trái / phải", splitVertical: "Chia trên / dưới",
    closePane: "Dừng và đóng ô", stopPane: "Dừng process, giữ nội dung", zoomPane: "Phóng to / khôi phục ô",
    hidePane: "Ẩn ô hiện tại", showAllPanes: "Hiện tất cả ô",
    nextWorkspace: "Workspace kế tiếp", previousWorkspace: "Workspace trước", search: "Tìm trong terminal",
    fontIncrease: "Tăng cỡ chữ terminal", fontDecrease: "Giảm cỡ chữ terminal", fontReset: "Cỡ chữ mặc định",
    toggleSidebar: "Ẩn / hiện thanh bên", settings: "Cài đặt", toggleLayout: "Đổi bố cục tự do / chia ô",
};

type ShortcutEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"> &
    Partial<Pick<KeyboardEvent, "isComposing" | "keyCode" | "repeat" | "target" | "getModifierState">>;
export type ShortcutValidationIssue = {
    action: ShortcutAction; type: "invalid" | "reserved" | "conflict";
    message: string; binding?: string; conflictsWith?: ShortcutAction;
};
const modifierNames: Record<string, string> = {
    ctrl: "Ctrl", control: "Ctrl", shift: "Shift", alt: "Alt", option: "Alt", meta: "Meta", win: "Meta", cmd: "Meta",
};
const codeNames = new Map<string, string>();
for (const code of [
    ...Array.from({ length: 26 }, (_, i) => "Key" + String.fromCharCode(65 + i)),
    ...Array.from({ length: 10 }, (_, i) => "Digit" + i),
    ...Array.from({ length: 24 }, (_, i) => "F" + (i + 1)),
    "Equal", "Minus", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash",
    "Enter", "Tab", "Space", "Escape", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Pause", "PrintScreen",
]) codeNames.set(code.toLowerCase(), code);
const codeAliases: Record<string, string> = {
    "+": "Equal", "=": "Equal", plus: "Equal", numpadadd: "Equal", "-": "Minus", subtract: "Minus", numpadsubtract: "Minus",
    numpadenter: "Enter", esc: "Escape", del: "Delete", ins: "Insert", spacebar: "Space", " ": "Space",
    "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", ";": "Semicolon", "'": "Quote", "`": "Backquote",
    ",": "Comma", ".": "Period", "/": "Slash",
};
function canonicalCode(value: string): string | undefined {
    const lower = value.toLowerCase();
    if (/^[a-z]$/.test(lower)) return "Key" + lower.toUpperCase();
    if (/^[0-9]$/.test(lower)) return "Digit" + lower;
    if (/^numpad[0-9]$/.test(lower)) return "Digit" + lower.slice(-1);
    return codeAliases[lower] ?? codeNames.get(lower);
}
function canonicalShortcut(value: string): string | null {
    // Accept the common Ctrl++ spelling while persisting an unambiguous physical code.
    const parts = value.trim().replace(/\+\s*\+$/, "+Equal").split("+").map((part) => part.trim());
    const modifiers = new Set<string>();
    let code: string | undefined;
    for (const part of parts) {
        const modifier = modifierNames[part.toLowerCase()];
        if (modifier) {
            if (modifiers.has(modifier)) return null;
            modifiers.add(modifier);
        } else {
            if (code) return null;
            code = canonicalCode(part);
            if (!code) return null;
        }
    }
    return code ? [...["Ctrl", "Alt", "Shift", "Meta"].filter((part) => modifiers.has(part)), code].join("+") : null;
}
function reservedReason(binding: string): string | null {
    const parts = binding.split("+");
    const code = parts.at(-1)!;
    const ctrl = parts.includes("Ctrl"), alt = parts.includes("Alt"), shift = parts.includes("Shift");
    if (parts.includes("Meta")) return "Phím Windows / Command dành cho hệ điều hành.";
    if (alt && code === "F4" || ctrl && alt && code === "Delete") return "Tổ hợp này dành cho hệ điều hành.";
    if (!alt && (ctrl && (code === "KeyC" || code === "KeyV") || (ctrl || shift) && code === "Insert")) {
        return "Giữ tổ hợp copy, paste và ngắt process cho terminal.";
    }
    if (!ctrl && !alt && !/^F\d+$/.test(code)) return "Dùng Ctrl hoặc Alt để không chặn nhập liệu terminal.";
    return null;
}

/** Validate drafts before saving, including collisions after resolving workspace inheritance. */
export function validateShortcutBindings(value: Partial<ShortcutBindings>): ShortcutValidationIssue[] {
    const issues: ShortcutValidationIssue[] = [];
    const used = new Map<string, ShortcutAction>();
    for (const action of shortcutActions) {
        const raw = value[action];
        if (raw === null || raw === undefined) continue;
        const binding = typeof raw === "string" ? canonicalShortcut(raw) : null;
        if (!binding) {
            issues.push({ action, type: "invalid", message: "Tổ hợp phím không hợp lệ." });
            continue;
        }
        const reason = reservedReason(binding);
        if (reason) issues.push({ action, type: "reserved", binding, message: reason });
        const previous = used.get(binding);
        if (previous) issues.push({ action, type: "conflict", binding, conflictsWith: previous, message: `Trùng với “${shortcutLabels[previous]}”.` });
        else used.set(binding, action);
    }
    return issues;
}

/** Missing/malformed persisted entries inherit defaults; null explicitly unbinds an action. */
export function normalizeShortcuts(value: unknown): ShortcutBindings {
    const result: ShortcutBindings = { ...defaultShortcuts };
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const action of shortcutActions) {
        const raw = (value as Record<string, unknown>)[action];
        if (raw === null) result[action] = null;
        else if (typeof raw === "string") {
            const binding = canonicalShortcut(raw);
            if (binding && !reservedReason(binding)) result[action] = binding;
        }
    }
    return result;
}
export function resolveShortcuts(global: ShortcutBindings, override?: Partial<ShortcutBindings> | null): ShortcutBindings {
    const result = normalizeShortcuts(global);
    if (!override) return result;
    for (const action of shortcutActions) {
        const raw = override[action];
        if (raw === null) result[action] = null;
        else if (typeof raw === "string") {
            const binding = canonicalShortcut(raw);
            if (binding && !reservedReason(binding)) result[action] = binding;
        }
    }
    return result;
}

/** Capture can return a reserved combination so the editor can explain why it is unavailable. */
export function shortcutFromEvent(event: ShortcutEvent): string | null {
    if (event.isComposing || event.keyCode === 229 || event.getModifierState?.("AltGraph")) return null;
    const code = canonicalCode(event.code || event.key);
    if (!code) return null;
    return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta", code].filter(Boolean).join("+");
}
export function matchShortcut(event: ShortcutEvent, bindings: ShortcutBindings): ShortcutAction | undefined {
    const target = event.target as HTMLElement | null | undefined;
    if (typeof target?.closest === "function") {
        const editing = target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox'],[data-shortcut-capture]");
        if (editing && !editing.classList.contains("xterm-helper-textarea")) return;
    }
    const binding = shortcutFromEvent(event);
    if (!binding || reservedReason(binding)) return;
    const action = shortcutActions.find((action) => {
        const raw = bindings[action];
        return typeof raw === "string" && canonicalShortcut(raw) === binding;
    }) ?? (binding === "Ctrl+Shift+Equal" && bindings.fontIncrease === "Ctrl+Equal" ? "fontIncrease" : undefined);
    // Holding a gesture must not repeatedly spawn, stop, close, hide or toggle panes.
    if (event.repeat && action && !["fontIncrease", "fontDecrease", "nextWorkspace", "previousWorkspace"].includes(action)) return;
    return action;
}
export function displayShortcut(binding: string | null | undefined): string {
    if (!binding) return "Chưa gán";
    return (canonicalShortcut(binding) ?? binding).split("+").map((part) => {
        if (part.startsWith("Key")) return part.slice(3);
        if (part.startsWith("Digit")) return part.slice(5);
        return ({ Equal: "+", Minus: "−", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Meta: "Win" } as Record<string, string>)[part] ?? part;
    }).join(" + ");
}
