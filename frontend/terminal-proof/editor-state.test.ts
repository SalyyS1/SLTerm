import { describe, expect, it, vi } from "vitest";
import { EditorState, documentDirty } from "./editor-state";
import { PROJECT_CHUNK_BYTES, type ProjectRequest } from "./project-files";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const conflict = () => Object.assign(new Error("RevisionConflict"), { code: "RevisionConflict" });
function fixture() {
    let disk = "original";
    let revision = "r1";
    const uploads = new Map<string, { text: Uint8Array[]; revision: string }>();
    let next = 0;
    const request = vi.fn<ProjectRequest>(async (method, args) => {
        if (method === "files.read") {
            const bytes = new TextEncoder().encode(disk);
            const offset = Number(args.offset);
            const data = btoa(String.fromCharCode(...bytes.subarray(offset, offset + PROJECT_CHUNK_BYTES)));
            return { data, offset, total_bytes: bytes.length, revision, eof: offset + PROJECT_CHUNK_BYTES >= bytes.length };
        }
        if (method === "files.save.begin") {
            if (args.if_match !== revision) throw conflict();
            const upload_id = typeof args.upload_id === "string" ? args.upload_id : String(++next);
            uploads.set(upload_id, { text: [], revision });
            return { upload_id };
        }
        if (method === "files.save.cancel") { uploads.delete(String(args.upload_id)); return {}; }
        const upload = uploads.get(String(args.upload_id))!;
        if (method === "files.save.chunk") { upload.text.push(Uint8Array.from(atob(String(args.data)), (char) => char.charCodeAt(0))); return {}; }
        if (method === "files.save.commit") {
            if (upload.revision !== revision) throw conflict();
            const bytes = new Uint8Array(upload.text.reduce((size, chunk) => size + chunk.length, 0));
            let offset = 0;
            for (const chunk of upload.text) { bytes.set(chunk, offset); offset += chunk.length; }
            disk = new TextDecoder().decode(bytes);
            revision = `saved-${++next}`;
            uploads.delete(String(args.upload_id));
            return { revision };
        }
        throw new Error(method);
    });
    return { request, external(text: string, nextRevision: string) { disk = text; revision = nextRevision; }, disk: () => disk, revision: () => revision };
}
const document = (state: EditorState) => state.getSnapshot().documents[0];

