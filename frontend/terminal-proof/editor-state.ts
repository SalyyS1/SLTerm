import { isRevisionConflict, projectError, readProjectFile, writeProjectFile, type ProjectFile, type ProjectRequest } from "./project-files";

export type EditorDocument = {
    id: number;
    path: string;
    text: string;
    savedText: string;
    revision: string;
    loading: boolean;
    saving: boolean;
    error: string | null;
    conflict: ProjectFile | null;
    diff: boolean;
};
export type EditorSnapshot = { documents: EditorDocument[]; active: string | null };
export const documentDirty = (document: EditorDocument) => document.text !== document.savedText;

/** Owns document lifetimes so delayed replies cannot replace a reopened tab or newer edits. */
export class EditorState {
    private snapshot: EditorSnapshot = { documents: [], active: null };
    private listeners = new Set<() => void>();
    private pendingSaves = new Map<number, Promise<boolean>>();
    private diskReads = new Map<number, number>();
    private nextId = 0;
    private disposed = false;
    constructor(readonly root: string, private request: ProjectRequest) {}
    activate() { this.disposed = false; }
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    getSnapshot = () => this.snapshot;
    hasUnsaved = () => this.snapshot.documents.some((document) => documentDirty(document) || document.saving);
    private publish(documents = this.snapshot.documents, active = this.snapshot.active) {
        if (this.disposed) return;
        this.snapshot = { documents, active };
        this.listeners.forEach((listener) => listener());
    }
    private find(path: string) { return this.snapshot.documents.find((document) => document.path === path); }
    private patch(id: number, patch: Partial<EditorDocument>) {
        this.publish(this.snapshot.documents.map((document) => document.id === id ? { ...document, ...patch } : document));
    }
    select = (path: string) => { if (this.find(path)) this.publish(undefined, path); };
    edit = (path: string, text: string) => {
        const document = this.find(path);
        if (document && !document.loading) this.patch(document.id, { text });
    };
    async open(path: string) {
        if (this.find(path)) { this.select(path); return; }
        const id = ++this.nextId;
        this.publish([...this.snapshot.documents, { id, path, text: "", savedText: "", revision: "", loading: true, saving: false, error: null, conflict: null, diff: false }], path);
        try {
            const file = await readProjectFile(this.request, this.root, path, () => this.disposed || this.find(path)?.id !== id);
            this.patch(id, { text: file.text, savedText: file.text, revision: file.revision, loading: false });
        } catch (error) { this.patch(id, { loading: false, error: projectError(error) }); }
    }
    remove(path: string, discard = false): boolean {
        const document = this.find(path);
        if (!document || document.saving || (!discard && documentDirty(document))) return false;
        const documents = this.snapshot.documents.filter((item) => item.id !== document.id);
        this.publish(documents, this.snapshot.active === path ? documents.at(-1)?.path ?? null : this.snapshot.active);
        return true;
    }
    toggleDiff(path: string) { const document = this.find(path); if (document) this.patch(document.id, { diff: !document.diff }); }
    async compareDisk(path: string): Promise<boolean> {
        const document = this.find(path);
        if (!document || document.loading || document.saving) return false;
        const generation = (this.diskReads.get(document.id) ?? 0) + 1;
        this.diskReads.set(document.id, generation);
        const cancelled = () => this.disposed || this.find(path)?.id !== document.id || this.diskReads.get(document.id) !== generation;
        try {
            const file = await readProjectFile(this.request, this.root, path, cancelled);
            this.patch(document.id, { conflict: file, diff: true, error: null });
            return true;
        } catch (error) { if (!cancelled()) this.patch(document.id, { error: projectError(error) }); return false; }
    }
    async reload(path: string): Promise<boolean> {
        const document = this.find(path);
        if (!document || document.loading || document.saving) return false;
        const generation = (this.diskReads.get(document.id) ?? 0) + 1;
        this.diskReads.set(document.id, generation);
        const cancelled = () => this.disposed || this.find(path)?.id !== document.id || this.diskReads.get(document.id) !== generation;
        try {
            const file = await readProjectFile(this.request, this.root, path, cancelled);
            // Edits made during the read remain visible and require another explicit decision.
            if (this.find(path)?.text !== document.text) throw new Error("Có thay đổi mới trong lúc tải lại. Bộ đệm được giữ; hãy thử lại.");
            this.patch(document.id, { text: file.text, savedText: file.text, revision: file.revision, conflict: null, error: null });
            return true;
        } catch (error) { if (!cancelled()) this.patch(document.id, { error: projectError(error) }); return false; }
    }
    save(path: string, overwrite = false): Promise<boolean> {
        const document = this.find(path);
        if (!document || document.loading || !document.revision) return Promise.resolve(false);
        const pending = this.pendingSaves.get(document.id);
        if (pending) return pending;
        if (!overwrite && !documentDirty(document)) return Promise.resolve(true);
        const operation = this.performSave(document, overwrite).finally(() => this.pendingSaves.delete(document.id));
        this.pendingSaves.set(document.id, operation);
        return operation;
    }
    private async performSave(document: EditorDocument, overwrite: boolean): Promise<boolean> {
        this.diskReads.set(document.id, (this.diskReads.get(document.id) ?? 0) + 1);
        this.patch(document.id, { saving: true, error: null });
        const cancelled = () => this.disposed || this.find(document.path)?.id !== document.id;
        try {
            // Explicit overwrite still compares against a newly read revision at commit.
            const expected = overwrite ? (await readProjectFile(this.request, this.root, document.path, cancelled)).revision : document.revision;
            const revision = await writeProjectFile(this.request, this.root, document.path, document.text, expected, cancelled);
            this.patch(document.id, { revision, savedText: document.text, conflict: null });
            return true;
        } catch (error) {
            this.patch(document.id, { error: isRevisionConflict(error) ? "Tệp trên đĩa đã thay đổi. Bộ đệm chưa được lưu; chọn so sánh, tải lại hoặc ghi đè." : projectError(error) });
            if (isRevisionConflict(error) && !cancelled()) {
                try {
                    const file = await readProjectFile(this.request, this.root, document.path, cancelled);
                    this.patch(document.id, { conflict: file, diff: true });
                } catch (readError) { this.patch(document.id, { error: `Xung đột phiên bản; không đọc được bản trên đĩa: ${projectError(readError)}` }); }
            }
            return false;
        } finally { this.patch(document.id, { saving: false }); }
    }
    async saveAll(): Promise<boolean> {
        let success = true;
        for (const document of this.snapshot.documents) {
            if (documentDirty(document) || document.saving) success = (await this.save(document.path)) && success;
        }
        return success && !this.hasUnsaved();
    }
    dispose() { this.disposed = true; this.listeners.clear(); }
}
