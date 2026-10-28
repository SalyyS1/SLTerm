/* Disposable, unchanged-application Electron baseline. No app import in prepare mode. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const repoRoot = path.resolve(__dirname, "../..");
const markerName = "baseline-profile.json";
const psReadLineManifest = "C:\\Program Files\\WindowsPowerShell\\Modules\\PSReadLine\\2.0.0\\PSReadLine.psd1";
const psReadLineDllSha256 = "f8c76694068949d1b44a5fd0a618495a50fecd266f891bb94ae5972f477ba76c";

function writeJson(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}

function describeProfile(root) {
    return Object.fromEntries(
        ["legacy", "data", "config", "electron", "session", "home", "roaming", "local", "temp", "logs", "history", "shell-receipts"].map(
            (name) => [name, path.join(root, name)]
        )
    );
}

function powerShellString(value) { return "'" + value.replaceAll("'", "''") + "'"; }

function createShellStartup(root, dirs) {
    const dll = path.join(path.dirname(psReadLineManifest), "Microsoft.PowerShell.PSReadLine.dll");
    if (crypto.createHash("sha256").update(fs.readFileSync(dll)).digest("hex") !== psReadLineDllSha256) {
        throw new Error("Pinned machine PSReadLine binary changed; review history-loading behavior before running");
    }
    const integration = path.join(dirs.data, "shell/pwsh/wavepwsh.ps1");
    const script = path.join(root, "baseline-shell.ps1");
    // The first -File consumes the remaining argv as script arguments. Thus the
    // unchanged app's appended integration flags cannot run before this guard.
    fs.writeFileSync(script, `$ErrorActionPreference = 'Stop'
try {
    $baselineUtf8 = New-Object System.Text.UTF8Encoding($false)
    [Console]::InputEncoding = $baselineUtf8
    [Console]::OutputEncoding = $baselineUtf8
    $global:OutputEncoding = $baselineUtf8
    Import-Module -Name ${powerShellString(psReadLineManifest)} -Global -Force -ErrorAction Stop
    $baselineHistoryPath = Join-Path ${powerShellString(dirs.history)} ("shell-" + $PID + ".txt")
    Set-PSReadLineOption -HistorySavePath $baselineHistoryPath -HistorySaveStyle SaveNothing
    $baselinePrediction = 'not-supported-by-pinned-version'
    if ((Get-Command Set-PSReadLineOption).Parameters.ContainsKey('PredictionSource')) {
        Set-PSReadLineOption -PredictionSource None
        $baselinePrediction = 'None'
    }
    $baselineOptions = Get-PSReadLineOption
    if ($baselineOptions.HistorySavePath -ne $baselineHistoryPath -or $baselineOptions.HistorySaveStyle -ne 'SaveNothing') {
        throw 'PSReadLine history isolation did not apply'
    }
    if ([Console]::InputEncoding.CodePage -ne 65001 -or [Console]::OutputEncoding.CodePage -ne 65001 -or $OutputEncoding.CodePage -ne 65001) {
        throw 'UTF-8 initialization did not apply'
    }
    $baselineExpectedArgs = @('-ExecutionPolicy', 'Bypass', '-NoExit', '-File', ${powerShellString(integration)})
    if ([string]::Join('|', $args) -ne [string]::Join('|', $baselineExpectedArgs)) {
        throw 'Unexpected application shell arguments; refusing first prompt'
    }
    $baselineReceipt = @{
        pid = $PID; processStartedAt = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
        historyPath = $baselineOptions.HistorySavePath; historySaveStyle = [string]$baselineOptions.HistorySaveStyle
        inputCodePage = [Console]::InputEncoding.CodePage; outputCodePage = [Console]::OutputEncoding.CodePage; pipelineCodePage = $OutputEncoding.CodePage
        psReadLineVersion = [string](Get-Module PSReadLine).Version; psReadLinePath = (Get-Module PSReadLine).Path
        prediction = $baselinePrediction; configuredBeforeFirstPrompt = $true; integration = ${powerShellString(integration)}
        preflight = ($env:SLTERM_BASELINE_SHELL_VERIFY -eq '1')
    }
    $baselineReceiptPath = Join-Path ${powerShellString(dirs["shell-receipts"])} ("shell-" + $PID + ".json")
    $baselineReceipt | ConvertTo-Json -Compress | Set-Content -LiteralPath $baselineReceiptPath -Encoding UTF8
    if ($env:SLTERM_BASELINE_SHELL_VERIFY -eq '1') { $baselineReceipt | ConvertTo-Json -Compress; exit 0 }
    . ${powerShellString(integration)}
    $ErrorActionPreference = 'Continue'
} catch {
    [Console]::Error.WriteLine('Baseline shell safety initialization failed: ' + $_.Exception.Message)
    exit 1
}
`, { flag: "wx" });
    return { script, integration, manifest: psReadLineManifest, dllSha256: psReadLineDllSha256 };
}

function makeIsolatedEnvironment(root, dirs, systemRoot, shell) {
    return {
        SystemRoot: systemRoot, WINDIR: systemRoot, COMSPEC: path.join(systemRoot, "System32/cmd.exe"),
        PATH: [path.dirname(shell), path.join(systemRoot, "System32"), systemRoot].join(path.delimiter),
        PATHEXT: ".COM;.EXE;.BAT;.CMD", USERPROFILE: dirs.home, APPDATA: dirs.roaming, LOCALAPPDATA: dirs.local,
        PSModulePath: [path.dirname(path.dirname(path.dirname(psReadLineManifest))), path.join(path.dirname(shell), "Modules")].join(path.delimiter),
        PSModuleAnalysisCachePath: path.join(dirs.local, "module-analysis-cache"),
        TEMP: dirs.temp, TMP: dirs.temp, SLTERM_HOME: dirs.legacy, SLTERM_DATA_HOME: dirs.data, SLTERM_CONFIG_HOME: dirs.config,
        SLTERM_BASELINE_PROFILE: root, SLTERM_NOCONFIRMQUIT: "1",
        HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9", NO_PROXY: "localhost,127.0.0.1,::1"
    };
}

function validateShellIdentities(dirs, state) {
    if (state.terminals.length !== state.requested || new Set(state.terminals.map((item) => item.shellPid)).size !== state.requested) {
        throw new Error("Workload did not report distinct shell PIDs for every terminal");
    }
    for (const terminal of state.terminals) {
        const receipt = JSON.parse(fs.readFileSync(path.join(dirs["shell-receipts"], `shell-${terminal.shellPid}.json`), "utf8").replace(/^\uFEFF/, ""));
        if (receipt.pid !== terminal.shellPid || receipt.preflight || !receipt.processStartedAt ||
            receipt.historyPath !== path.join(dirs.history, `shell-${terminal.shellPid}.txt`) || receipt.historySaveStyle !== "SaveNothing" ||
            ![receipt.inputCodePage, receipt.outputCodePage, receipt.pipelineCodePage].every((codePage) => codePage === 65001)) {
            throw new Error(`Shell PID ${terminal.shellPid} does not match its safe startup identity`);
        }
        terminal.startupReceiptMatched = true;
        terminal.processStartedAt = receipt.processStartedAt;
    }
    state.shellIdentitiesVerified = true;
}

function checkProfile(root) {
    const marker = JSON.parse(fs.readFileSync(path.join(root, markerName), "utf8"));
    if (marker.kind !== "slterm-electron-baseline" || marker.root !== root || marker.repo !== repoRoot) {
        throw new Error("Not a disposable profile created by this harness");
    }
    const dirs = describeProfile(root);
    const key = fs.readFileSync(path.join(dirs.config, "secrets.key"), "utf8").trim();
    if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, "base64").length !== 32) {
        throw new Error("Disposable file key is missing/invalid; refusing any OS-keyring fallback");
    }
    if (fs.existsSync(path.join(dirs.legacy, "wave.lock"))) throw new Error("Unexpected legacy profile");
    return dirs;
}

// Runs in the real renderer: existing public RPC + service routes own every
// block and shell. The probe never writes directly to the baseline databases.
async function runTerminalWorkload(count) {
    const state = { status: "starting", requested: count, started: Date.now(), terminals: [], readRetries: [] };
    window.__sltermBaselineWorkload = state;
    const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
    async function until(check, label) {
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            const value = await check();
            if (value) return value;
            await pause();
        }
        throw new Error(`Timed out waiting for ${label}`);
    }
    try {
        const { WOS, RpcApi, TabRpcClient, api } = window;
        const call = (service, method, args) => WOS.callBackendService(service, method, args, true);
        const client = await call("client", "GetClientData", []);
        const windowObj = await call("object", "GetObject", [`window:${client.windowids[0]}`]);
        const workspace = await call("object", "GetObject", [`workspace:${windowObj.workspaceid}`]);
        const tab = await call("object", "GetObject", [`tab:${workspace.activetabid}`]);
        const ids = [...tab.blockids];
        if (ids.length !== 1) throw new Error("Expected a fresh single-terminal baseline profile");
        state.tabId = tab.oid;
        for (let index = ids.length; index < count; index++) {
            const ref = await RpcApi.CreateBlockCommand(TabRpcClient, {
                tabid: tab.oid, blockdef: { meta: { view: "term", controller: "shell", "cmd:cwd": api.getHomeDir() } },
                rtopts: { termsize: { rows: 24, cols: 80 } }, focused: false
            }, { timeout: 30000 });
            ids.push(typeof ref === "string" ? ref.split(":")[1] : ref.oid);
        }
        state.status = "waiting-shells";
        const endpoint = `http://${api.getEnv("WAVE_SERVER_WEB_ENDPOINT")}`;
        for (let index = 0; index < ids.length; index++) {
            const id = ids[index];
            state.currentTerminal = index;
            state.phase = "wait-running-controller";
            await until(async () => (await call("block", "GetControllerStatus", [id]))?.shellprocstatus === "running", `shell ${index}`);
            const marker = `B${index}:`;
            // Keep the framed response short enough for narrow panes. Long
            // lines can be wrapped and repainted by ConPTY's cursor protocol.
            // Concatenation keeps the expected marker out of echoed input.
            const command = `$baselineOpts = Get-PSReadLineOption; $baselineSafe = $baselineOpts.HistorySaveStyle -eq 'SaveNothing' -and $baselineOpts.HistorySavePath.StartsWith($env:SLTERM_BASELINE_PROFILE + '\\history\\') -and [Console]::InputEncoding.CodePage -eq 65001 -and [Console]::OutputEncoding.CodePage -eq 65001 -and $OutputEncoding.CodePage -eq 65001; if ($baselineSafe) { Write-Output ('B' + '${index}:' + $PID + ':E') } else { Write-Output 'BASELINE_SAFETY_FAILED' }\r`;
            state.phase = "send-one-command";
            await RpcApi.ControllerInputCommand(TabRpcClient, { blockid: id, inputdata64: btoa(command) }, { timeout: 30000 });
            state.phase = "verify-pty-output";
            let readFailures = 0;
            const shellPid = await until(async () => {
                const query = new URLSearchParams({ zoneid: id, name: "term", offset: "0" });
                let output;
                try {
                    const response = await fetch(`${endpoint}/wave/file?${query}`, { headers: { "X-AuthKey": api.getAuthKey() } });
                    if (!response.ok) throw new Error(`PTY read HTTP ${response.status}`);
                    output = await response.text();
                } catch (error) {
                    // Only retry the idempotent read, never the input command.
                    state.readRetries.push({ index, at: Date.now(), error: error.message });
                    if (++readFailures > 3) throw error;
                    return false;
                }
                if (output.includes("\r\nBASELINE_SAFETY_FAILED\r\n")) throw new Error(`Live shell safety failed: ${index}`);
                // End framing prevents accepting a read that ends mid-PID.
                const match = output.match(new RegExp(`${marker}(\\d+):E`));
                return match ? Number(match[1]) : false;
            }, `real PTY output ${index}`);
            state.terminals.push({ blockId: id, shellPid, outputVerified: true, historyAndUtf8Verified: true });
        }
        state.renderedXtermCount = await until(() => {
            const actual = document.querySelectorAll(".xterm").length;
            return actual >= count ? actual : false;
        }, "rendered xterm instances");
        state.keyBackend = await RpcApi.GetSecretsLinuxStorageBackendCommand(TabRpcClient);
        if (state.keyBackend !== "config-file") throw new Error("Expected disposable config-file key backend");
        state.status = "ready";
        state.readyAt = Date.now();
        state.setupElapsedMs = state.readyAt - state.started;
    } catch (error) {
        state.status = "failed";
        state.error = error.message;
        state.failedAt = Date.now();
    }
    return state;
}

async function runElectronChild() {
    const root = path.resolve(process.argv[process.argv.indexOf("--electron-child") + 1]);
    const dirs = checkProfile(root);
    const seconds = Number(process.env.SLTERM_BASELINE_SECONDS);
    if (!(seconds >= 5 && seconds <= 600)) throw new Error("Invalid bounded duration");
    const { app, session, webContents } = require("electron");
    for (const [name, value] of Object.entries({ home: dirs.home, appData: dirs.roaming, userData: dirs.electron, sessionData: dirs.session, temp: dirs.temp, logs: dirs.logs, crashDumps: path.join(dirs.logs, "crashes") })) {
        fs.mkdirSync(value, { recursive: true });
        app.setPath(name, value);
    }
    const protectedSessions = new WeakSet();
    function protectSession(sess) {
        if (protectedSessions.has(sess)) return;
        protectedSessions.add(sess);
        sess.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
            const target = new URL(details.url);
            const allow = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
            if (!allow) fs.appendFileSync(path.join(root, "blocked-network.ndjson"), JSON.stringify({ origin: target.origin, at: Date.now() }) + "\n");
            callback({ cancel: !allow });
        });
        sess.webRequest.onErrorOccurred((details) => {
            const target = new URL(details.url);
            fs.appendFileSync(path.join(root, "request-errors.ndjson"), JSON.stringify({ origin: target.origin, path: target.pathname, error: details.error, resourceType: details.resourceType, at: Date.now() }) + "\n");
        });
    }
    app.on("session-created", protectSession);
    app.once("ready", () => protectSession(session.defaultSession));
    app.commandLine.appendSwitch("disable-background-networking");
    app.commandLine.appendSwitch("proxy-server", "127.0.0.1:9");
    app.commandLine.appendSwitch("proxy-bypass-list", "localhost;127.0.0.1;[::1]");
    const started = Date.now();
    let quitRecorded = false;
    const stopPoll = setInterval(() => {
        const requested = fs.existsSync(path.join(root, "stop-request"));
        if (requested || Date.now() - started > seconds * 1000) {
            if (!quitRecorded) {
                writeJson(path.join(root, "quit-request.json"), { at: Date.now(), reason: requested ? "stop-profile" : "duration-limit", elapsedMs: Date.now() - started });
                quitRecorded = true;
            }
            app.quit();
        }
    }, 250);
    let workloadPoll;
    let workloadContents;
    let workloadBusy = false;
    const terminalCount = Number(process.env.SLTERM_BASELINE_TERMINALS || 0);
    if (terminalCount) {
        workloadPoll = setInterval(async () => {
            if (workloadBusy) return;
            workloadBusy = true;
            try {
                if (!workloadContents) {
                    for (const contents of webContents.getAllWebContents()) {
                        if (!contents.getURL().startsWith("file:")) continue;
                        const ready = await contents.executeJavaScript("Boolean(window.TabRpcClient && window.WOS && document.querySelector('.xterm'))");
                        if (!ready) continue;
                        workloadContents = contents;
                        contents.executeJavaScript(`(${runTerminalWorkload.toString()})(${terminalCount})`).catch((error) => {
                            fs.writeFileSync(path.join(root, "workload.json"), JSON.stringify({ status: "failed", error: error.message }));
                        });
                        break;
                    }
                }
                if (workloadContents && !workloadContents.isDestroyed()) {
                    const state = await workloadContents.executeJavaScript("window.__sltermBaselineWorkload");
                    if (state?.status === "ready") {
                        try { validateShellIdentities(dirs, state); }
                        catch (error) { state.status = "failed"; state.error = error.message; state.failedAt = Date.now(); }
                    }
                    if (state) fs.writeFileSync(path.join(root, "workload.json"), JSON.stringify(state, null, 2));
                    if (state?.status === "ready" || state?.status === "failed") clearInterval(workloadPoll);
                }
            } catch (error) {
                fs.writeFileSync(path.join(root, "workload-poll-error.txt"), error.message);
            } finally { workloadBusy = false; }
        }, 500);
    }
    app.on("will-quit", () => { clearInterval(stopPoll); clearInterval(workloadPoll); });
    app.on("browser-window-created", (_event, window) => {
        if (process.env.SLTERM_BASELINE_SHOW !== "1") {
            window.on("show", () => window.hide());
            window.hide();
        }
        window.once("ready-to-show", () => fs.appendFileSync(path.join(root, "windows.ndjson"), JSON.stringify({ windowId: window.id, at: Date.now(), elapsedMs: Date.now() - started }) + "\n"));
    });
    app.on("web-contents-created", (_event, contents) => {
        contents.on("did-finish-load", () => fs.appendFileSync(path.join(root, "renderers.ndjson"), JSON.stringify({ id: contents.id, pid: contents.getOSProcessId(), type: contents.getType(), elapsedMs: Date.now() - started }) + "\n"));
    });
    writeJson(path.join(root, "electron-start.json"), { pid: process.pid, started, userData: app.getPath("userData"), sessionData: app.getPath("sessionData"), home: app.getPath("home"), electron: process.versions.electron, packaged: app.isPackaged });
    // The application entrypoint and its backend remain untouched. This is an
    // unpackaged Electron run of production-built bundles, not a release package.
    await import(pathToFileURL(path.join(repoRoot, "dist/main/index.js")).href);
}

async function runParent() {
    if (process.platform !== "win32") throw new Error("This baseline harness currently targets Windows");
    const args = process.argv.slice(2);
    const switches = new Set(["--launch", "--show", "--verify-shell"]);
    const valued = new Set(["--stop-profile", "--seconds", "--debug-port", "--terminals"]);
    const seen = new Set();
    for (let index = 0; index < args.length; index++) {
        const option = args[index];
        if ((!switches.has(option) && !valued.has(option)) || seen.has(option))
            throw new Error(`Unknown or repeated option: ${option}`);
        seen.add(option);
        if (valued.has(option)) {
            if (!args[index + 1] || args[index + 1].startsWith("--"))
                throw new Error(`Missing value for ${option}`);
            index++;
        }
    }
    if (seen.has("--stop-profile") && seen.size !== 1)
        throw new Error("--stop-profile cannot be combined with launch options");
    const stopIndex = args.indexOf("--stop-profile");
    if (stopIndex >= 0) {
        if (!args[stopIndex + 1]) throw new Error("--stop-profile requires an explicit disposable profile root");
        const root = path.resolve(args[stopIndex + 1]);
        checkProfile(root);
        fs.writeFileSync(path.join(root, "stop-request"), "stop", { flag: "w" });
        console.log(JSON.stringify({ event: "stop-requested", profileRoot: root, method: "marker-validated app.quit signal; no kill" }));
        return;
    }
    const secondsIndex = args.indexOf("--seconds");
    const portIndex = args.indexOf("--debug-port");
    const terminalsIndex = args.indexOf("--terminals");
    const seconds = secondsIndex < 0 ? 45 : Number(args[secondsIndex + 1]);
    const debugPort = portIndex < 0 ? 0 : Number(args[portIndex + 1]);
    const terminalCount = terminalsIndex < 0 ? 0 : Number(args[terminalsIndex + 1]);
    if (!(Number.isInteger(seconds) && seconds >= 5 && seconds <= 600)) throw new Error("--seconds must be 5..600");
    if (!(Number.isInteger(debugPort) && (debugPort === 0 || (debugPort >= 1024 && debugPort <= 65535)))) throw new Error("Invalid --debug-port");
    if (!(Number.isInteger(terminalCount) && terminalCount >= 0 && terminalCount <= 10)) throw new Error("--terminals must be 0..10 for this measurement harness");
    if (debugPort) {
        const server = require("node:net").createServer();
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(debugPort, "127.0.0.1", resolve); });
        await new Promise((resolve) => server.close(resolve));
    }
    for (const file of ["dist/main/index.js", "dist/frontend/index.html", "dist/bin/wavesrv.x64.exe"]) {
        if (!fs.existsSync(path.join(repoRoot, file))) throw new Error(`Build prerequisite missing: ${file}`);
    }
    // A short scratch path is required by Windows' AF_UNIX socket path limit.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "slb-"));
    if (Buffer.byteLength(path.join(root, "data", "wave.sock")) >= 100) throw new Error("Temporary path too long for AF_UNIX");
    const dirs = describeProfile(root);
    for (const dir of Object.values(dirs)) fs.mkdirSync(dir);
    writeJson(path.join(root, markerName), { kind: "slterm-electron-baseline", root, repo: repoRoot, created: new Date().toISOString() });
    fs.writeFileSync(path.join(dirs.config, "secrets.key"), crypto.randomBytes(32).toString("base64"), { flag: "wx", mode: 0o600 });
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const shell = path.join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
    const shellStartup = createShellStartup(root, dirs);
    const shellOptions = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-File", shellStartup.script];
    writeJson(path.join(dirs.config, "settings.json"), {
        "telemetry:enabled": false, "autoupdate:enabled": false, "autoupdate:installonquit": false,
        "app:confirmquit": false, "conn:askbeforewshinstall": true,
        "term:localshellpath": shell, "term:localshellopts": shellOptions
    });
    checkProfile(root);
    const reportDir = path.join(repoRoot, "proof-results/baseline-runs", path.basename(root));
    fs.mkdirSync(reportDir, { recursive: true });
    const receipt = { profileRoot: root, reportDir, seconds, debugPort, terminalCount, baseline: "unchanged unpackaged Electron + Go backend; production-built bundles; controlled shell startup", keyring: "file key seeded; OS keyring not needed", network: "renderer external requests blocked; standard HTTP proxies refuse external traffic; NOT an OS network sandbox", shell, shellOptions, shellStartup, visible: args.includes("--show"), launchRequested: args.includes("--launch") };
    writeJson(path.join(reportDir, "launch-receipt.json"), receipt);
    console.log(JSON.stringify({ event: "prepared", ...receipt }));
    const env = makeIsolatedEnvironment(root, dirs, systemRoot, shell);
    if (args.includes("--verify-shell")) {
        const probe = spawnSync(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", shellStartup.script, "-ExecutionPolicy", "Bypass", "-NoExit", "-File", shellStartup.integration], { cwd: dirs.home, env: { ...env, SLTERM_BASELINE_SHELL_VERIFY: "1" }, windowsHide: true, timeout: 15000, encoding: "utf8" });
        const result = { status: probe.status === 0 ? "passed" : "failed", exitCode: probe.status, output: probe.stdout, error: probe.stderr || probe.error?.message };
        writeJson(path.join(reportDir, "shell-preflight.json"), result);
        console.log(JSON.stringify({ event: "shell-preflight", ...result }));
        if (probe.status !== 0) throw new Error("Noninteractive shell safety preflight failed");
    }
    if (!args.includes("--launch")) return;
    env.SLTERM_BASELINE_SECONDS = String(seconds);
    env.SLTERM_BASELINE_SHOW = args.includes("--show") ? "1" : "0";
    env.SLTERM_BASELINE_TERMINALS = String(terminalCount);
    const electronArgs = [`--user-data-dir=${dirs.electron}`, __filename, "--electron-child", root];
    if (debugPort) electronArgs.unshift(`--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1");
    const child = spawn(require("electron"), electronArgs, { cwd: dirs.home, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = fs.createWriteStream(path.join(reportDir, "electron.stdout.log"));
    const stderr = fs.createWriteStream(path.join(reportDir, "electron.stderr.log"));
    child.stdout.pipe(stdout); child.stderr.pipe(stderr);
    let hardStop;
    function requestStop() { fs.writeFileSync(path.join(root, "stop-request"), "stop"); }
    process.once("SIGINT", requestStop); process.once("SIGTERM", requestStop);
    child.once("spawn", () => {
        writeJson(path.join(reportDir, "process.json"), { pid: child.pid, launcherPid: process.pid, command: require("electron"), args: electronArgs, cwd: dirs.home });
        console.log(JSON.stringify({ event: "started", pid: child.pid, launcherPid: process.pid, profileRoot: root, reportDir }));
        hardStop = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) spawn(path.join(systemRoot, "System32/taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        }, (seconds + 15) * 1000);
    });
    child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
    child.once("close", (code, signal) => {
        clearTimeout(hardStop);
        for (const name of ["workload.json", "electron-start.json", "windows.ndjson", "renderers.ndjson", "blocked-network.ndjson", "request-errors.ndjson", "workload-poll-error.txt", "quit-request.json"]) {
            const source = path.join(root, name);
            if (fs.existsSync(source)) fs.copyFileSync(source, path.join(reportDir, name), fs.constants.COPYFILE_EXCL);
        }
        const shellReceipts = fs.readdirSync(dirs["shell-receipts"]).filter((name) => /^shell-\d+\.json$/.test(name)).map((name) => JSON.parse(fs.readFileSync(path.join(dirs["shell-receipts"], name), "utf8").replace(/^\uFEFF/, "")));
        writeJson(path.join(reportDir, "shell-startup-receipts.json"), shellReceipts);
        const outcome = { event: "closed", code, signal, at: Date.now(), profileRoot: root, reportDir, retainedDisposableProfile: true };
        writeJson(path.join(reportDir, "exit.json"), outcome);
        console.log(JSON.stringify(outcome));
        process.exitCode = code || 0;
    });
}

(process.versions.electron ? runElectronChild() : runParent()).catch((error) => {
    console.error(error.stack);
    if (process.versions.electron) require("electron").app.exit(1);
    else process.exitCode = 1;
});
