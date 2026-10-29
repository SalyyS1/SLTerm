import type { SpawnCommand } from "./terminal-session";

export type RemoteProtocol = "ssh" | "sftp";

/** Persisted connection details contain no password, private key or token. */
export type RemoteConnection = {
    protocol: RemoteProtocol;
    host: string;
    user?: string;
    port: number;
};

const validHost = (value: string) => value.length > 0 && value.length <= 255 &&
    !/[\u0000-\u0020\u007f]/.test(value) && !/[\\/@]/.test(value);
const validUser = (value: string) => value.length <= 128 && /^[A-Za-z0-9._-]*$/.test(value);

export function parseRemoteConnection(input: {
    protocol: unknown;
    host: unknown;
    user?: unknown;
    port: unknown;
}): RemoteConnection {
    if (input.protocol !== "ssh" && input.protocol !== "sftp") throw new Error("Giao thức remote không hợp lệ.");
    const host = typeof input.host === "string" ? input.host.trim() : "";
    if (!validHost(host)) throw new Error("Host phải là tên máy hoặc địa chỉ IP hợp lệ, không chứa khoảng trắng.");
    const userValue = typeof input.user === "string" ? input.user.trim() : "";
    if (!validUser(userValue)) throw new Error("Tên user chỉ được chứa chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.");
    const port = typeof input.port === "number" ? input.port : Number(input.port);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Port phải nằm trong khoảng 1–65535.");
    return { protocol: input.protocol, host, ...(userValue ? { user: userValue } : {}), port };
}

export function remoteCommand(connection: RemoteConnection): SpawnCommand {
    const target = connection.user ? `${connection.user}@${connection.host}` : connection.host;
    const executable = connection.protocol === "ssh"
        ? "C:\\Windows\\System32\\OpenSSH\\ssh.exe"
        : "C:\\Windows\\System32\\OpenSSH\\sftp.exe";
    const portFlag = connection.protocol === "ssh" ? "-p" : "-P";
    return {
        executable,
        args: ["-o", "ConnectTimeout=10", portFlag, String(connection.port), target],
    };
}

export function remoteLabel(connection: RemoteConnection): string {
    const target = connection.user ? `${connection.user}@${connection.host}` : connection.host;
    return `${connection.protocol.toUpperCase()} · ${target}:${connection.port}`;
}
