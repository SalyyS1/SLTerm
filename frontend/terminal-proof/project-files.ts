export type ProjectRequest = (method: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type ProjectEntry = { name: string; path: string; kind: "file" | "directory" | "symlink"; total_bytes: number };
export type ProjectFile = { text: string; revision: string };
export const PROJECT_CHUNK_BYTES = 16 * 1024;
export const PROJECT_MAX_BYTES = 8 * 1024 * 1024;

function integer(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Phản hồi ${label} không hợp lệ.`);
    return value;
}

function revision(value: unknown): string {
    if (typeof value !== "string" || !value) throw new Error("Thiếu phiên bản tệp trong phản hồi.");
    return value;
}

export function projectError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function isRevisionConflict(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "RevisionConflict") ||
        /RevisionConflict/.test(projectError(error));
}

export async function listProjectDirectory(request: ProjectRequest, root: string, path: string, cursor = 0) {
    const result = await request("files.list", { root, path, cursor });
    if (!Array.isArray(result.entries)) throw new Error("Danh sách thư mục không hợp lệ.");
    const entries: ProjectEntry[] = result.entries.map((entry) => {
        if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || typeof entry.path !== "string" ||
            !["file", "directory", "symlink"].includes(entry.kind)) throw new Error("Mục thư mục không hợp lệ.");
        return { name: entry.name, path: entry.path, kind: entry.kind, total_bytes: integer(entry.total_bytes, "kích thước") };
    });
    const next = result.next_cursor == null ? null : integer(result.next_cursor, "con trỏ");
    if (next !== null && next <= cursor) throw new Error("Con trỏ thư mục không tiến lên.");
    return { entries, next };
}

function decodeChunk(value: unknown): Uint8Array {
    if (typeof value !== "string" || value.length > Math.ceil(PROJECT_CHUNK_BYTES / 3) * 4) throw new Error("Khối tệp vượt quá 16 KiB.");
    const binary = atob(value);
    if (binary.length > PROJECT_CHUNK_BYTES) throw new Error("Khối tệp vượt quá 16 KiB.");
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function readProjectFile(request: ProjectRequest, root: string, path: string, cancelled = () => false): Promise<ProjectFile> {
    let offset = 0;
    let expectedRevision: string | undefined;
    let total: number | undefined;
    let bytes: Uint8Array | undefined;
    for (;;) {
        if (cancelled()) throw new Error("Đã hủy đọc tệp.");
        const result = await request("files.read", { root, path, offset });
        if (cancelled()) throw new Error("Đã hủy đọc tệp.");
        const nextTotal = integer(result.total_bytes, "kích thước");
        if (nextTotal > PROJECT_MAX_BYTES) throw new Error("Trình soạn thảo hỗ trợ tệp tối đa 8 MiB.");
        const nextRevision = revision(result.revision);
        if ((expectedRevision !== undefined && expectedRevision !== nextRevision) || (total !== undefined && total !== nextTotal)) {
            throw new Error("Tệp đã thay đổi khi đang đọc. Hãy mở lại để đọc phiên bản nhất quán.");
        }
        if (integer(result.offset, "vị trí đọc") !== offset) throw new Error("Khối tệp không đúng thứ tự.");
        expectedRevision = nextRevision;
        total = nextTotal;
        bytes ??= new Uint8Array(total);
        const chunk = decodeChunk(result.data);
        if (offset + chunk.length > total || (chunk.length === 0 && offset < total)) throw new Error("Khối tệp thiếu hoặc vượt kích thước.");
        bytes.set(chunk, offset);
        offset += chunk.length;
        if (typeof result.eof !== "boolean" || result.eof !== (offset === total)) throw new Error("Điểm kết thúc tệp không hợp lệ.");
        if (result.eof) {
            const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
            if (text.includes("\0")) throw new Error("Tệp nhị phân không thể sửa trong trình soạn thảo văn bản.");
            return { text, revision: expectedRevision };
        }
    }
}

export async function writeProjectFile(request: ProjectRequest, root: string, path: string, text: string, ifMatch: string, cancelled = () => false): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > PROJECT_MAX_BYTES) throw new Error("Nội dung vượt giới hạn 8 MiB; thay đổi vẫn được giữ trong bộ đệm.");
    // Identity exists before admission so a lost begin reply can still be canceled.
    const upload = crypto.randomUUID();
    try {
        if (cancelled()) throw new Error("Đã hủy lưu tệp.");
        const result = await request("files.save.begin", { root, path, if_match: ifMatch, total_bytes: bytes.length, upload_id: upload });
        if (result.upload_id !== undefined && result.upload_id !== upload) throw new Error("Mã phiên lưu tệp không khớp yêu cầu.");
        for (let offset = 0; offset < bytes.length; offset += PROJECT_CHUNK_BYTES) {
            if (cancelled()) throw new Error("Đã hủy lưu tệp.");
            const chunk = bytes.subarray(offset, offset + PROJECT_CHUNK_BYTES);
            const data = btoa(String.fromCharCode(...chunk));
            await request("files.save.chunk", { upload_id: upload, offset, data });
        }
        if (cancelled()) throw new Error("Đã hủy lưu tệp.");
        const committed = await request("files.save.commit", { upload_id: upload });
        return revision(committed.revision);
    } catch (error) {
        await request("files.save.cancel", { upload_id: upload }).catch(() => undefined);
        throw error;
    }
}
