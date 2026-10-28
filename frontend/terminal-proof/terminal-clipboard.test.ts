import { describe, expect, it, vi } from "vitest";
import { installTerminalClipboard } from "./terminal-clipboard";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
    return { promise, resolve, reject };
}

function setup() {
    const document = { activeElement: {} as object, hasFocus: () => true, defaultView: new EventTarget() };
    const element = Object.assign(new EventTarget(), {
        ownerDocument: document,
        contains: (target: object) => target === element,
    }) as unknown as HTMLElement;
    document.activeElement = element;
    let selected = "";
    let selectionChanged = () => {};
    let keyHandler!: (event: KeyboardEvent) => boolean;
    const terminal = {
        getSelection: () => selected,
        clearSelection: vi.fn(() => { selected = ""; selectionChanged(); }),
        onSelectionChange: (listener: () => void) => {
            selectionChanged = listener;
            return { dispose: vi.fn() };
        },
        paste: vi.fn(),
        focus: vi.fn(() => { document.activeElement = element; }),
        attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => { keyHandler = handler; },
    };
    const clipboard = {
        readText: vi.fn<() => Promise<string>>().mockResolvedValue("pasted"),
        writeText: vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined),
        canPaste: vi.fn(() => true),
        onError: vi.fn(),
    };
    const installed = installTerminalClipboard(terminal, element, clipboard);
    return {
        terminal, clipboard, installed, element,
        windowBlur() { document.defaultView.dispatchEvent(new Event("blur")); },
        select(text: string) { selected = text; selectionChanged(); },
        blur() { document.activeElement = {}; element.dispatchEvent(new Event("focusout")); },
        key(overrides: Partial<KeyboardEvent> = {}) {
            const event = Object.assign(new Event(overrides.type ?? "keydown", { cancelable: true }), {
                key: "c", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false,
                repeat: false, isComposing: false, keyCode: 67,
                ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "type")),
            }) as KeyboardEvent;
            return { allowed: keyHandler(event), event };
        },
        rightClick() {
            const event = new Event("contextmenu", { cancelable: true });
            element.dispatchEvent(event);
            return event;
        },
    };
}

