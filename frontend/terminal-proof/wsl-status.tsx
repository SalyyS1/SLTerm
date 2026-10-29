import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./workspace-icons";
import "./wsl-status.css";

type WslStatus = {
    available: boolean;
    executable: string;
    status: string;
    error: string;
    distros: string[];
    setup_required: boolean;
};

export function WslStatus() {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<WslStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const refresh = async () => {
        setBusy(true); setError(null);
        try { setStatus(await invoke<WslStatus>("proof_wsl_status")); }
        catch (failure) { setError(String(failure)); }
        finally { setBusy(false); }
    };
    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && !status && !busy) void refresh();
    };
    return <div className="wsl-status">
        <button className="button button-ghost" aria-expanded={open} onClick={toggle} title="Kiểm tra WSL2 (chỉ đọc)">
            <Icon name="terminal" /><span>WSL2</span>
        </button>
        {open && <div className="wsl-popover" role="dialog" aria-label="Trạng thái WSL2">
            <div className="wsl-popover-heading"><strong>WSL2</strong><button className="icon-button" aria-label="Đóng trạng thái WSL2" onClick={() => setOpen(false)}><Icon name="close" size={14} /></button></div>
            {busy && <p role="status">Đang kiểm tra…</p>}
            {error && <p className="dialog-error" role="alert">{error}</p>}
            {status && <>
                <p className="wsl-state" data-state={status.available ? (status.setup_required ? "empty" : "ready") : "missing"}>
                    {status.available ? status.setup_required ? "WSL có sẵn nhưng chưa có distro." : "WSL sẵn sàng." : "Không gọi được WSL trên máy này."}
                </p>
                {status.distros.length > 0 && <ul className="wsl-distros">{status.distros.map((distro) => <li key={distro}>{distro}</li>)}</ul>}
                {status.status && <pre className="wsl-output">{status.status}</pre>}
                {status.error && <p className="field-hint">{status.error}</p>}
                {status.setup_required && <p className="field-hint">Cài distro hoặc thay đổi WSL phải thực hiện qua wizard có consent; SLTerm chưa tự cài đặt.</p>}
                <button className="button" disabled={busy} onClick={() => void refresh()}>Kiểm tra lại</button>
            </>}
        </div>}
    </div>;
}

