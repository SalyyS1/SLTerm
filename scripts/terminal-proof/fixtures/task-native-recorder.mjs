import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { powershell, run } from "./task-worktree-harness.mjs";

/** No real provider installation, credentials or user profile is read by this fixture. */
export async function createRecorder(out) {
    const user = path.join(out, "provider-user");
    const receipts = path.join(out, "provider-receipts");
    const binary = path.join(user, ".local/bin/codex.exe");
    for (const directory of [path.dirname(binary), receipts, path.join(user, "AppData/Roaming"), path.join(user, "AppData/Local"), path.join(user, "temp")]) fs.mkdirSync(directory, { recursive: true });
    const windows = process.env.SystemRoot ?? "C:\\Windows";
    const allowed = ["SystemRoot", "windir", "ComSpec", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "PROCESSOR_LEVEL", "PROCESSOR_REVISION", "NUMBER_OF_PROCESSORS", "OS"];
    const environment = Object.fromEntries(allowed.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    const { stdout: gitPath } = await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "(Get-Command git.exe -CommandType Application | Select-Object -First 1).Source"], { windowsHide: true, timeout: 15000 });
    const git = gitPath.trim();
    assert(path.isAbsolute(git) && fs.statSync(git).isFile(), "An installed absolute git.exe is required");
    Object.assign(environment, {
        SystemRoot: windows, windir: windows, ComSpec: path.join(windows, "System32/cmd.exe"),
        PATH: [path.join(windows, "System32"), windows, path.join(windows, "System32/Wbem"), path.dirname(powershell), path.dirname(git), path.dirname(binary)].join(";"),
        PATHEXT: ".COM;.EXE;.BAT;.CMD", USERPROFILE: user, HOME: user,
        APPDATA: path.join(user, "AppData/Roaming"), LOCALAPPDATA: path.join(user, "AppData/Local"), TEMP: path.join(user, "temp"), TMP: path.join(user, "temp"),
        POWERSHELL_TELEMETRY_OPTOUT: "1",
    });
    const source = `using System;
using System.Diagnostics;
using System.IO;
using System.Text;
public class TaskArgumentRecorder {
    static string B64(string value) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? "")); }
    public static int Main(string[] args) {
        int pid = Process.GetCurrentProcess().Id;
        string directory = ${JSON.stringify(receipts)};
        StringBuilder json = new StringBuilder("{\\\"pid\\\":" + pid + ",\\\"cwdBase64\\\":\\\"" + B64(Environment.CurrentDirectory) + "\\\",\\\"argsBase64\\\":[");
        for (int index = 0; index < args.Length; index++) { if (index > 0) json.Append(","); json.Append("\\\"" + B64(args[index]) + "\\\""); }
        json.Append("],\\\"homeBase64\\\":\\\"" + B64(Environment.GetEnvironmentVariable("HOME")) + "\\\",\\\"profileBase64\\\":\\\"" + B64(Environment.GetEnvironmentVariable("USERPROFILE")) + "\\\"}");
        string pending = Path.Combine(directory, pid + ".pending");
        File.WriteAllText(pending, json.ToString(), new UTF8Encoding(false));
        File.Move(pending, Path.Combine(directory, pid + ".json"));
        Console.WriteLine("SLTERM_TASK_RECORDER_READY " + pid);
        Console.ReadLine();
        return 0;
    }
}`;
    fs.writeFileSync(path.join(out, "TaskArgumentRecorder.cs"), source);
    const command = `$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source).toString("base64")}')); Add-Type -TypeDefinition $source -OutputAssembly '${binary.replaceAll("'", "''")}' -OutputType ConsoleApplication;`;
    await run(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], {
        cwd: out, env: environment, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024,
    });
    const read = () => fs.readdirSync(receipts).filter((name) => name.endsWith(".json")).map((name) => {
        const value = JSON.parse(fs.readFileSync(path.join(receipts, name), "utf8"));
        const decode = (encoded) => Buffer.from(encoded, "base64").toString("utf8");
        return { pid: value.pid, cwd: decode(value.cwdBase64), args: value.argsBase64.map(decode), home: decode(value.homeBase64), profile: decode(value.profileBase64) };
    });
    return { binary, environment, git, read };
}
