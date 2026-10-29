import { appearancePresets } from "./appearance-presets";
import { normalizeAppearance, type AppearanceSettings } from "./appearance-settings";

/** A selected legacy database is a snapshot. This parser never opens a path. */
export const MAX_LEGACY_SQLITE_BYTES = 64 * 1024 * 1024;
export const MAX_LEGACY_SQLITE_ROWS = 10_000;
const SQLITE_HEADER_BYTES = 100;
const SQLITE_WAL_HEADER_BYTES = 32;
const SQLITE_WAL_FRAME_HEADER_BYTES = 24;
const SQLITE_WAL_VERSION = 3_007_000;
const SQLITE_MAGIC = "SQLite format 3\0";

export type LegacySqliteBytes = Uint8Array | ArrayBuffer;
export type LegacySqliteSnapshot = {
    database: LegacySqliteBytes;
    /** Optional sidecar bytes. The caller must select this explicitly. */
    wal?: LegacySqliteBytes;
};
export type LegacySqliteInput = LegacySqliteBytes | LegacySqliteSnapshot;

export type LegacySqliteReceipt = {
    action: "preview-only";
    sourceName: string;
    databaseBytes: number;
    walBytes: number;
    pageSize: number;
    databasePages: number;
    walFrames: number;
    walAppliedFrames: number;
    schemaTables: string[];
    schemaRecognized: boolean;
    sourceMutated: false;
    readOnly: true;
};

export type LegacySqliteImportPreview = {
    sourceName: string;
    supported: boolean;
    appearance: Partial<AppearanceSettings>;
    importedFields: string[];
    /** Field names are labels only; no values from skipped data are retained. */
    skippedFields: string[];
    unsupportedFields: string[];
    warnings: string[];
    receipt: LegacySqliteReceipt;
};

type Header = { pageSize: number; pageCount: number; reserved: number; textEncoding: number };
type Value = string | number | Uint8Array | null;
type Row = { values: Value[]; overflow: boolean };
type TableInfo = { name: string; rootPage: number; sql: string };
type PageStore = { header: Header; pages: Map<number, Uint8Array>; main: Uint8Array };

const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function asBytes(value: LegacySqliteBytes): Uint8Array {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    // A private copy prevents this read-only parser from ever retaining a caller's mutable view.
    return bytes.slice();
}

function u16be(bytes: Uint8Array, offset: number): number {
    return bytes[offset] * 0x100 + bytes[offset + 1];
}
function u32be(bytes: Uint8Array, offset: number): number {
    return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
}
function u32le(bytes: Uint8Array, offset: number): number {
    return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000;
}
function fail(message: string): never { throw new Error(`Không thể đọc profile SQLite cũ: ${message}`); }
function requireRange(bytes: Uint8Array, offset: number, length: number, message = "snapshot bị thiếu dữ liệu"): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) fail(message);
}

function validateDatabase(bytes: Uint8Array): Header {
    if (bytes.length > MAX_LEGACY_SQLITE_BYTES) fail("snapshot vượt quá 64 MiB.");
    if (bytes.length < SQLITE_HEADER_BYTES) fail("không đủ SQLite header.");
    if (new TextDecoder().decode(bytes.subarray(0, SQLITE_MAGIC.length)) !== SQLITE_MAGIC) fail("không có SQLite header hợp lệ.");
    const rawPageSize = u16be(bytes, 16);
    const pageSize = rawPageSize === 1 ? 65_536 : rawPageSize;
    if (pageSize < 512 || pageSize > 65_536 || (pageSize & (pageSize - 1)) !== 0) fail("page size SQLite không được hỗ trợ.");
    const writeVersion = bytes[18];
    const readVersion = bytes[19];
    const reserved = bytes[20];
    if ((writeVersion !== 1 && writeVersion !== 2) || (readVersion !== 1 && readVersion !== 2) || reserved >= pageSize) fail("SQLite header có chế độ journal/reserved không hợp lệ.");
    if (bytes[21] !== 64 || bytes[22] !== 32 || bytes[23] !== 32) fail("SQLite payload fractions không hợp lệ.");
    const pageCount = u32be(bytes, 28);
    if (pageCount < 1 || pageCount * pageSize > bytes.length) fail("snapshot không chứa đủ các page đã khai báo.");
    const schemaFormat = u32be(bytes, 44);
    if (schemaFormat < 1 || schemaFormat > 4) fail("schema format SQLite không được hỗ trợ.");
    const textEncoding = u32be(bytes, 56);
    if (textEncoding < 1 || textEncoding > 3) fail("text encoding SQLite không được hỗ trợ.");
    return { pageSize, pageCount, reserved, textEncoding };
}

