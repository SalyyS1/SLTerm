// Generated from schema/ade-ipc.json; edit the schema and run generate-contract.mjs.
export const PROTOCOL_VERSION = 1 as const;
export const CORE_METHODS = ["hello","spawn","input","resize","ack","stop","shutdown","preferences.load","preferences.save.begin","preferences.save.chunk","preferences.save.commit","preferences.save.cancel","files.list","files.read","files.save.begin","files.save.chunk","files.save.commit","files.save.cancel"] as const;
export type CoreMethod = typeof CORE_METHODS[number];
export type CoreRequest = {
    version: typeof PROTOCOL_VERSION;
    id: number;
    method: CoreMethod;
    session_id?: number;
    executable?: string | null;
    args?: string[];
    cwd?: string | null;
    cols?: number;
    rows?: number;
    data?: string | null;
    sequence?: number;
    root?: string | null;
    path?: string | null;
    offset?: number;
    cursor?: number;
    total_bytes?: number;
    expected_revision?: number;
    if_match?: string | null;
    upload_id?: string | null;
};
