/* Serialized into an owned disposable renderer; no application bundle changes. */
export function installPerformanceRenderer(kind) {
    const terminals = new Map(), measurements = new Map();
    const waveInits = [], tabWaiters = new Set();
    const now = () => performance.now();
    const viewport = () => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        visibility: document.visibilityState, focused: document.hasFocus() });
    if (kind === 'baseline') window.api.onWaveInit(options => {
        waveInits.push({ tabId: options.tabId, epochMs: performance.timeOrigin + now() });
        for (const check of tabWaiters) check();
    });
    function owners(element) {
        const result = [];
        for (let node = element; node; node = node.parentElement) {
            const key = Object.keys(node).find((key) => key.startsWith('__reactFiber$'));
            for (let fiber = key && node[key], depth = 0; fiber && depth < 60; fiber = fiber.return, depth++) {
                if (fiber.memoizedProps) result.push(fiber.memoizedProps);
            }
        }
        return result;
    }
    function discover() {
        const found = [];
        for (const element of document.querySelectorAll('.xterm')) {
            let terminal, id, nodeModel;
            for (const props of owners(element)) {
                if (kind === 'native' && props.runtime?.sessions instanceof Map) {
                    for (const [candidateId, session] of props.runtime.sessions) {
                        if (session.terminal.element === element) { terminal = session.terminal; id = candidateId; }
                    }
                }
                const wrap = props.model?.termRef?.current;
                if (kind === 'baseline' && wrap?.terminal?.element === element) {
                    terminal = wrap.terminal; id = wrap.blockId; nodeModel = wrap.nodeModel;
                }
                if (terminal) break;
            }
            if (!terminal) throw new Error('Cannot resolve real xterm owner; renderer internals changed');
            if (terminals.get(id)?.terminal !== terminal) {
                const record = { id, terminal, nodeModel, bytes: 0 };
                const original = terminal.write;
                terminal.write = function (data, ...args) {
                    record.bytes += typeof data === 'string' ? new TextEncoder().encode(data).length : data.byteLength;
                    return original.call(this, data, ...args);
                };
                terminals.set(id, record);
            }
            const rect = element.getBoundingClientRect();
            found.push({ id, cols: terminal.cols, rows: terminal.rows,
                x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                visible: rect.width > 0 && rect.height > 0 && Boolean(element.getClientRects().length) });
        }
        return found;
    }
    function content(record) {
        const buffer = record.terminal.buffer.active;
        const lines = [];
        for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
        return lines.join('');
    }
    function markerRow(record, marker) {
        const buffer = record.terminal.buffer.active;
        let combined = '';
        for (let index = Math.max(0, buffer.baseY); index < Math.min(buffer.length, buffer.baseY + record.terminal.rows); index++) {
            combined += buffer.getLine(index)?.translateToString(true) ?? '';
            if (combined.includes(marker)) return index - buffer.baseY;
        }
        return -1;
    }
    function arm(key, id, marker) {
        discover();
        const record = terminals.get(id);
        if (!record) throw new Error('Missing real terminal ' + id);
        if (content(record).includes(marker)) throw new Error('Receipt marker already exists');
        const terminal = record.terminal;
        const state = { key, id, marker, status: 'pending', started: now(), startEpochMs: performance.timeOrigin + now(),
            viewport: viewport(), initialBytes: record.bytes, events: [] };
        const disposables = [];
        const event = (name, extra = {}) => {
            if (state.events.length < 100) state.events.push({ name, atMs: now() - state.started, ...extra });
        };
        disposables.push(terminal.onData(data => event('xterm-input', { bytes: new TextEncoder().encode(data).length })));
        const capture = event => {
            const sameTerminal = event.target === terminal.textarea;
            if (sameTerminal) state.events.push({ name: 'dom-' + event.type, atMs: now() - state.started,
                dataLength: event.data?.length ?? 0, key: event.type.startsWith('key') ? event.key : undefined });
        };
        for (const name of ['keydown', 'keyup', 'beforeinput', 'input']) document.addEventListener(name, capture, true);
        disposables.push({ dispose: () => { for (const name of ['keydown', 'keyup', 'beforeinput', 'input']) document.removeEventListener(name, capture, true); } });
        disposables.push(terminal.onWriteParsed(() => {
            if (content(record).includes(marker) && state.parsedMs === undefined) {
                state.parsedMs = now() - state.started; event('marker-parsed');
            }
        }));
        disposables.push(terminal.onRender(({ start, end }) => {
            const row = markerRow(record, marker);
            if (row < start || row > end || state.renderMs !== undefined) return;
            // onRender is an actual xterm refresh event. The following RAF records
            // a browser frame boundary; neither proves physical pixel presentation.
            state.renderMs = now() - state.started; event('xterm-render', { start, end, markerEndRow: row });
            requestAnimationFrame(() => {
                state.frameMs = now() - state.started;
                state.endEpochMs = performance.timeOrigin + now();
                state.xtermInputBytes = record.bytes - state.initialBytes;
                state.status = 'complete'; event('animation-frame');
                for (const item of disposables) item.dispose();
            });
        }));
        measurements.set(key, state);
        return { key, started: state.started, startEpochMs: state.startEpochMs };
    }
    async function send(id, data) {
        if (kind === 'native') return window.__TAURI_INTERNALS__.invoke('proof_request', {
            request: { version: 1, id: ++window.__sltermPerformance.serial, method: 'input', session_id: id, data } });
        return window.RpcApi.ControllerInputCommand(window.TabRpcClient,
            { blockid: id, inputdata64: btoa(data) }, { timeout: 30000 });
    }
    window.__sltermPerformance = { serial: 4100000, kind, discover, viewport, arm, send,
        result: (key) => measurements.get(key),
        text: (id) => content(terminals.get(id)),
        focus: async (id) => {
            discover(); const record = terminals.get(id);
            record.nodeModel?.focusNode();
            await new Promise(resolve => requestAnimationFrame(resolve));
            record.terminal.focus();
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (document.activeElement !== record.terminal.textarea) throw new Error('Intended xterm textarea did not retain DOM focus');
            return { id, focused: true, viewport: viewport() };
        },
        dimensions: () => discover().map(({ id, cols, rows, width, height, visible }) => ({ id, cols, rows, width, height, visible })),
        waitForTabActivation: (tabId, afterEpochMs) => new Promise((resolve, reject) => {
            let timer;
            const check = () => {
                const event = waveInits.find(item => item.tabId === tabId && item.epochMs >= afterEpochMs);
                if (!event) return;
                tabWaiters.delete(check); clearTimeout(timer);
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    try { resolve({ event, endEpochMs: performance.timeOrigin + now(), viewport: viewport(),
                        activeDom: Boolean(document.querySelector('[data-tab-id="' + tabId + '"].active')),
                        dimensions: window.__sltermPerformance.dimensions() }); }
                    catch (error) { reject(error); }
                }));
            };
            timer = setTimeout(() => { tabWaiters.delete(check); reject(new Error('No destination wave-init activation event')); }, 15000);
            tabWaiters.add(check); check();
        }),
        epochMs: () => performance.timeOrigin + now() };
    return { installed: true, viewport: viewport() };
}
