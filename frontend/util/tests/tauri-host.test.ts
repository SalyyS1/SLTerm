// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { findTauriHost, isTauriHost } from "../tauri-host";

const snapshot = {
    webEndpoint: "127.0.0.1:8190",
    wsEndpoint: "127.0.0.1:8191",
    authKey: "deadbeef",
    platform: "linux",
    isDev: true,
    userName: "sally",
    hostName: "workstation",
    configDir: "/home/sally/.slterm/config",
    version: "0.19.1",
    buildTime: 0,
};

/** Stands in for the page the Rust shell's initialization script has prepared. */
function stubShell(host: unknown) {
    vi.stubGlobal("window", { __SLTERM_HOST__: host, addEventListener: () => {} });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("findTauriHost", () => {
    it("finds nothing outside the Tauri shell", () => {
        vi.stubGlobal("window", { api: {} });
        expect(isTauriHost()).toBe(false);
        expect(findTauriHost()).toBeNull();
    });

    it("answers the synchronous getters from the startup snapshot", () => {
        stubShell(snapshot);
        const host = findTauriHost();
        expect(host).not.toBeNull();
        expect(host.getAuthKey()).toBe("deadbeef");
        expect(host.getPlatform()).toBe("linux");
        expect(host.getIsDev()).toBe(true);
        expect(host.getUserName()).toBe("sally");
        expect(host.getHostName()).toBe("workstation");
        expect(host.getConfigDir()).toBe("/home/sally/.slterm/config");
        expect(host.getAboutModalDetails()).toEqual({ version: "0.19.1", buildTime: 0 });
    });

    it("serves the two endpoints the frontend resolves through getEnv", () => {
        stubShell(snapshot);
        const host = findTauriHost();
        expect(host.getEnv("WAVE_SERVER_WEB_ENDPOINT")).toBe("127.0.0.1:8190");
        expect(host.getEnv("WAVE_SERVER_WS_ENDPOINT")).toBe("127.0.0.1:8191");
    });

    it("does not leak the rest of the environment", () => {
        stubShell(snapshot);
        expect(findTauriHost().getEnv("SLTERM_AUTH_KEY")).toBeNull();
        expect(findTauriHost().getEnv("PATH")).toBeNull();
    });

    it("reuses one host, so repeated resolution costs nothing", () => {
        stubShell(snapshot);
        expect(findTauriHost()).toBe(findTauriHost());
    });

    it("names the member when something is not implemented yet", () => {
        stubShell(snapshot);
        const host = findTauriHost();
        // The application menu is the last native surface without an in-document
        // equivalent: its content was assembled in Electron's main process.
        expect(() => host.showWorkspaceAppMenu("ws")).toThrow(/showWorkspaceAppMenu/);
    });

    it("does not refuse tab and workspace operations", () => {
        stubShell(snapshot);
        const host = findTauriHost();
        // These are service calls against the backend, not shell operations, so they
        // must return rather than throw. They are fire-and-forget by HostApi's own
        // signature, so the assertion is that nothing is thrown at the call.
        expect(() => host.createTab()).not.toThrow();
        expect(() => host.closeTab("ws", "tab")).not.toThrow();
        expect(() => host.createWorkspace()).not.toThrow();
        expect(() => host.switchWorkspace("ws")).not.toThrow();
        expect(() => host.deleteWorkspace("ws")).not.toThrow();
        expect(() => host.setActiveTab("tab")).not.toThrow();
    });

    it("sends a context menu to the shell rather than refusing", () => {
        stubShell(snapshot);
        const host = findTauriHost();
        expect(() =>
            host.showContextMenu("ws", [{ id: "1", label: "Copy", role: "copy" }])
        ).not.toThrow();
        expect(() => host.onContextMenuClick(() => {})).not.toThrow();
    });

    it("keeps the shell's own quiet features quiet rather than failing", () => {
        stubShell(snapshot);
        const host = findTauriHost();
        expect(host.getZoomFactor()).toBe(1);
        expect(host.getUpdaterStatus()).toBe("up-to-date");
        expect(host.getWebviewPreload()).toBe("");
        expect(() => host.onZoomFactorChange(() => {})).not.toThrow();
        expect(() => host.setWindowInitStatus("ready")).not.toThrow();
        expect(() => host.updateWindowControlsOverlay({ width: 1, height: 1, left: 0, top: 0 })).not.toThrow();
    });

    it("rejects a screenshot instead of returning a broken image", async () => {
        stubShell(snapshot);
        await expect(findTauriHost().captureScreenshot({ x: 0, y: 0, width: 1, height: 1 })).rejects.toThrow(
            /captureScreenshot/
        );
    });
});
