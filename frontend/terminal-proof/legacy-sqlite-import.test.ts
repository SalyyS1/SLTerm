import { describe, expect, it } from "vitest";
import { MAX_LEGACY_SQLITE_BYTES, parseLegacySqliteSnapshot } from "./legacy-sqlite-import";

const pageSize = 1024;
const textEncoder = new TextEncoder();

function varint(value: number): number[] {
    if (value < 0 || !Number.isSafeInteger(value)) throw new Error("bad fixture varint");
    if (value <= 0x7f) return [value];
    const chunks: number[] = [];
    let rest = value;
    while (rest > 0) { chunks.unshift(rest & 0x7f); rest = Math.floor(rest / 128); }
    for (let index = 0; index < chunks.length - 1; index += 1) chunks[index] |= 0x80;
    return chunks;
}

function record(values: (string | number)[]): Uint8Array {
    const serials = values.map((value) => typeof value === "string" ? 13 + textEncoder.encode(value).length * 2 : 1);
    const serialHeader = serials.flatMap(varint);
    const headerLength = varint(serialHeader.length + 1);
    const body = values.flatMap((value) => typeof value === "string" ? [...textEncoder.encode(value)] : [value]);
    return new Uint8Array([...headerLength, ...serialHeader, ...body]);
}

function writeU32be(target: Uint8Array, offset: number, value: number): void {
    target[offset] = (value >>> 24) & 0xff; target[offset + 1] = (value >>> 16) & 0xff;
    target[offset + 2] = (value >>> 8) & 0xff; target[offset + 3] = value & 0xff;
}
function writeU16be(target: Uint8Array, offset: number, value: number): void {
    target[offset] = (value >>> 8) & 0xff; target[offset + 1] = value & 0xff;
}
function checksum(bytes: Uint8Array, start: number, end: number, first: number, second: number): [number, number] {
    let a = first >>> 0; let b = second >>> 0;
    for (let offset = start; offset < end; offset += 8) {
        const x = (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;
        const y = (bytes[offset + 4] | bytes[offset + 5] << 8 | bytes[offset + 6] << 16 | bytes[offset + 7] << 24) >>> 0;
        a = (a + x + b) >>> 0; b = (b + y + a) >>> 0;
    }
    return [a, b];
}

function putTablePage(database: Uint8Array, pageNumber: number, cells: Uint8Array[]): void {
    const page = database.subarray((pageNumber - 1) * pageSize, pageNumber * pageSize);
    const base = pageNumber === 1 ? 100 : 0;
    page.fill(0, base); page[base] = 0x0d; writeU16be(page, base + 3, cells.length);
    let content = pageSize;
    cells.forEach((cell, index) => {
        content -= cell.length; page.set(cell, content); writeU16be(page, base + 8 + index * 2, content);
    });
    writeU16be(page, base + 5, content);
}

function leafCell(rowid: number, values: (string | number)[]): Uint8Array {
    const payload = record(values);
    return new Uint8Array([...varint(payload.length), ...varint(rowid), ...payload]);
}

function fixtureDatabase(): Uint8Array {
    const database = new Uint8Array(pageSize * 3);
    database.set(textEncoder.encode("SQLite format 3\0"), 0);
    writeU16be(database, 16, pageSize); database[18] = 1; database[19] = 1;
    database[21] = 64; database[22] = 32; database[23] = 32; writeU32be(database, 28, 3);
    writeU32be(database, 44, 4); writeU32be(database, 56, 1);
    putTablePage(database, 1, [
        leafCell(1, ["table", "db_client", "db_client", 2, "CREATE TABLE db_client (oid varchar(36), version int, data json) "]),
        leafCell(2, ["table", "db_workspace", "db_workspace", 3, "CREATE TABLE db_workspace (oid varchar(36), version int, data json) "]),
    ]);
    putTablePage(database, 2, [leafCell(1, ["client", 1, JSON.stringify({ meta: { "term:fontsize": 19, "term:fontfamily": "Cascadia Mono", "term:scrollback": 25000, "term:theme": "default-dark", password: "do-not-copy" }, connections: { prod: "skip" } })])]);
    putTablePage(database, 3, []);
    return database;
}

function validWal(database: Uint8Array): Uint8Array {
    const wal = new Uint8Array(32 + 24 + pageSize);
    writeU32be(wal, 0, 0x377f0682); writeU32be(wal, 4, 3_007_000); writeU32be(wal, 8, pageSize);
    writeU32be(wal, 16, 0x01020304); writeU32be(wal, 20, 0x05060708);
    const headerChecksum = checksum(wal, 0, 24, 0, 0);
    writeU32be(wal, 24, headerChecksum[0]); writeU32be(wal, 28, headerChecksum[1]);
    writeU32be(wal, 32, 2); writeU32be(wal, 36, 3); writeU32be(wal, 40, 0x01020304); writeU32be(wal, 44, 0x05060708);
    wal.set(database.subarray(pageSize, pageSize * 2), 56);
    const frameChecksum = checksum(wal, 32, 40, headerChecksum[0], headerChecksum[1]);
    const pageChecksum = checksum(wal, 56, wal.length, frameChecksum[0], frameChecksum[1]);
    writeU32be(wal, 48, pageChecksum[0]); writeU32be(wal, 52, pageChecksum[1]);
    return wal;
}

describe("legacy SQLite profile import", () => {
    it("validates a read-only snapshot, reads only db_client appearance settings, and emits a receipt", () => {
        const database = fixtureDatabase();
        const before = database.slice();
        const preview = parseLegacySqliteSnapshot("profile.sqlite3", database);
        expect(preview.supported).toBe(true);
        expect(preview.appearance).toMatchObject({ terminalFontSize: 19, terminalFontFamily: "Cascadia Mono", scrollback: 25000, themeId: "slterm-dark" });
        expect(preview.importedFields).toEqual(expect.arrayContaining(["terminal font size", "terminal font family", "scrollback", "theme"]));
        expect(preview.skippedFields).toEqual(expect.arrayContaining(["connections", "workspaces", "secrets", "commands"]));
        expect(preview.receipt).toMatchObject({ action: "preview-only", readOnly: true, sourceMutated: false, databaseBytes: database.length, pageSize, databasePages: 3, schemaRecognized: true });
        expect(database).toEqual(before);
    });

    it("checks the WAL header, salts and checksums without mutating the database", () => {
        const database = fixtureDatabase();
        const preview = parseLegacySqliteSnapshot("profile.sqlite3", { database, wal: validWal(database) });
        expect(preview.receipt).toMatchObject({ walFrames: 1, walAppliedFrames: 1, schemaRecognized: true });
        expect(database).toEqual(fixtureDatabase());
    });

    it("fails closed for malformed, oversized, foreign-schema and corrupt WAL snapshots", () => {
        expect(() => parseLegacySqliteSnapshot("bad.sqlite3", new Uint8Array(100))).toThrow("SQLite header");
        expect(() => parseLegacySqliteSnapshot("large.sqlite3", new Uint8Array(MAX_LEGACY_SQLITE_BYTES + 1))).toThrow("64 MiB");
        const foreign = fixtureDatabase(); foreign[100] = 0x05;
        const classified = parseLegacySqliteSnapshot("foreign.sqlite3", foreign);
        expect(classified.supported).toBe(false);
        expect(classified.unsupportedFields).toEqual(expect.arrayContaining(["legacy Electron wstore schema"]));
        const wal = validWal(fixtureDatabase()); wal[0] ^= 0xff;
        expect(() => parseLegacySqliteSnapshot("bad-wal.sqlite3", { database: fixtureDatabase(), wal })).toThrow("WAL magic");
    });
});
