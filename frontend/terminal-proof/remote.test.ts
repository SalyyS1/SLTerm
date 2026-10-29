import { describe, expect, it } from "vitest";
import { parseRemoteConnection, remoteCommand, remoteLabel } from "./remote";

describe("remote connection contract", () => {
    it("normalizes an SSH connection without storing credentials", () => {
        const connection = parseRemoteConnection({ protocol: "ssh", host: " server.example.com ", user: "deploy", port: "2222" });
        expect(connection).toEqual({ protocol: "ssh", host: "server.example.com", user: "deploy", port: 2222 });
        expect(remoteCommand(connection)).toEqual({
            executable: "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
            args: ["-o", "ConnectTimeout=10", "-p", "2222", "deploy@server.example.com"],
        });
        expect(remoteLabel(connection)).toBe("SSH · deploy@server.example.com:2222");
    });

    it("uses sftp's uppercase port flag and allows the default user", () => {
        const connection = parseRemoteConnection({ protocol: "sftp", host: "10.0.0.4", user: "", port: 22 });
        expect(remoteCommand(connection).args).toEqual(["-o", "ConnectTimeout=10", "-P", "22", "10.0.0.4"]);
    });

    it("rejects shell delimiters, invalid users and ports", () => {
        for (const input of [
            { protocol: "ssh", host: "bad host", port: 22 },
            { protocol: "ssh", host: "host/other", port: 22 },
            { protocol: "ssh", host: "host", user: "deploy@evil", port: 22 },
            { protocol: "ssh", host: "host", port: 0 },
            { protocol: "ssh", host: "host", port: 65536 },
        ]) expect(() => parseRemoteConnection(input)).toThrow();
    });
});
