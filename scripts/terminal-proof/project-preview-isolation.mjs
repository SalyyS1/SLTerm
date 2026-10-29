import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { rm, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evilHost = "https://preview-isolation.invalid";

async function freePort() {
    const server = createServer();
    await new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolvePromise);
    });
    const port = server.address().port;
    await new Promise((resolvePromise) => server.close(resolvePromise));
    return port;
}

async function waitForHttp(url, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
            if (response.ok) return;
        } catch { /* The owned Vite process is still starting. */ }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error(`Timed out waiting for ${url}`);
}

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
        process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
        process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome_proxy.exe"),
    ].filter(Boolean);
    const candidate = candidates.find((path) => existsSync(path));
    if (!candidate) throw new Error("Chrome executable not found; set CHROME_PATH to run the browser isolation proof");
    return candidate;
}

function connectCdp(port, targetUrl = "about:blank") {
    return (async () => {
        const deadline = Date.now() + 15_000;
        let target;
        while (Date.now() < deadline) {
            try {
                const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
                target = targets.find((item) => item.type === "page" && item.url === targetUrl);
                if (target) break;
            } catch { /* The owned browser is still starting. */ }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
        if (!target) throw new Error("No local Chrome CDP page target");
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        let id = 0;
        const pending = new Map();
        const listeners = new Map();
        socket.addEventListener("message", ({ data }) => {
            const message = JSON.parse(data);
            if (message.id && pending.has(message.id)) {
                const task = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) task.reject(new Error(message.error.message));
                else task.resolve(message.result);
                return;
            }
            for (const listener of listeners.get(message.method) ?? []) listener(message.params);
        });
        await new Promise((resolvePromise, reject) => {
            socket.addEventListener("open", resolvePromise, { once: true });
            socket.addEventListener("error", () => reject(new Error("Chrome CDP connection failed")), { once: true });
        });
        const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
            const messageId = ++id;
            const timer = setTimeout(() => {
                pending.delete(messageId);
                reject(new Error(`CDP timed out: ${method}`));
            }, 15_000);
            pending.set(messageId, {
                resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });
            socket.send(JSON.stringify({ id: messageId, method, params }));
        });
        const evaluate = async (expression, contextId) => {
            const result = await send("Runtime.evaluate", {
                expression,
                awaitPromise: true,
                returnByValue: true,
                ...(contextId == null ? {} : { contextId }),
            });
            if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
            return result.result?.value;
        };
        return {
            evaluate,
            on(method, listener) {
                const current = listeners.get(method) ?? [];
                current.push(listener);
                listeners.set(method, current);
            },
            send,
            close() { socket.close(); },
        };
    })();
}

async function waitUntil(check, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error("Timed out waiting for browser preview");
}

function frameIds(frameTree) {
    const result = [frameTree.frame.id];
    for (const child of frameTree.childFrames ?? []) result.push(...frameIds(child));
    return result;
}