function checksum(bytes: Uint8Array, start: number, end: number, first: number, second: number, littleWords: boolean): [number, number] {
    let a = first >>> 0;
    let b = second >>> 0;
    for (let offset = start; offset < end; offset += 8) {
        const x = littleWords ? u32le(bytes, offset) : u32be(bytes, offset);
        const y = littleWords ? u32le(bytes, offset + 4) : u32be(bytes, offset + 4);
        a = (a + x + b) >>> 0;
        b = (b + y + a) >>> 0;
    }
    return [a, b];
}

function validateWal(database: Uint8Array, header: Header, wal: Uint8Array | undefined): { pages: Map<number, Uint8Array>; frames: number; applied: number } {
    const pages = new Map<number, Uint8Array>();
    if (!wal) return { pages, frames: 0, applied: 0 };
    if (wal.length > MAX_LEGACY_SQLITE_BYTES) fail("WAL snapshot vượt quá 64 MiB.");
    if (wal.length < SQLITE_WAL_HEADER_BYTES) fail("WAL header không đầy đủ.");
    const magic = u32be(wal, 0);
    if (magic !== 0x377f0682 && magic !== 0x377f0683) fail("WAL magic không hợp lệ.");
    if (u32be(wal, 4) !== SQLITE_WAL_VERSION) fail("WAL version không được hỗ trợ.");
    const walPageSize = u32be(wal, 8);
    if (walPageSize !== header.pageSize) fail("WAL page size khác SQLite page size.");
    const frameSize = SQLITE_WAL_FRAME_HEADER_BYTES + header.pageSize;
    if ((wal.length - SQLITE_WAL_HEADER_BYTES) % frameSize !== 0) fail("WAL có frame bị cắt.");
    const frameCount = (wal.length - SQLITE_WAL_HEADER_BYTES) / frameSize;
    const littleWords = magic === 0x377f0682;
    const storedHeaderA = u32be(wal, 24);
    const storedHeaderB = u32be(wal, 28);
    const computedHeader = checksum(wal, 0, 24, 0, 0, littleWords);
    if (computedHeader[0] !== storedHeaderA || computedHeader[1] !== storedHeaderB) fail("WAL header checksum không khớp.");
    const saltA = u32be(wal, 16);
    const saltB = u32be(wal, 20);
    let previousA = storedHeaderA;
    let previousB = storedHeaderB;
    let lastCommit = -1;
    const frames: { page: number; commit: number; data: Uint8Array }[] = [];
    for (let index = 0; index < frameCount; index += 1) {
        const offset = SQLITE_WAL_HEADER_BYTES + index * frameSize;
        const page = u32be(wal, offset);
        const commit = u32be(wal, offset + 4);
        if (page < 1 || page > header.pageCount + frameCount || commit > header.pageCount + frameCount) fail("WAL frame page number không hợp lệ.");
        if (u32be(wal, offset + 8) !== saltA || u32be(wal, offset + 12) !== saltB) fail("WAL frame salt không khớp.");
        const computed = checksum(wal, offset, offset + 8, previousA, previousB, littleWords);
        const pageEnd = offset + SQLITE_WAL_FRAME_HEADER_BYTES + header.pageSize;
        const computedWithPage = checksum(wal, offset + 24, pageEnd, computed[0], computed[1], littleWords);
        const storedA = u32be(wal, offset + 16);
        const storedB = u32be(wal, offset + 20);
        if (computedWithPage[0] !== storedA || computedWithPage[1] !== storedB) fail("WAL frame checksum không khớp.");
        previousA = storedA;
        previousB = storedB;
        frames.push({ page, commit, data: wal.slice(offset + SQLITE_WAL_FRAME_HEADER_BYTES, pageEnd) });
        if (commit > 0) lastCommit = index;
    }
    if (lastCommit >= 0) {
        for (let index = 0; index <= lastCommit; index += 1) pages.set(frames[index].page, frames[index].data);
    }
    return { pages, frames: frameCount, applied: lastCommit + 1 };
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; end: number } {
    let value = 0;
    for (let index = 0; index < 9; index += 1) {
        requireRange(bytes, offset + index, 1, "SQLite varint bị cắt.");
        const byte = bytes[offset + index];
        if (index === 8) {
            value = value * 256 + byte;
            if (!Number.isSafeInteger(value)) fail("SQLite varint vượt quá giới hạn an toàn.");
            return { value, end: offset + index + 1 };
        }
        value = value * 128 + (byte & 0x7f);
        if (!Number.isSafeInteger(value)) fail("SQLite varint vượt quá giới hạn an toàn.");
        if ((byte & 0x80) === 0) return { value, end: offset + index + 1 };
    }
    fail("SQLite varint không kết thúc.");
}

