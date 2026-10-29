import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./workspace-icons";

export type DialogSpec = {
    kind?: "quit";
    title: string;
    body: ReactNode;
    accept?: string;
    danger?: boolean;
    fields?: { name: string; label: string; value: string; hint?: string }[];
    submit?: (values: Record<string, string>) => void | Promise<void>;
    actions?: { label: string; danger?: boolean; run: () => void | Promise<void> }[];
};

export function WorkspaceDialog({ spec, close }: { spec: DialogSpec; close: () => void }) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const working = useRef(false);
    const perform = async (action: () => void | Promise<void>) => {
        if (working.current) return;
        working.current = true; setBusy(true); setError(null);
        try { await action(); close(); }
        catch (failure) { setError(String(failure)); }
        finally { working.current = false; setBusy(false); }
    };
    useEffect(() => {
        ref.current?.showModal();
    }, []);
    return (
        <dialog
            className="app-dialog"
            ref={ref}
            aria-labelledby={titleId}
            onCancel={(event) => {
                event.preventDefault();
                if (!working.current) close();
            }}
        >
            <form
                onSubmit={async (event) => {
                    event.preventDefault();
                    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
                    await perform(() => spec.submit?.(values));
                }}
            >
                <div className="dialog-heading">
                    <h2 id={titleId}>{spec.title}</h2>
                    <button
                        type="button"
                        className="icon-button"
                        aria-label="Đóng hộp thoại"
                        disabled={busy}
                        onClick={close}
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="dialog-body">
                    {spec.body}
                    {spec.fields?.map((field) => (
                        <div className="form-field" key={field.name}>
                            <label htmlFor={titleId + field.name}>{field.label}</label>
                            <input
                                id={titleId + field.name}
                                name={field.name}
                                defaultValue={field.value}
                                required
                                disabled={busy}
                                maxLength={field.name === "cwd" ? 32767 : 128}
                                autoComplete="off"
                            />
                            {field.hint && <span className="field-hint">{field.hint}</span>}
                        </div>
                    ))}
                    {error && (
                        <p className="dialog-error" role="alert">
                            {error}
                        </p>
                    )}
                </div>
                <div className="dialog-actions">
                    {spec.actions?.map((action) => <button key={action.label} type="button" disabled={busy}
                        className={"button " + (action.danger ? "button-danger" : "button-primary")}
                        onClick={() => { void perform(action.run); }}>{action.label}</button>)}
                    <button type="button" className="button button-ghost" disabled={busy} onClick={close}>
                        {spec.submit ? "Hủy" : "Đóng"}
                    </button>
                    {spec.submit && (
                        <button
                            type="submit"
                            className={"button " + (spec.danger ? "button-danger" : "button-primary")}
                            disabled={busy}
                        >
                            {busy ? "Đang xử lý…" : (spec.accept ?? "Lưu")}
                        </button>
                    )}
                </div>
            </form>
        </dialog>
    );
}

export const shortcuts = [
    ["Workspace mới", "Ctrl Shift T"],
    ["Chia trái / phải", "Ctrl Shift D"],
    ["Chia trên / dưới", "Ctrl Shift E"],
    ["Đóng ô hiện tại", "Ctrl Shift W"],
    ["Phóng to / khôi phục ô", "Ctrl Shift Enter"],
    ["Workspace kế tiếp", "Ctrl Tab"],
    ["Tìm trong terminal", "Ctrl F"],
    ["Cỡ chữ", "Ctrl + / − / 0"],
    ["Dán", "Chuột phải / Ctrl V"],
    ["Copy vùng chọn; lần tiếp hủy tác vụ", "Ctrl C"],
];
