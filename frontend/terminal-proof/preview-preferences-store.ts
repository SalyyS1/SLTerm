import { assertAssetMetadata, validateAppearanceAsset, type PreviewAsset } from "./appearance-assets";

export const PREFERENCES_DATABASE = "slterm-proof-preferences";
const DATABASE_VERSION = 1;
const RECORD_VERSION = 1;
type StoredPreferences = { schemaVersion: number; json: string };
let connection: Promise<IDBDatabase> | undefined;

export function openPreferencesDatabase(): Promise<IDBDatabase> {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
        let blocked = false;
        const request = indexedDB.open(PREFERENCES_DATABASE, DATABASE_VERSION);
        request.onupgradeneeded = (event) => {
            if ((event as IDBVersionChangeEvent).oldVersion !== 0) {
                request.transaction?.abort();
                return;
            }
            request.result.createObjectStore("preferences");
            request.result.createObjectStore("assets", { keyPath: "id" });
            request.result.createObjectStore("asset-backups", { keyPath: "id" });
        };
        request.onerror = () => reject(new Error(`Preferences could not be opened: ${request.error?.message ?? "unknown database error"}`));
        request.onblocked = () => { blocked = true; reject(new Error("Preferences database is blocked by another window. Close the other preview and retry.")); };
        request.onsuccess = () => {
            const db = request.result;
            if (blocked) { db.close(); return; }
            if (db.version !== DATABASE_VERSION || !["preferences", "assets", "asset-backups"].every((name) => db.objectStoreNames.contains(name))) {
                db.close();
                reject(new Error("Unsupported preferences database layout. Existing data was preserved."));
                return;
            }
            db.onversionchange = () => { db.close(); connection = undefined; };
            resolve(db);
        };
    });
    connection.catch(() => { connection = undefined; });
    return connection;
}
function checkRecord(value: unknown): asserts value is StoredPreferences {
    const record = value as StoredPreferences;
    if (!record || record.schemaVersion !== RECORD_VERSION || typeof record.json !== "string") throw new Error("Unsupported preferences record. Existing data was preserved.");
    JSON.parse(record.json);
}
function complete(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error("Preferences transaction was aborted."));
        transaction.onerror = () => reject(transaction.error ?? new Error("Preferences transaction failed."));
    });
}
function read<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Preferences read failed."));
    });
}
export async function loadPreferences(): Promise<unknown | null> {
    const db = await openPreferencesDatabase();
    const transaction = db.transaction("preferences", "readonly");
    const done = complete(transaction);
    const [value] = await Promise.all([read(transaction.objectStore("preferences").get("current")), done]);
    if (value === undefined) return null;
    checkRecord(value);
    return JSON.parse(value.json);
}
/** Back up the exact previous record in the same transaction as replacement. */
export async function savePreferences(value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    if (typeof json !== "string" || new Blob([json]).size > 1024 * 1024) throw new Error("Preferences must be JSON and smaller than 1 MiB.");
    const db = await openPreferencesDatabase();
    const transaction = db.transaction("preferences", "readwrite");
    const done = complete(transaction);
    const store = transaction.objectStore("preferences");
    const previous = store.get("current");
    let validationError: unknown;
    previous.onsuccess = () => {
        try {
            if (previous.result !== undefined) { checkRecord(previous.result); store.put(previous.result, "backup"); }
            store.put({ schemaVersion: RECORD_VERSION, json } satisfies StoredPreferences, "current");
        } catch (error) { validationError = error; transaction.abort(); }
    };
    try { await done; } catch (error) { throw validationError ?? error; }
}
export async function listAssets(): Promise<PreviewAsset[]> {
    const db = await openPreferencesDatabase();
    const transaction = db.transaction("assets", "readonly");
    const done = complete(transaction);
    const [assets] = await Promise.all([read(transaction.objectStore("assets").getAll()), done]);
    assets.forEach(assertAssetMetadata);
    return assets as PreviewAsset[];
}
async function mutateAsset(id: string, replacement?: PreviewAsset): Promise<void> {
    const db = await openPreferencesDatabase();
    const transaction = db.transaction(["assets", "asset-backups"], "readwrite");
    const done = complete(transaction);
    const store = transaction.objectStore("assets");
    const previous = store.get(id);
    previous.onsuccess = () => {
        if (previous.result !== undefined) transaction.objectStore("asset-backups").put(previous.result);
        if (replacement) store.put(replacement);
        else store.delete(id);
    };
    await done;
}
export async function putAsset(asset: PreviewAsset): Promise<void> {
    await validateAppearanceAsset(asset);
    await mutateAsset(asset.id, asset);
}
export async function deleteAsset(id: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid asset ID.");
    await mutateAsset(id);
}