describe("terminal clipboard", () => {
    it("copies selection before clearing; a new Ctrl+C then remains xterm interrupt input", async () => {
        const fixture = setup();
        const write = deferred<void>();
        fixture.clipboard.writeText.mockReturnValue(write.promise);
        fixture.select("Tiếng Việt 🙂");
        const first = fixture.key();
        expect(first.allowed).toBe(false);
        expect(first.event.defaultPrevented).toBe(true);
        expect(fixture.clipboard.writeText).toHaveBeenCalledWith("Tiếng Việt 🙂");
        expect(fixture.terminal.clearSelection).not.toHaveBeenCalled();
        write.resolve();
        await write.promise;
        expect(fixture.terminal.clearSelection).toHaveBeenCalledOnce();
        expect(fixture.key({ repeat: true }).allowed).toBe(false);
        expect(fixture.key({ type: "keyup" }).allowed).toBe(false);
        expect(fixture.key().allowed).toBe(true);
        expect(fixture.clipboard.writeText).toHaveBeenCalledOnce();
    });

    it("leaves Ctrl+C without selection and unrelated modifiers/composition to xterm", () => {
        const fixture = setup();
        expect(fixture.key().allowed).toBe(true);
        fixture.select("selected");
        for (const overrides of [{ altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) {
            expect(fixture.key(overrides).allowed).toBe(true);
        }
        expect(fixture.key({ key: "v", keyCode: 86 }).allowed).toBe(true);
        expect(fixture.clipboard.writeText).not.toHaveBeenCalled();
        expect(fixture.clipboard.readText).not.toHaveBeenCalled();
    });

    it.each(["success", "failure"])("lets a second distinct Ctrl+C interrupt during a delayed copy %s", async (outcome) => {
        const fixture = setup();
        const write = deferred<void>();
        fixture.clipboard.writeText.mockReturnValue(write.promise);
        fixture.select("same selection");
        expect(fixture.key().allowed).toBe(false);
        expect(fixture.key({ repeat: true }).allowed).toBe(false);
        expect(fixture.key({ type: "keyup" }).allowed).toBe(false);
        const interrupt = fixture.key();
        expect(interrupt.allowed).toBe(true);
        expect(interrupt.event.defaultPrevented).toBe(false);
        expect(fixture.key({ repeat: true }).allowed).toBe(false);
        expect(fixture.key({ repeat: true }).allowed).toBe(false);
        expect(fixture.clipboard.writeText).toHaveBeenCalledExactlyOnceWith("same selection");
        expect(fixture.terminal.clearSelection).not.toHaveBeenCalled();
        // The accepted key goes to xterm, whose user-input handler clears selection.
        fixture.terminal.clearSelection();
        fixture.select("new selection after interrupt");
        if (outcome === "failure") {
            write.reject(new Error("clipboard busy"));
            await vi.waitFor(() => expect(fixture.clipboard.onError).toHaveBeenCalledOnce());
        } else {
            write.resolve();
            await write.promise;
        }
        expect(fixture.terminal.clearSelection).toHaveBeenCalledOnce();
        expect(fixture.terminal.getSelection()).toBe("new selection after interrupt");
    });

    it.each(["async", "sync"])("preserves selection and retries a completed %s copy failure on a fresh press", async (failure) => {
        const fixture = setup();
        const retry = deferred<void>();
        fixture.select("keep selected");
        if (failure === "sync") {
            fixture.clipboard.writeText.mockImplementationOnce(() => { throw new Error("clipboard busy"); });
        } else {
            fixture.clipboard.writeText.mockRejectedValueOnce(new Error("clipboard busy"));
        }
        fixture.clipboard.writeText.mockReturnValueOnce(retry.promise);
        expect(fixture.key().allowed).toBe(false);
        await vi.waitFor(() => expect(fixture.clipboard.onError).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining("clipboard busy"),
        })));
        expect(fixture.terminal.clearSelection).not.toHaveBeenCalled();
        expect(fixture.key({ repeat: true }).allowed).toBe(false);
        expect(fixture.key({ type: "keyup" }).allowed).toBe(false);
        expect(fixture.key().allowed).toBe(false);
        expect(fixture.key({ repeat: true }).allowed).toBe(false);
        expect(fixture.clipboard.writeText).toHaveBeenCalledTimes(2);
        expect(fixture.clipboard.writeText).toHaveBeenLastCalledWith("keep selected");
        expect(fixture.terminal.clearSelection).not.toHaveBeenCalled();
        retry.resolve();
        await retry.promise;
        expect(fixture.terminal.clearSelection).toHaveBeenCalledOnce();
    });

    it.each(["first", "second"])("preserves a new selection containing %s during an overlapping copy", async (newText) => {
        const fixture = setup();
        const write = deferred<void>();
        fixture.clipboard.writeText.mockReturnValue(write.promise);
        fixture.select("first");
        fixture.key();
        fixture.key({ type: "keyup" });
        fixture.select(newText);
        expect(fixture.key().allowed).toBe(false);
        expect(fixture.clipboard.writeText).toHaveBeenCalledExactlyOnceWith("first");
        expect(fixture.clipboard.onError).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining("already in progress"),
        }));
        write.resolve();
        await write.promise;
        expect(fixture.terminal.clearSelection).not.toHaveBeenCalled();
    });

    it.each(["selection", "focus", "window focus"])("preserves a new %s while an async copy finishes", async (change) => {
        const fixture = setup();
        const write = deferred<void>();
        fixture.clipboard.writeText.mockReturnValue(write.promise);
        fixture.select("same text");
        fixture.key();
        if (change === "selection") {
            fixture.select("other text");
            fixture.select("same text");
        } else if (change === "focus") {
            fixture.blur();
            fixture.terminal.focus();
        } else {
            fixture.windowBlur();
        }
        write.resolve();
        await write.promise;
        expect(fixture.terminal.clearSelection).not.toHaveBeenCalled();
    });

    it("keeps Ctrl+Shift+C/V and passes raw multiline text through xterm's paste API", async () => {
        const fixture = setup();
        fixture.select("copy");
        expect(fixture.key({ shiftKey: true }).allowed).toBe(false);
        await vi.waitFor(() => expect(fixture.terminal.clearSelection).toHaveBeenCalledOnce());
        fixture.clipboard.readText.mockResolvedValue("one\r\ntwo\n中文🙂\rthree");
        expect(fixture.key({ key: "v", shiftKey: true, keyCode: 86 }).allowed).toBe(false);
        expect(fixture.key({ key: "v", shiftKey: true, keyCode: 86, repeat: true }).allowed).toBe(false);
        await vi.waitFor(() => expect(fixture.terminal.paste).toHaveBeenCalledExactlyOnceWith("one\r\ntwo\n中文🙂\rthree"));
        expect(fixture.clipboard.readText).toHaveBeenCalledOnce();
    });

    it("right-click focuses and pastes once without a native context menu", async () => {
        const fixture = setup();
        fixture.blur();
        expect(fixture.rightClick().defaultPrevented).toBe(true);
        expect(fixture.terminal.focus).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(fixture.terminal.paste).toHaveBeenCalledExactlyOnceWith("pasted"));
        for (const type of ["mousedown", "mouseup", "auxclick"]) {
            const event = Object.assign(new Event(type, { cancelable: true }), { button: 2 });
            fixture.element.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
        }
        expect(fixture.clipboard.readText).toHaveBeenCalledOnce();
    });

    it("cancels late paste after focus or readiness changes, without retrying", async () => {
        const fixture = setup();
        const read = deferred<string>();
        fixture.clipboard.readText.mockReturnValue(read.promise);
        fixture.rightClick();
        fixture.blur();
        fixture.terminal.focus();
        read.resolve("do not send");
        await vi.waitFor(() => expect(fixture.clipboard.onError).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining("cancelled"),
        })));
        expect(fixture.terminal.paste).not.toHaveBeenCalled();
        fixture.clipboard.canPaste.mockReturnValue(false);
        fixture.rightClick();
        expect(fixture.clipboard.readText).toHaveBeenCalledOnce();
    });

    it("reports clipboard read errors and ignores empty clipboard text", async () => {
        const fixture = setup();
        fixture.clipboard.readText.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce("");
        fixture.rightClick();
        await vi.waitFor(() => expect(fixture.clipboard.onError).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining("unavailable"),
        })));
        fixture.rightClick();
        await vi.waitFor(() => expect(fixture.clipboard.readText).toHaveBeenCalledTimes(2));
        expect(fixture.terminal.paste).not.toHaveBeenCalled();
    });

    it("does not replay overlapping paste requests or complete paste after disposal", async () => {
        const fixture = setup();
        const read = deferred<string>();
        fixture.clipboard.readText.mockReturnValue(read.promise);
        fixture.rightClick();
        fixture.rightClick();
        expect(fixture.clipboard.readText).toHaveBeenCalledOnce();
        expect(fixture.clipboard.onError).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining("already in progress"),
        }));
        fixture.installed.dispose();
        read.resolve("cancelled");
        await read.promise;
        expect(fixture.terminal.paste).not.toHaveBeenCalled();
        fixture.rightClick();
        expect(fixture.clipboard.readText).toHaveBeenCalledOnce();
    });
});