const vitePort = await freePort();
const cdpPort = await freePort();
const profile = await mkdtemp(join(tmpdir(), "slterm-preview-isolation-"));
let vite;
let browser;
let cdp;
let harnessFile;
try {
    vite = spawn(process.execPath, [join(repo, "node_modules/vite/bin/vite.js"), "--config", "vite.proof.config.ts", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: repo, stdio: "ignore", windowsHide: true });
    await waitForHttp(`http://127.0.0.1:${vitePort}/project-preview.ts`);
    browser = spawn(findChrome(), [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profile}`,
        "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    cdp = await connectCdp(cdpPort);
    const requests = [];
    const contexts = new Map();
    cdp.on("Network.requestWillBeSent", ({ request }) => requests.push(request.url));
    cdp.on("Runtime.executionContextCreated", ({ context }) => {
        if (context.auxData?.frameId) contexts.set(context.auxData.frameId, context.id);
    });
    cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }) => {
        for (const [frameId, contextId] of contexts) if (contextId === executionContextId) contexts.delete(frameId);
    });
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    const hostile = `<!doctype html><html><head>
        <base href="${evilHost}/base/">
        <meta http-equiv="refresh" content="0;url=${evilHost}/refresh">
        <link rel="stylesheet" href="${evilHost}/style.css">
        <style>@import url(${evilHost}/import.css); body { background: url(${evilHost}/css.png); color: red }</style>
    </head><body onload="window.top.__scriptAttempt = true">
        <script>window.top.__scriptAttempt = true; fetch('${evilHost}/fetch')</script>
        <a href="${evilHost}/anchor" target="_blank">external</a><a href="tauri://bridge/secret">native</a>
        <img src="&#x68;ttps://preview-isolation.invalid/entity.png" srcset="${evilHost}/set.png 1x" onerror="window.top.__scriptAttempt = true">
        <div style="background-image:url(${evilHost}/inline.png); color: blue">visible</div>
    </body></html>`;
    const moduleUrl = `http://127.0.0.1:${vitePort}/project-preview.ts`;
    harnessFile = join(repo, "frontend/terminal-proof/.project-preview-isolation.html");
    await writeFile(harnessFile, `<!doctype html><meta charset="utf-8"><body><script type="module">
        import { projectPreviewDocument } from './project-preview.ts';
        const source = ${JSON.stringify(hostile)};
        const srcdoc = projectPreviewDocument(source);
        const frame = document.createElement('iframe');
        frame.id = 'preview'; frame.sandbox = ''; frame.referrerPolicy = 'no-referrer'; frame.srcdoc = srcdoc;
        frame.addEventListener('load', () => { window.__previewReady = true; });
        document.body.append(frame);
        window.__previewSrcdoc = srcdoc;
    </script>`);
    const harnessUrl = `http://127.0.0.1:${vitePort}/.project-preview-isolation.html`;
    await cdp.send("Page.navigate", { url: harnessUrl });
    await waitUntil(async () => (await cdp.evaluate("location.href")) === harnessUrl);
    await waitUntil(async () => cdp.evaluate("window.__previewReady === true"));
    const parent = await cdp.evaluate(`(() => {
        const frame = document.querySelector('#preview');
        return {
            sandbox: frame.sandbox.value,
            referrerPolicy: frame.referrerPolicy,
            srcdocHasScript: /<script\\b/i.test(frame.srcdoc),
            srcdocHasExternalUrl: /preview-isolation\\.invalid|tauri:\\/\\//i.test(frame.srcdoc),
            srcdocHasRefresh: /<meta[^>]+refresh/i.test(frame.srcdoc),
            srcdocHasAnchorHref: /<a\\b[^>]+\\bhref=/i.test(frame.srcdoc),
            topUrl: location.href,
            tauriBridgeInParent: '__TAURI_INTERNALS__' in window,
        };
    })()`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    const tree = await cdp.send("Page.getFrameTree");
    const ids = frameIds(tree.frameTree);
    const mainFrameId = tree.frameTree.frame.id;
    const childFrameId = ids.find((frameId) => frameId !== mainFrameId && contexts.has(frameId));
    if (!childFrameId) {
        console.error(JSON.stringify({ frameTree: tree.frameTree, contexts: [...contexts] }));
        throw new Error("No sandboxed preview execution context was observed");
    }
    const child = await cdp.evaluate(`(() => {
        const parentAccess = (() => { try { void window.parent.document; return false; } catch { return true; } })();
        const topNavigation = (() => { try { window.top.location.href; return false; } catch { return true; } })();
        return {
            origin: location.origin,
            url: location.href,
            scriptCount: document.scripts.length,
            anchorCount: document.querySelectorAll('a').length,
            anchorHref: document.querySelector('a')?.getAttribute('href') ?? null,
            resourceUrls: Array.from(document.querySelectorAll('[src], [srcset], [href], [style]')).map((node) => [node.getAttribute('src'), node.getAttribute('srcset'), node.getAttribute('href'), node.getAttribute('style')]),
            parentAccessBlocked: parentAccess,
            topNavigationBlocked: topNavigation,
            bridgePresent: '__TAURI_INTERNALS__' in window,
        };
    })()`, contexts.get(childFrameId));
    const externalRequests = requests.filter((url) => url.includes("preview-isolation.invalid") || url.startsWith("tauri:"));
    const result = { parent, child, externalRequests, requestCount: requests.length };
    if (parent.sandbox !== "" || parent.srcdocHasScript || parent.srcdocHasExternalUrl || parent.srcdocHasRefresh || parent.srcdocHasAnchorHref) throw new Error(`Sanitized srcdoc invariant failed: ${JSON.stringify(parent)}`);
    if (child.origin !== "null" || child.scriptCount !== 0 || child.anchorHref !== null || child.resourceUrls.some((values) => values.some(Boolean)) || !child.parentAccessBlocked || !child.topNavigationBlocked || child.bridgePresent) throw new Error(`Sandbox behavior invariant failed: ${JSON.stringify(child)}`);
    if (externalRequests.length) throw new Error(`Hostile preview generated network requests: ${externalRequests.join(", ")}`);
    console.log(JSON.stringify({ status: "pass", browser: "Chrome CDP", ...result }));
} finally {
    try { await cdp?.send("Browser.close"); } catch { /* Browser may already be closed after a failed proof. */ }
    cdp?.close();
    if (browser && !browser.killed) {
        browser.kill();
        await new Promise((resolvePromise) => browser.once("exit", resolvePromise));
    }
    if (vite && !vite.killed) vite.kill();
    if (harnessFile) await rm(harnessFile, { force: true });
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