function signedInteger(bytes: Uint8Array, offset: number, length: number): number | undefined {
    let value = 0;
    for (let index = 0; index < length; index += 1) value = value * 256 + bytes[offset + index];
    if (bytes[offset] & 0x80) value -= 2 ** (length * 8);
    return Number.isSafeInteger(value) ? value : undefined;
}

function decodeRecord(payload: Uint8Array, textEncoding: number): Value[] | undefined {
    try {
        const header = readVarint(payload, 0);
        if (header.value < 1 || header.value > payload.length) return undefined;
        const serialTypes: number[] = [];
        let cursor = header.end;
        while (cursor < header.value) {
            const serial = readVarint(payload, cursor);
            serialTypes.push(serial.value);
            cursor = serial.end;
        }
        if (cursor !== header.value) return undefined;
        const values: Value[] = [];
        let dataOffset = header.value;
        for (const serial of serialTypes) {
            let length = 0;
            let value: Value = null;
            if (serial === 0) value = null;
            else if (serial === 1 || serial === 2 || serial === 3 || serial === 4 || serial === 5 || serial === 6) {
                length = serial === 1 ? 1 : serial === 2 ? 2 : serial === 3 ? 3 : serial === 4 ? 4 : serial === 5 ? 6 : 8;
                const integer = signedInteger(payload, dataOffset, length);
                if (integer === undefined) return undefined;
                value = integer;
            } else if (serial === 7) {
                length = 8;
                requireRange(payload, dataOffset, length);
                value = new DataView(payload.buffer, payload.byteOffset + dataOffset, length).getFloat64(0, false);
            } else if (serial === 8 || serial === 9) value = serial - 8;
            else if (serial >= 12) {
                length = Math.floor((serial - (serial % 2 ? 13 : 12)) / 2);
                requireRange(payload, dataOffset, length);
                if (serial % 2 === 0) value = payload.slice(dataOffset, dataOffset + length);
                else value = (textEncoding === 1 ? utf8 : new TextDecoder(textEncoding === 2 ? "utf-16le" : "utf-16be", { fatal: true })).decode(payload.subarray(dataOffset, dataOffset + length));
            } else return undefined;
            if (serial !== 0 && serial !== 8 && serial !== 9) dataOffset += length;
            values.push(value);
        }
        return values;
    } catch { return undefined; }
}

