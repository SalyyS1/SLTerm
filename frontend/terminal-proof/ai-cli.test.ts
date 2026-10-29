import { describe, expect, it } from "vitest";
import { aiCommand } from "./ai-cli";

describe("AI CLI launch contract", () => {
    it("uses only fixed provider commands and the local PowerShell host", () => {
        expect(aiCommand("claude", "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")).toEqual({
            provider: "claude",
            label: "Claude CLI",
            executable: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
            args: ["-NoLogo", "-NoProfile", "-Command", "claude"],
        });
        expect(aiCommand("codex", "powershell.exe").args.at(-1)).toBe("codex");
    });
});
