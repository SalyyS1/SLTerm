import { describe, expect, it, vi } from "vitest";
import { listProjectDirectory, PROJECT_CHUNK_BYTES, PROJECT_MAX_BYTES, readProjectFile, writeProjectFile, type ProjectRequest } from "./project-files";

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const encode = (text: string) => new TextEncoder().encode(text);
const readResponse = (bytes: Uint8Array, offset: number, revision = "r1") => ({
    data: base64(bytes.subarray(offset, offset + PROJECT_CHUNK_BYTES)), offset, total_bytes: bytes.length,
    revision, eof: offset + PROJECT_CHUNK_BYTES >= bytes.length,
});

describe("project file transport", () => {
    it("decodes UTF-8 only after bounded ordered chunks, including split code points and BOM", async () => {
        const text = "\uFEFF" + "x".repeat(PROJECT_CHUNK_BYTES - 4) + "🦊 tiếng Việt" + "y".repeat(PROJECT_CHUNK_BYTES);
        const bytes = encode(text);
        const request = vi.fn<ProjectRequest>(async (_method, args) => readResponse(bytes, Number(args.offset)));
        expect(await readProjectFile(request, "C:/project", "src/file.ts")).toEqual({ text, revision: "r1" });
        expect(request.mock.calls.map(([method, args]) => [method, args.offset])).toEqual([
            ["files.read", 0], ["files.read", PROJECT_CHUNK_BYTES], ["files.read", PROJECT_CHUNK_BYTES * 2],
        ]);
    });
    it("rejects a changed revision before combining file versions", async () => {
        const bytes = encode("x".repeat(PROJECT_CHUNK_BYTES + 1));
        const request: ProjectRequest = async (_method, args) => readResponse(bytes, Number(args.offset), args.offset === 0 ? "old" : "new");
        await expect(readProjectFile(request, "root", "file")).rejects.toThrow("đã thay đổi");
    });
    it("rejects oversized files before reading further chunks", async () => {
        const request = vi.fn<ProjectRequest>(async () => ({ total_bytes: PROJECT_MAX_BYTES + 1 }));
        await expect(readProjectFile(request, "root", "file")).rejects.toThrow("8 MiB");
        expect(request).toHaveBeenCalledTimes(1);
    });
    it("rejects mismatched offsets, premature EOF and invalid text", async () => {
        for (const response of [
            { ...readResponse(encode("hi"), 0), offset: 1 },
            { ...readResponse(encode("hi"), 0), eof: false },
            readResponse(new Uint8Array([0xff]), 0),
            readResponse(new Uint8Array([0]), 0),
        ]) {
            await expect(readProjectFile(async () => response, "root", "file")).rejects.toThrow();
        }
    });
    it("uploads UTF-8 bytes in 16 KiB chunks with a revision check", async () => {
        const text = "🦊".repeat(10000);
        const chunks: Uint8Array[] = [];
        const request = vi.fn<ProjectRequest>(async (method, args) => {
            if (method === "files.save.begin") return { upload_id: args.upload_id };
            if (method === "files.save.chunk") { chunks.push(Uint8Array.from(atob(String(args.data)), (char) => char.charCodeAt(0))); return {}; }
            return { revision: "r2" };
        });
        expect(await writeProjectFile(request, "root", "file", text, "r1")).toBe("r2");
        const upload = request.mock.calls[0][1].upload_id;
        expect(upload).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
        expect(request.mock.calls[0]).toEqual(["files.save.begin", { root: "root", path: "file", if_match: "r1", total_bytes: 40000, upload_id: upload }]);
        expect(request.mock.calls.slice(1).every(([, args]) => args.upload_id === upload)).toBe(true);
        expect(chunks.map((chunk) => chunk.length)).toEqual([PROJECT_CHUNK_BYTES, PROJECT_CHUNK_BYTES, 40000 - PROJECT_CHUNK_BYTES * 2]);
        const combined = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
        let position = 0;
        for (const chunk of chunks) { combined.set(chunk, position); position += chunk.length; }
        expect(new TextDecoder().decode(combined)).toBe(text);
    });
    it("cancels an upload on write failure and never commits partial data", async () => {
        const request = vi.fn<ProjectRequest>(async (method, args) => {
            if (method === "files.save.begin") return { upload_id: args.upload_id };
            if (method === "files.save.chunk") throw new Error("disk full");
            return {};
        });
        await expect(writeProjectFile(request, "root", "file", "new", "r1")).rejects.toThrow("disk full");
        expect(request.mock.calls.map(([method]) => method)).toEqual(["files.save.begin", "files.save.chunk", "files.save.cancel"]);
    });
    it("cancels the known upload when admission succeeds but its reply is lost", async () => {
        const reserved = new Set<string>();
        const request = vi.fn<ProjectRequest>(async (method, args) => {
            if (method === "files.save.begin") {
                reserved.add(String(args.upload_id));
                throw new Error("Timed out: files.save.begin; completion is unknown");
            }
            if (method === "files.save.cancel") reserved.delete(String(args.upload_id));
            return {};
        });
        await expect(writeProjectFile(request, "root", "file", "new", "r1")).rejects.toThrow("completion is unknown");
        expect(request.mock.calls.map(([method]) => method)).toEqual(["files.save.begin", "files.save.cancel"]);
        expect(request.mock.calls[1][1].upload_id).toBe(request.mock.calls[0][1].upload_id);
        expect(reserved.size).toBe(0);
    });
    it("rejects a mismatched admission ID and only cancels the client-owned upload", async () => {
        const request = vi.fn<ProjectRequest>(async (method) => method === "files.save.begin" ? { upload_id: "another-operation" } : {});
        await expect(writeProjectFile(request, "root", "file", "new", "r1")).rejects.toThrow("không khớp");
        expect(request.mock.calls.map(([method]) => method)).toEqual(["files.save.begin", "files.save.cancel"]);
        expect(request.mock.calls[1][1].upload_id).toBe(request.mock.calls[0][1].upload_id);
        expect(request.mock.calls[1][1].upload_id).not.toBe("another-operation");
    });
    it("uses its client-known upload even when the success reply omits the ID", async () => {
        const request = vi.fn<ProjectRequest>(async (method) => method === "files.save.commit" ? { revision: "r2" } : {});
        expect(await writeProjectFile(request, "root", "file", "new", "r1")).toBe("r2");
        const upload = request.mock.calls[0][1].upload_id;
        expect(request.mock.calls.slice(1).every(([, args]) => args.upload_id === upload)).toBe(true);
    });
    it("stops a cancelled read before requesting the next chunk", async () => {
        let cancelled = false;
        const request = vi.fn<ProjectRequest>(async () => { cancelled = true; return readResponse(encode("text"), 0); });
        await expect(readProjectFile(request, "root", "file", () => cancelled)).rejects.toThrow("hủy");
        expect(request).toHaveBeenCalledTimes(1);
    });
    it("rejects a repeated directory cursor instead of looping", async () => {
        await expect(listProjectDirectory(async () => ({ entries: [], next_cursor: 5 }), "root", "", 5)).rejects.toThrow("không tiến lên");
    });
});