function localPayloadLength(payloadLength: number, usablePageSize: number): number {
    const maxLocal = Math.floor((usablePageSize - 12) * 64 / 255) - 23;
    const minLocal = Math.floor((usablePageSize - 12) * 32 / 255) - 23;
    if (payloadLength <= maxLocal) return payloadLength;
    const local = minLocal + ((payloadLength - minLocal) % (usablePageSize - 4));
    return Math.min(local, maxLocal);
}

function readTableRows(store: PageStore, rootPage: number, maxRows = MAX_LEGACY_SQLITE_ROWS): Row[] {
    const rows: Row[] = [];
    const visited = new Set<number>();
    const visit = (pageNumber: number, depth: number): void => {
        if (depth > 32 || visited.has(pageNumber)) fail("SQLite B-tree có vòng lặp hoặc quá sâu.");
        visited.add(pageNumber);
        const page = store.pages.get(pageNumber) ?? (() => {
            const offset = (pageNumber - 1) * store.header.pageSize;
            if (pageNumber < 1 || offset + store.header.pageSize > store.main.length) fail("SQLite B-tree trỏ ngoài snapshot.");
            return store.main.slice(offset, offset + store.header.pageSize);
        })();
        const base = pageNumber === 1 ? 100 : 0;
        requireRange(page, base, 8, "SQLite B-tree header bị cắt.");
        const type = page[base];
        const cellCount = u16be(page, base + 3);
        if (cellCount > maxRows || rows.length + cellCount > maxRows) fail("SQLite B-tree quá lớn để preview an toàn.");
        const pointerBase = base + (type === 0x05 ? 12 : 8);
        requireRange(page, pointerBase, cellCount * 2, "SQLite cell pointer array bị cắt.");
        if (type === 0x05) {
            for (let index = 0; index < cellCount; index += 1) {
                const cell = u16be(page, pointerBase + index * 2);
                requireRange(page, cell, 4, "SQLite interior cell bị cắt.");
                visit(u32be(page, cell), depth + 1);
            }
            visit(u32be(page, base + 8), depth + 1);
            return;
        }
        if (type !== 0x0d) fail("SQLite schema/table không phải table B-tree.");
        const usable = store.header.pageSize - store.header.reserved;
        for (let index = 0; index < cellCount; index += 1) {
            const cell = u16be(page, pointerBase + index * 2);
            const payload = readVarint(page, cell);
            const rowid = readVarint(page, payload.end);
            const local = localPayloadLength(payload.value, usable);
            requireRange(page, rowid.end, local, "SQLite leaf cell bị cắt.");
            if (payload.value > local) {
                requireRange(page, rowid.end + local, 4, "SQLite overflow pointer bị cắt.");
                rows.push({ values: [], overflow: true });
                continue;
            }
            const values = decodeRecord(page.subarray(rowid.end, rowid.end + local), store.header.textEncoding);
            rows.push({ values: values ?? [], overflow: values === undefined });
        }
    };
    visit(rootPage, 0);
    return rows;
}

function sqlTables(store: PageStore): TableInfo[] {
    const rows = readTableRows(store, 1);
    const tables: TableInfo[] = [];
    for (const row of rows) {
        if (row.overflow || row.values.length < 5) continue;
        const type = string(row.values[0]);
        const name = string(row.values[1]);
        const rootPage = number(row.values[3]);
        const sql = string(row.values[4]);
        if (type === "table" && name && rootPage && sql) tables.push({ name, rootPage, sql });
    }
    return tables;
}

function knownTheme(value: unknown): string | undefined {
    const name = string(value)?.toLowerCase();
    if (!name) return undefined;
    const aliases: Record<string, string> = { "default-dark": "slterm-dark", "default-light": "slterm-light", default: "slterm-dark" };
    const alias = aliases[name] ?? name;
    return appearancePresets.find((preset) => preset.id.toLowerCase() === alias || preset.name.toLowerCase() === alias)?.id;
}

