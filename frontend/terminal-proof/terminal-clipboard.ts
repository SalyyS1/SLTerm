import type { Terminal } from "@xterm/xterm";

type ClipboardTerminal = Pick<
    Terminal,
    "getSelection" | "clearSelection" | "onSelectionChange" | "paste" | "focus" | "attachCustomKeyEventHandler"
>;
type ClipboardAccess = {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
    canPaste(): boolean;
    onError(error: unknown): void;
};

/** Keep clipboard gestures separate from PTY input; xterm owns paste encoding. */
export function installTerminalClipboard(terminal: ClipboardTerminal, element: HTMLElement, clipboard: ClipboardAccess) {
    let disposed = false;
    let selectionRevision = 0;
    let focusRevision = 0;
    let copiedKeyHeld = false;
    let copying = false;
    let pasting = false;
    let copyIntent: { text: string; revision: number; focus: number } | undefined;
    const selection = terminal.onSelectionChange(() => { selectionRevision++; copyIntent = undefined; });
    const focusChanged = () => { focusRevision++; copyIntent = undefined; };
    const window = element.ownerDocument.defaultView;
    const focused = () => element.ownerDocument.hasFocus() && element.contains(element.ownerDocument.activeElement);
    element.addEventListener("focusout", focusChanged);
    window?.addEventListener("blur", focusChanged);

    async function copy(text: string) {
        if (copying) {
            clipboard.onError(new Error("Clipboard copy is already in progress"));
            return;
        }
        copying = true;
        const revision = selectionRevision;
        const focus = focusRevision;
        try {
            await clipboard.writeText(text);
            // A completed write must never erase a newer selection, even with identical text.
            if (
                !disposed && revision === selectionRevision && terminal.getSelection() === text &&
                focus === focusRevision && focused()
            ) {
                terminal.clearSelection();
            }
        } catch (error) {
            // Failure keeps the selection available for a fresh copy attempt. A second
            // interrupt or a newer selection/focus may already have invalidated this intent.
            if (copyIntent?.revision === revision && copyIntent.focus === focus && copyIntent.text === text) {
                copyIntent = undefined;
            }
            clipboard.onError(new Error("Clipboard copy failed: " + String(error)));
        } finally {
            copying = false;
        }
    }

    async function paste() {
        if (pasting) {
            clipboard.onError(new Error("Clipboard paste is already in progress"));
            return;
        }
        if (!clipboard.canPaste()) {
            clipboard.onError(new Error("This terminal is not ready for clipboard paste"));
            return;
        }
        pasting = true;
        const focus = focusRevision;
        try {
            const text = await clipboard.readText();
            if (disposed) return;
            if (focus !== focusRevision || !focused() || !clipboard.canPaste()) {
                throw new Error("Terminal focus or readiness changed; paste was cancelled");
            }
            // The public paste API normalizes LF/CRLF and applies the active bracketed paste mode.
            if (text) terminal.paste(text);
        } catch (error) {
            clipboard.onError(new Error("Clipboard paste failed: " + String(error)));
        } finally {
            pasting = false;
        }
    }

    function consume(event: Event) {
        event.preventDefault();
        event.stopPropagation();
        return false;
    }

    terminal.attachCustomKeyEventHandler((event) => {
        const key = event.key.toLowerCase();
        if (key === "c" && copiedKeyHeld) {
            if (event.type === "keyup") {
                copiedKeyHeld = false;
                return consume(event);
            }
            if (event.type !== "keydown" || event.repeat) return consume(event);
            // A distinct press may interrupt after the previous copy cleared the selection.
            copiedKeyHeld = false;
        }
        if (event.isComposing || event.keyCode === 229 || !event.ctrlKey || event.altKey || event.metaKey) return true;
        if (key === "c") {
            const text = terminal.getSelection();
            if (!text && !event.shiftKey) return true;
            if (
                !event.shiftKey && event.type === "keydown" && !event.repeat &&
                copyIntent?.text === text && copyIntent.revision === selectionRevision &&
                copyIntent.focus === focusRevision && focused()
            ) {
                // A second press interrupts even before the native copy settles. Xterm
                // emits ETX and clears selection through its normal user-input path.
                copyIntent = undefined;
                copiedKeyHeld = true;
                return true;
            }
            consume(event);
            if (event.type === "keydown") {
                copiedKeyHeld = true;
                if (text && !event.repeat) {
                    if (!copying) copyIntent = { text, revision: selectionRevision, focus: focusRevision };
                    void copy(text);
                }
            }
            return false;
        }
        if (key === "v" && event.shiftKey) {
            consume(event);
            if (event.type === "keydown" && !event.repeat) void paste();
            return false;
        }
        return true;
    });

    const rightButton = (event: MouseEvent) => {
        if (event.button === 2) consume(event);
    };
    const contextMenu = (event: MouseEvent) => {
        consume(event);
        terminal.focus();
        void paste();
    };
    // Capture before xterm opens a context menu or sends mouse reporting bytes.
    element.addEventListener("mousedown", rightButton, true);
    element.addEventListener("mouseup", rightButton, true);
    element.addEventListener("auxclick", rightButton, true);
    element.addEventListener("contextmenu", contextMenu, true);
    return {
        dispose() {
            disposed = true;
            selection.dispose();
            terminal.attachCustomKeyEventHandler(() => true);
            element.removeEventListener("focusout", focusChanged);
            window?.removeEventListener("blur", focusChanged);
            element.removeEventListener("mousedown", rightButton, { capture: true });
            element.removeEventListener("mouseup", rightButton, { capture: true });
            element.removeEventListener("auxclick", rightButton, { capture: true });
            element.removeEventListener("contextmenu", contextMenu, { capture: true });
        },
    };
}
