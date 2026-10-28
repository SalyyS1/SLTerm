/** Windows cwd is passed as data to CreateProcess, never interpreted as shell text. */
export function workspacePath(value: string): string {
    const cwd = value.trim();
    const drive = /^[a-z]:[\\/]/i.test(cwd);
    const unc = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(cwd);
    if (!cwd || cwd.includes("\0") || (!drive && !unc)) {
        throw new Error("Nhập đường dẫn Windows tuyệt đối, ví dụ C:\\Projects\\SLTerm hoặc \\\\server\\share.");
    }
    return cwd;
}