function safeAppearance(value: unknown): { appearance: Partial<AppearanceSettings>; fields: string[] } {
    const root = object(value);
    const sources = [root, object(root.meta), object(root.settings), object(root.term)];
    const pick = (...keys: string[]): unknown => {
        for (const source of sources) for (const key of keys) if (source[key] !== undefined) return source[key];
        return undefined;
    };
    const raw: Partial<AppearanceSettings> = {};
    const fields: string[] = [];
    const fontSize = number(pick("term:fontsize", "fontsize", "fontSize"));
    if (fontSize !== undefined) { raw.terminalFontSize = fontSize; fields.push("terminal font size"); }
    const fontFamily = string(pick("term:fontfamily", "fontfamily", "fontFamily"));
    if (fontFamily) { raw.terminalFontFamily = fontFamily; fields.push("terminal font family"); }
    const scrollback = number(pick("term:scrollback", "scrollback"));
    if (scrollback !== undefined) { raw.scrollback = scrollback; fields.push("scrollback"); }
    const theme = knownTheme(pick("term:theme", "theme", "themeId"));
    if (theme) { raw.themeId = theme; fields.push("theme"); }
    const normalized = normalizeAppearance(raw);
    const appearance: Partial<AppearanceSettings> = {};
    for (const key of Object.keys(raw) as (keyof AppearanceSettings)[]) appearance[key] = normalized[key] as never;
    return { appearance, fields };
}

function addUnique(values: string[], value: string): void { if (!values.includes(value)) values.push(value); }

function skippedForTables(tables: string[], skipped: string[], warnings: string[]): void {
    const add = (field: string, warning: string) => { addUnique(skipped, field); if (!warnings.includes(warning)) warnings.push(warning); };
    if (tables.some((name) => /remote|connection/i.test(name))) add("connections", "Connections are skipped; reconnect manually after reviewing the preview.");
    if (tables.some((name) => /workspace|window|tab|block|layout/i.test(name))) add("workspaces", "Workspaces and process/layout graphs are skipped and never recreated.");
    if (tables.some((name) => /secret|token|credential|auth|mainserver/i.test(name))) add("secrets", "Secrets, tokens, and server credentials are skipped and never copied.");
    if (tables.some((name) => /job|command|history/i.test(name))) add("commands", "Commands, jobs, and history are skipped and never executed.");
    if (!skipped.includes("connections")) add("connections", "Connections are not part of the selective import and are skipped.");
    if (!skipped.includes("workspaces")) add("workspaces", "Workspaces are not part of the selective import and are skipped.");
    if (!skipped.includes("secrets")) add("secrets", "Secrets are not part of the selective import and are skipped.");
    if (!skipped.includes("commands")) add("commands", "Commands and process graphs are not part of the selective import and are skipped.");
    addUnique(skipped, "processes");
}

function buildStore(database: Uint8Array, wal: Uint8Array | undefined): { store: PageStore; walFrames: number; walApplied: number } {
    const header = validateDatabase(database);
    const walResult = validateWal(database, header, wal);
    return { store: { header, pages: walResult.pages, main: database }, walFrames: walResult.frames, walApplied: walResult.applied };
}

/**
 * Parse a user-selected SQLite/WAL snapshot. No filesystem path is accepted,
 * no SQLite connection is opened, and no source buffer is modified.
 * Unsupported records fail closed with an explicit preview receipt.
 */