describe("project editor document lifetimes", () => {
    it("retains edits typed during a save and uses the committed revision on the next save", async () => {
        const files = fixture();
        const commit = deferred<void>();
        const entered = deferred<void>();
        let delayed = true;
        const request: ProjectRequest = async (method, args) => {
            if (method === "files.save.commit" && delayed) { entered.resolve(); await commit.promise; delayed = false; }
            return files.request(method, args);
        };
        const state = new EditorState("root", request);
        await state.open("file"); state.edit("file", "first");
        const save = state.save("file");
        await entered.promise;
        state.edit("file", "typed during save");
        expect(state.hasUnsaved()).toBe(true);
        expect(state.remove("file", true)).toBe(false);
        commit.resolve(); expect(await save).toBe(true);
        expect(files.disk()).toBe("first");
        expect(document(state).text).toBe("typed during save");
        expect(documentDirty(document(state))).toBe(true);
        const committed = document(state).revision;
        expect(await state.save("file")).toBe(true);
        expect(files.disk()).toBe("typed during save");
        expect(files.request.mock.calls.filter(([method]) => method === "files.save.begin").at(-1)?.[1].if_match).toBe(committed);
        expect(state.hasUnsaved()).toBe(false);
    });
    it("serializes duplicate save requests for the same document", async () => {
        const files = fixture(); const gate = deferred<Record<string, unknown>>();
        const request: ProjectRequest = (method, args) => method === "files.save.begin" ? gate.promise : files.request(method, args);
        const state = new EditorState("root", request); await state.open("file"); state.edit("file", "new");
        const first = state.save("file");
        expect(state.save("file")).toBe(first);
        gate.reject(new Error("write denied"));
        expect(await first).toBe(false);
        expect(document(state).error).toBe("write denied");
        expect(documentDirty(document(state))).toBe(true);
    });
    it("ignores a delayed read from a closed and reopened tab", async () => {
        const files = fixture(); const delayed = deferred<Record<string, unknown>>(); let count = 0;
        const state = new EditorState("root", (method, args) => method === "files.read" && count++ === 0 ? delayed.promise : files.request(method, args));
        const first = state.open("file");
        expect(state.remove("file")).toBe(true);
        files.external("reopened", "r2"); await state.open("file");
        delayed.resolve({ data: btoa("stale"), offset: 0, total_bytes: 5, revision: "old", eof: true }); await first;
        expect(document(state).text).toBe("reopened");
        expect(document(state).revision).toBe("r2");
        expect(document(state).error).toBeNull();
    });
    it("keeps the unsaved buffer and exposes the current disk version after conflict", async () => {
        const files = fixture(); const state = new EditorState("root", files.request);
        await state.open("file"); state.edit("file", "my buffer"); files.external("another program", "r2");
        expect(await state.save("file")).toBe(false);
        expect(document(state).text).toBe("my buffer");
        expect(document(state).conflict).toEqual({ text: "another program", revision: "r2" });
        expect(document(state).diff).toBe(true);
        expect(documentDirty(document(state))).toBe(true);
        expect(files.disk()).toBe("another program");
    });
    it("reads a fresh revision for explicit overwrite, then still checks it at commit", async () => {
        const files = fixture(); let changeOnCommit = false;
        const state = new EditorState("root", async (method, args) => {
            if (method === "files.save.commit" && changeOnCommit) files.external("changed again", "r4");
            return files.request(method, args);
        });
        await state.open("file"); state.edit("file", "mine"); files.external("external", "r2"); await state.save("file");
        files.external("newest before overwrite", "r3"); changeOnCommit = true;
        expect(await state.save("file", true)).toBe(false);
        const begin = files.request.mock.calls.filter(([method]) => method === "files.save.begin").at(-1)!;
        expect(begin[1].if_match).toBe("r3");
        expect(files.disk()).toBe("changed again");
        expect(document(state).text).toBe("mine");
        expect(documentDirty(document(state))).toBe(true);
        expect(document(state).conflict?.revision).toBe("r4");
    });
    it("finishes an explicit overwrite after reading the latest revision", async () => {
        const files = fixture(); const state = new EditorState("root", files.request);
        await state.open("file"); state.edit("file", "mine"); files.external("external", "r2"); await state.save("file");
        files.external("even newer", "r3"); expect(await state.save("file", true)).toBe(true);
        expect(files.disk()).toBe("mine"); expect(state.hasUnsaved()).toBe(false); expect(document(state).conflict).toBeNull();
    });
    it("preserves edits entered while reload was reading", async () => {
        const files = fixture(); const read = deferred<Record<string, unknown>>(); let delay = false;
        const state = new EditorState("root", (method, args) => method === "files.read" && delay ? read.promise : files.request(method, args));
        await state.open("file"); delay = true;
        const reload = state.reload("file"); state.edit("file", "new edit");
        read.resolve({ data: btoa("disk"), offset: 0, total_bytes: 4, revision: "r2", eof: true });
        expect(await reload).toBe(false); expect(document(state).text).toBe("new edit"); expect(document(state).error).toContain("thay đổi mới");
    });
    it("does not apply an older compare response after a newer reload", async () => {
        const files = fixture(); const firstRead = deferred<Record<string, unknown>>(); let delayed = false;
        const state = new EditorState("root", (method, args) => method === "files.read" && delayed ? (delayed = false, firstRead.promise) : files.request(method, args));
        await state.open("file"); delayed = true; const compare = state.compareDisk("file");
        files.external("latest", "r2"); expect(await state.reload("file")).toBe(true);
        firstRead.resolve({ data: btoa("stale"), offset: 0, total_bytes: 5, revision: "old", eof: true });
        expect(await compare).toBe(false); expect(document(state).revision).toBe("r2"); expect(document(state).conflict).toBeNull();
    });
});
