export type AiProvider = "claude" | "codex";

export type AiCommand = {
    provider: AiProvider;
    label: string;
    executable: string;
    args: string[];
};

/**
 * Launches the provider's official CLI inside a normal terminal process.
 * Authentication remains owned by that CLI; SLTerm never receives or copies
 * provider tokens. The provider value is a fixed allowlist, not user shell text.
 */
export function aiCommand(provider: AiProvider, powershell: string): AiCommand {
    const label = provider === "claude" ? "Claude CLI" : "Codex CLI";
    return {
        provider,
        label,
        executable: powershell,
        args: ["-NoLogo", "-NoProfile", "-Command", provider],
    };
}