export function parseLegacySqliteSnapshot(sourceName: string, input: LegacySqliteInput): LegacySqliteImportPreview {
    const snapshot = input instanceof Uint8Array || input instanceof ArrayBuffer ? { database: input } : input;
    const database = asBytes(snapshot.database);
    const wal = snapshot.wal === undefined ? undefined : asBytes(snapshot.wal);
    if (database.length + (wal?.length ?? 0) > MAX_LEGACY_SQLITE_BYTES) fail("snapshot và WAL vượt quá 64 MiB.");
    const { store, walFrames, walApplied } = buildStore(database, wal);
    const warnings: string[] = [];
    const skippedFields: string[] = [];
    const unsupportedFields: string[] = [];
    let tables: TableInfo[] = [];
    try { tables = sqlTables(store); } catch (error) {
        addUnique(unsupportedFields, "SQLite schema records");
        warnings.push(error instanceof Error ? error.message : "SQLite schema không đọc được; không nhập setting nào.");
    }
    const tableNames = tables.map((table) => table.name);
    const clientSchema = tables.find((table) => table.name === "db_client")?.sql.toLowerCase() ?? "";
    const workspaceSchema = tables.find((table) => table.name === "db_workspace")?.sql.toLowerCase() ?? "";
    const recognized = /\boid\b/.test(clientSchema) && /\bversion\b/.test(clientSchema) && /\bdata\b/.test(clientSchema) &&
        /\boid\b/.test(workspaceSchema) && /\bdata\b/.test(workspaceSchema) &&
        tableNames.some((name) => /^(db_workspace|db_tab|db_block|db_window|db_layout|history|remote|db_job)$/.test(name));
    const appearance: Partial<AppearanceSettings> = {};
    const importedFields: string[] = [];
    if (!recognized) {
        addUnique(unsupportedFields, "legacy Electron wstore schema");
        warnings.push("SQLite schema không khớp legacy Electron wstore; profile chỉ được phân loại, không nhập dữ liệu.");
    } else {
        skippedForTables(tableNames, skippedFields, warnings);
        const client = tables.find((table) => table.name === "db_client");
        if (client) {
            try {
                const rows = readTableRows(store, client.rootPage, 100);
                const hadOverflow = rows.some((row) => row.overflow);
                for (const row of rows) {
                    if (row.overflow || row.values.length < 3 || typeof row.values[2] !== "string") continue;
                    let data: unknown;
                    try { data = JSON.parse(row.values[2]); } catch { continue; }
                    const safe = safeAppearance(data);
                    Object.assign(appearance, safe.appearance);
                    for (const field of safe.fields) addUnique(importedFields, field);
                    break;
                }
                if (!importedFields.length && hadOverflow) {
                    addUnique(unsupportedFields, "db_client.data");
                    warnings.push("db_client.data có record overflow; không nhập setting để tránh đọc sai dữ liệu.");
                }
            } catch (error) {
                addUnique(unsupportedFields, "db_client.data");
                warnings.push(error instanceof Error ? error.message : "db_client.data không đọc được; setting không được nhập.");
            }
        }
        if (!importedFields.length) {
            addUnique(unsupportedFields, "appearance/settings outside db_client.data");
            warnings.push("Không tìm thấy setting appearance được whitelist trong db_client.data; không nhập giá trị suy đoán.");
        }
    }
    const receipt: LegacySqliteReceipt = {
        action: "preview-only", sourceName, databaseBytes: database.length, walBytes: wal?.length ?? 0,
        pageSize: store.header.pageSize, databasePages: store.header.pageCount, walFrames, walAppliedFrames: walApplied,
        schemaTables: tableNames.slice(), schemaRecognized: recognized, sourceMutated: false, readOnly: true,
    };
    return { sourceName, supported: recognized, appearance, importedFields, skippedFields, unsupportedFields, warnings, receipt };
}

/** Convenience wrapper for a file input. The caller still chooses the database/WAL blobs. */
export async function parseLegacySqliteFile(file: Blob, walFile?: Blob): Promise<LegacySqliteImportPreview> {
    if (file.size > MAX_LEGACY_SQLITE_BYTES) fail("snapshot vượt quá 64 MiB.");
    if (walFile && walFile.size > MAX_LEGACY_SQLITE_BYTES) fail("WAL snapshot vượt quá 64 MiB.");
    const maybeNamed = file as Blob & { name?: unknown };
    const sourceName = typeof maybeNamed.name === "string" && maybeNamed.name ? maybeNamed.name : "profile.sqlite3";
    return parseLegacySqliteSnapshot(sourceName, {
        database: await file.arrayBuffer(), wal: walFile ? await walFile.arrayBuffer() : undefined,
    });
}
