import { waitFor } from './performance-common.mjs';
import { connectCdp } from './cdp-client.mjs';
import { installPerformanceRenderer } from './performance-renderer.mjs';

export async function prepareAdapter(client, kind, options) {
    let activeClient = client;
    const clients = new Map(), extraClients = new Set();
    const call = async (expression) => {
        try { return await activeClient.evaluate(expression); }
        catch (error) { error.measurementDetails ??= { failedExpression: expression.slice(0, 1024),
            clientRole: activeClient === client ? 'initial' : 'destination' }; throw error; }
    };
    const discovered = () => call('window.__sltermPerformance.discover()');
    const running = kind === 'native'
        ? "document.querySelector('.connection-state')?.textContent.includes('connected') && [...document.querySelectorAll('.pane-state')].some(x=>x.textContent==='Đang chạy')"
        : "Boolean(window.TabRpcClient && window.WOS && document.querySelector('.xterm'))";
    await waitFor(() => call(running), 'initial shell/controller');
    let baseline;
    if (kind === 'baseline') baseline = await call(`(async()=>{
        const get=async(ref)=>window.WOS.callBackendService('object','GetObject',[ref],true);
        const client=await window.WOS.callBackendService('client','GetClientData',[],true);
        const win=await get('window:'+client.windowids[0]); const workspace=await get('workspace:'+win.workspaceid);
        return {workspaceId:workspace.oid,tabId:workspace.activetabid};
    })()`);
    if (baseline) clients.set(baseline.tabId, client);
    async function createTerminal(tabId = baseline?.tabId) {
        if (kind === 'native') return call(`(()=>{
            const button=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Terminal mới'||x.textContent.trim()==='Terminal mới');
            if (!button || button.disabled) throw new Error('New terminal UI unavailable'); button.click(); return true;
        })()`);
        return call(`window.RpcApi.CreateBlockCommand(window.TabRpcClient,{
            tabid:${JSON.stringify(tabId)},blockdef:{meta:{view:'term',controller:'shell','cmd:cwd':window.api.getHomeDir()}},
            rtopts:{termsize:{rows:24,cols:80}},focused:false},{timeout:30000})`);
    }
    async function waitCount(count) {
        return waitFor(async () => {
            const items = await discovered();
            if (items.length !== count) return false;
            if (kind === 'native' && !await call("[...document.querySelectorAll('.pane-state')].every(x=>x.textContent==='Đang chạy')")) return false;
            if (kind === 'baseline') {
                const running = await call(`Promise.all(${JSON.stringify(items.map(item => item.id))}.map(id=>
                    window.WOS.callBackendService('block','GetControllerStatus',[id],true))).then(items=>items.every(item=>item?.shellprocstatus==='running'))`);
                if (!running) return false;
            }
            return items;
        }, count + ' real xterm instances');
    }
    async function createTab() {
        if (kind === 'native') {
            await call("document.querySelector('.new-workspace').click()");
            await waitFor(() => call("Boolean(document.querySelector('dialog[open] input[name=name]'))"), 'new workspace form');
            await call(`(()=>{const form=document.querySelector('dialog[open] form');
                form.querySelector('input[name=name]').value='Performance second workspace'; form.requestSubmit(); return true;})()`);
            await waitFor(() => call("document.querySelectorAll('.workspace-tab').length===2 && document.querySelectorAll('.terminal-pane').length===11"), 'second workspace shell');
            return { initial: 0, second: 1, totalShells: 11, topology: 'ten-shell workspace plus one-shell workspace' };
        }
        const tabId = await call(`window.WOS.callBackendService('workspace','CreateTab',[${JSON.stringify(baseline.workspaceId)},'Performance second tab',true],true)`);
        await waitFor(() => call(`Boolean(document.querySelector('[data-tab-id="${tabId}"]'))`), 'second tab UI');
        const tab = await call(`window.WOS.callBackendService('object','GetObject',['tab:${tabId}'],true)`);
        if (tab.blockids.length === 0) await createTerminal(tabId);
        else if (tab.blockids.length !== 1) throw new Error('Unexpected second-tab topology');
        // Electron owns one distinct WebContentsView per tab. The backend object
        // route alone does not activate/create that native view; use the real UI.
        const originalTarget = (await client.send('Target.getTargetInfo')).targetInfo.targetId;
        await call(`document.querySelector('[data-tab-id="${tabId}"]').click()`);
        const next = await waitFor(async () => {
            const response = await fetch(`http://127.0.0.1:${options.port}/json/list`, { signal: AbortSignal.timeout(1000) });
            for (const target of await response.json()) {
                if (target.type !== 'page' || !target.url.startsWith('file:') || target.id === originalTarget) continue;
                // This argument bounds every later CDP command as well as
                // discovery; retain the initial client's 30-second budget.
                const candidate = await connectCdp(options.port, item => item.id === target.id, 30000);
                let accepted = false;
                try {
                    accepted = await candidate.evaluate("Boolean(window.TabRpcClient && window.WOS && document.querySelector('.xterm'))");
                    if (accepted) return candidate;
                } finally { if (!accepted) candidate.close(); } // Ignore an uninitialized hot spare.
            }
            return false;
        }, 'owned second-tab CDP target', 30000);
        extraClients.add(next); clients.set(tabId, next); activeClient = next;
        await waitFor(() => call("Boolean(window.TabRpcClient && window.WOS && document.querySelector('.xterm'))"), 'destination tab renderer');
        await next.send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: options.dpr, mobile: false });
        await call(`(${installPerformanceRenderer.toString()})('baseline')`);
        const current = await waitFor(async () => { const items = await discovered(); return items.length === 1 ? items : false; }, 'second tab xterm');
        const expected = await call(`window.WOS.callBackendService('object','GetObject',['tab:${tabId}'],true)`);
        if (!expected.blockids.includes(current[0].id)) throw new Error('CDP target does not own the second tab shell');
        await waitFor(() => call(`window.WOS.callBackendService('block','GetControllerStatus',[${JSON.stringify(current[0].id)}],true)
            .then(item=>item?.shellprocstatus==='running')`), 'second tab shell controller');
        return { initial: baseline.tabId, second: tabId, totalShells: 11, topology: 'ten-shell tab plus one-shell tab' };
    }
    async function switchTab(target) {
        if (kind === 'baseline') {
            const destination = clients.get(target);
            if (!destination) throw new Error('No owned destination CDP context');
            const before = await call('window.__sltermPerformance.epochMs()');
            const activation = destination.evaluate(`window.__sltermPerformance.waitForTabActivation(${JSON.stringify(target)},${before})`)
                .then(value => ({ value }), error => ({ error }));
            const clickEpochMs = await call(`(()=>{const at=window.__sltermPerformance.epochMs();
                document.querySelector('[data-tab-id="${target}"]').click();return at;})()`);
            const observed = await activation;
            if (observed.error) {
                observed.error.measurementDetails = { phase: 'destination-tab-activation', target,
                    awaited: 'host wave-init followed by two animation frame callbacks', observerDeadlineMs: 15000,
                    cdpCommandDeadlineMs: 30000, clickEpochMs };
                throw observed.error;
            }
            if (!observed.value.activeDom) throw new Error('Destination active tab DOM does not match host activation');
            activeClient = destination;
            return { target, clickEpochMs, ...observed.value, elapsedMs: observed.value.endEpochMs - clickEpochMs,
                boundary: 'origin UI click to destination host wave-init plus two animation frames; native WebContentsView final positioning/pixel presentation not observed',
                clock: 'cross-renderer performance.timeOrigin+performance.now epoch conversions; CDP/instrumentation overhead included' };
        }
        const selector = kind === 'native' ? `.workspace-tab:nth-child(${target + 1}) .tab-select` : `[data-tab-id="${target}"]`;
        const active = kind === 'native' ? `.workspace-tab:nth-child(${target + 1})[data-active=true]` : `[data-tab-id="${target}"].active`;
        return call(`new Promise((resolve,reject)=>{
            const started=performance.now(); const trace=[];
            const button=document.querySelector(${JSON.stringify(selector)}); if(!button){reject(new Error('Tab UI missing'));return;}
            let timer; const observer=new MutationObserver(check);
            function check(){if(!document.querySelector(${JSON.stringify(active)}))return;
                observer.disconnect();clearTimeout(timer);trace.push({name:'active-dom',atMs:performance.now()-started});
                requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({target:${JSON.stringify(target)},
                    elapsedMs:performance.now()-started,trace,viewport:window.__sltermPerformance.viewport(),
                    dimensions:window.__sltermPerformance.dimensions(),boundary:'active tab DOM followed by two animation frame callbacks; no pixel presentation claim'})));}
            observer.observe(document.body,{subtree:true,attributes:true,childList:true});
            timer=setTimeout(()=>{observer.disconnect();reject(new Error('Tab active state timed out'));},15000);
            trace.push({name:'click',atMs:performance.now()-started});button.click();check();
        })`);
    }
    return { discovered, createTerminal, waitCount, createTab, switchTab, getClient: () => activeClient,
        close: () => { for (const extra of extraClients) extra.close(); } };
}
