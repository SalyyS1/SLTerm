import type { CodexSchemaValidator } from "./codex-chat-runtime";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function string(value: unknown): value is string { return typeof value === "string"; }
function requiredStrings(value: unknown, keys: string[]): boolean {
    const object = record(value);
    return !!object && keys.every((key) => string(object[key]) && object[key] !== "");
}
function turn(value: unknown): boolean {
    const object = record(value);
    return !!object && string(object.id) && ["completed", "interrupted", "failed", "inProgress"].includes(String(object.status))
        && Array.isArray(object.items);
}
function thread(value: unknown): boolean {
    const object = record(value);
    return !!object && string(object.id);
}

/**
 * Browser-safe checks for the exact pinned Codex 0.165.0-alpha.1.2 boundary.
 * The authoritative JSON schemas remain in scripts/provider-proof/schema; this
 * validator deliberately accepts only the fields and enum values used by the
 * app-server conversation surface, and fails closed for unknown schema names.
 */
export const validatePinnedCodexSchema: CodexSchemaValidator = (schema, value) => {
    const object = record(value);
    switch (schema) {
        case "InitializeParams":
            return !!object && requiredStrings(object.clientInfo, ["name", "version"])
                && (object.capabilities === undefined || object.capabilities === null || record(object.capabilities) !== undefined);
        case "InitializeResponse":
            return requiredStrings(value, ["codexHome", "platformFamily", "platformOs", "userAgent"]);
        case "ThreadStartParams":
            return object !== undefined;
        case "ThreadStartResponse":
            return !!object && thread(object.thread) && string(object.cwd) && string(object.model)
                && string(object.modelProvider) && record(object.sandbox) !== undefined;
        case "ThreadStartedNotification":
            return !!object && thread(object.thread);
        case "TurnStartParams":
            return !!object && string(object.threadId) && Array.isArray(object.input);
        case "TurnStartResponse":
            return !!object && turn(object.turn);
        case "TurnStartedNotification":
            return !!object && string(object.threadId) && turn(object.turn);
        case "TurnInterruptParams":
            return requiredStrings(value, ["threadId", "turnId"]);
        case "TurnInterruptResponse":
            return object !== undefined;
        case "TurnCompletedNotification":
            return !!object && string(object.threadId) && turn(object.turn)
                && ["completed", "interrupted", "failed"].includes(String((object.turn as RecordValue).status));
        case "AgentMessageDeltaNotification":
            return !!object && requiredStrings(object, ["threadId", "turnId", "itemId"])
                && string(object.delta);
        case "ErrorNotification":
            return !!object && requiredStrings(object, ["threadId", "turnId"])
                && typeof object.willRetry === "boolean" && object.error !== undefined;
        case "CommandExecutionRequestApprovalParams":
            return !!object && requiredStrings(object, ["threadId", "turnId", "itemId"])
                && typeof object.startedAtMs === "number";
        case "CommandExecutionRequestApprovalResponse": {
            if (!object || !("decision" in object)) return false;
            const decision = object.decision;
            const decisionObject = record(decision);
            return ["accept", "acceptForSession", "decline", "cancel"].includes(String(decision))
                || (!!decisionObject && ("acceptWithExecpolicyAmendment" in decisionObject || "applyNetworkPolicyAmendment" in decisionObject));
        }
        case "ItemStartedNotification":
            return !!object && requiredStrings(object, ["threadId", "turnId"])
                && object.item !== undefined && typeof object.startedAtMs === "number";
        case "ItemCompletedNotification":
            return !!object && requiredStrings(object, ["threadId", "turnId"])
                && object.item !== undefined && typeof object.completedAtMs === "number";
        default:
            return false;
    }
};

