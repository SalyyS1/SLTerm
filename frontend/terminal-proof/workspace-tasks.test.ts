import { describe, expect, it } from "vitest";
import { createTask, normalizeTasks, patchTask } from "./workspace-tasks";

describe("workspace task records", () => {
    it("creates and patches a bounded approval record", () => {
        const task = createTask("workspace", "Review", "Review the diff", "codex", 2);
        expect(task).toMatchObject({ workspaceId: "workspace", provider: "codex", status: "draft", attempts: 0, maxAttempts: 2 });
        const running = patchTask([task], task.id, { status: "running", attempts: 1, paneId: 7 });
        expect(running[0]).toMatchObject({ status: "running", attempts: 1, paneId: 7 });
        expect(() => normalizeTasks([{ ...task, attempts: 3 }])).toThrow();
        expect(() => normalizeTasks([{ ...task, provider: "other" }])).toThrow();
    });
});
