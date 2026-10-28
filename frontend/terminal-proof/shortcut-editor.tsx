import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
    defaultShortcuts, displayShortcut, shortcutActions, shortcutFromEvent, shortcutLabels, validateShortcutBindings,
    type ShortcutAction, type ShortcutBindings,
} from "./workspace-shortcuts";
import "./shortcut-editor.css";

export function ShortcutEditor({ value, onChange }: { value: ShortcutBindings; onChange: (next: ShortcutBindings) => void }) {
    const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
    const [feedback, setFeedback] = useState<{ action: ShortcutAction; message: string } | null>(null);
    const buttons = useRef(new Map<ShortcutAction, HTMLButtonElement>());
    const id = useId();
    const finish = (action: ShortcutAction) => {
        setCapturing(null);
        setFeedback(null);
        buttons.current.get(action)?.focus();
    };
    const update = (action: ShortcutAction, binding: string | null) => {
        const next = { ...value, [action]: binding };
        const issue = validateShortcutBindings(next).find((issue) => issue.action === action || issue.conflictsWith === action);
        if (issue) {
            const other = issue.action === action ? issue.conflictsWith : issue.action;
            setFeedback({ action, message: other ? `Trùng với “${shortcutLabels[other]}”. Hãy xóa hoặc đổi phím đó trước.` : issue.message });
            return;
        }
        onChange(next);
        finish(action);
    };
    const capture = (event: KeyboardEvent<HTMLButtonElement>, action: ShortcutAction) => {
        if (capturing !== action) return;
        // Leave composition to the IME; no candidate is recorded until it finishes.
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.nativeEvent.getModifierState("AltGraph")) return;
        event.stopPropagation();
        event.preventDefault();
        if (event.repeat) return;
        if (event.key === "Escape") { finish(action); return; }
        if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
            update(action, null);
            return;
        }
        const binding = shortcutFromEvent(event.nativeEvent);
        if (binding) update(action, binding);
    };
    const existingIssues = validateShortcutBindings(value);
    return (
        <section className="shortcut-editor" aria-label="Cài đặt phím tắt">
            <p className="shortcut-editor-hint" id={id + "-help"}>
                Chọn tổ hợp để ghi phím mới. Esc hủy; Backspace hoặc Delete xóa gán. Các phím copy, paste và ngắt process luôn dành cho terminal.
            </p>
            <div className="shortcut-editor-actions">
                <button type="button" className="button button-ghost" onClick={() => {
                    onChange({ ...defaultShortcuts }); setCapturing(null); setFeedback(null);
                }}>Khôi phục tất cả phím mặc định</button>
            </div>
            {shortcutActions.map((action) => {
                const active = capturing === action;
                const error = feedback?.action === action ? feedback.message : existingIssues.find((issue) => issue.action === action)?.message;
                const labelId = `${id}-${action}`;
                return (
                    <div className="shortcut-editor-row" key={action}>
                        <span className="shortcut-editor-label" id={labelId}>{shortcutLabels[action]}</span>
                        <button
                            type="button" className={"shortcut-capture" + (active ? " is-capturing" : "")}
                            data-shortcut-capture={active ? "true" : undefined}
                            ref={(element) => { if (element) buttons.current.set(action, element); else buttons.current.delete(action); }}
                            aria-label={`${shortcutLabels[action]}: ${active ? "Đang ghi phím" : displayShortcut(value[action])}. Chọn để đổi.`}
                            aria-describedby={`${id}-help${error ? ` ${labelId}-error` : ""}`}
                            aria-pressed={active} aria-invalid={!!error}
                            onClick={() => { setCapturing(action); setFeedback(null); }}
                            onKeyDown={(event) => capture(event, action)}
                            onBlur={() => { if (active) { setCapturing(null); setFeedback(null); } }}
                        ><kbd>{active ? "Nhấn tổ hợp phím…" : displayShortcut(value[action])}</kbd></button>
                        <button type="button" className="shortcut-reset" aria-label={`Khôi phục phím mặc định: ${shortcutLabels[action]}`}
                            disabled={value[action] === defaultShortcuts[action]} onClick={() => update(action, defaultShortcuts[action])}>Mặc định</button>
                        <button type="button" className="shortcut-reset" aria-label={`Xóa gán: ${shortcutLabels[action]}`}
                            disabled={value[action] === null} onClick={() => update(action, null)}>Xóa</button>
                        {error && <p className="shortcut-editor-error" role="alert" id={labelId + "-error"}>{error}</p>}
                    </div>
                );
            })}
            <p className="shortcut-editor-status" role="status" aria-live="polite">
                {capturing ? `Đang ghi phím cho ${shortcutLabels[capturing]}.` : "Thay đổi sẽ áp dụng khi lưu cài đặt."}
            </p>
        </section>
    );
}
