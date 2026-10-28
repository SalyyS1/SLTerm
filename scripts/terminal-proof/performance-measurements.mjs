import { createHash, randomBytes } from 'node:crypto';
import { waitFor } from './performance-common.mjs';

const nonce = () => randomBytes(6).toString('hex');
const q = JSON.stringify;
export async function measureCommand(client, id, label, body, keyboard = false) {
    const marker = 'P' + nonce();
    const key = label + '-' + marker;
    const command = body + `;[Console]::Write(('P'+'${marker.slice(1)}'))`;
    const focus = keyboard ? await client.evaluate(`window.__sltermPerformance.focus(${q(id)})`) : undefined;
    await client.evaluate(`window.__sltermPerformance.arm(${q(key)},${q(id)},${q(marker)})`);
    if (keyboard) {
        await client.send('Input.insertText', { text: command });
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    } else await client.evaluate(`window.__sltermPerformance.send(${q(id)},${q(command + '\r')})`);
    let result;
    try { result = await waitFor(async () => {
        const value = await client.evaluate(`window.__sltermPerformance.result(${q(key)})`);
        return value?.status === 'complete' ? value : false;
    }, label + ' parsed/rendered receipt', 90000); }
    catch (error) {
        error.measurementDetails = await client.evaluate(`({measurement:window.__sltermPerformance.result(${q(key)}),
            dimensions:window.__sltermPerformance.dimensions(),textTail:window.__sltermPerformance.text(${q(id)}).slice(-16384)})`).catch(detailsError => ({ error: String(detailsError) }));
        throw error;
    }
    return { ...result, label, keyboard, focus,
        clock: 'renderer performance.now; epoch conversion performance.timeOrigin',
        boundary: 'command admission to xterm onRender with marker present, followed by one animation frame; no physical presentation claim' };
}

export async function identifyShell(client, id, kind, label = 'shell-identity') {
    const identity = 'S' + nonce();
    const metadataMarker = 'J' + nonce();
    const historyGuard = kind === 'baseline'
        ? "$o.HistorySavePath.StartsWith($env:SLTERM_BASELINE_PROFILE+'\\history\\')"
        : "$o.HistorySavePath.StartsWith((Join-Path (Split-Path -Parent $env:USERPROFILE) 'history')+[IO.Path]::DirectorySeparatorChar)";
    const body = `$o=Get-PSReadLineOption;if($o.HistorySaveStyle -ne 'SaveNothing' -or -not (${historyGuard}) -or [Console]::InputEncoding.CodePage -ne 65001 -or [Console]::OutputEncoding.CodePage -ne 65001 -or $OutputEncoding.CodePage -ne 65001){throw 'Unsafe performance shell'};function global:prompt {'> '};$j=@{pid=$PID;shell=(Get-Process -Id $PID).Path;psVersion=$PSVersionTable.PSVersion.ToString();moduleVersion=(Get-Module PSReadLine).Version.ToString();modulePath=(Get-Module PSReadLine).Path;promptPolicy='controlled-short-prompt'}|ConvertTo-Json -Compress;[Console]::Write(('J'+'${metadataMarker.slice(1)}:'+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($j))+':E'));[Console]::Write(('S'+'${identity.slice(1)}:'+$PID+':E'))`;
    const timing = await measureCommand(client, id, label, body);
    const text = await client.evaluate(`window.__sltermPerformance.text(${q(id)})`);
    const match = text.match(new RegExp(identity + ':(\\d+):E'));
    if (!match) throw new Error('Missing safe shell PID receipt ' + id);
    const encoded = text.match(new RegExp(metadataMarker + ':([A-Za-z0-9+/=]+):E'));
    if (!encoded) throw new Error('Missing shell/module metadata receipt ' + id);
    const metadata = JSON.parse(Buffer.from(encoded[1], 'base64').toString('utf8'));
    if (metadata.pid !== Number(match[1])) throw new Error('Shell metadata PID differs');
    return { id, pid: Number(match[1]), metadata, safetyVerified: true, timing };
}

export async function measureBurst(client, id) {
    const payload = ('Q'.repeat(32) + '\r\n').repeat(128);
    const timing = await measureCommand(client, id, 'burst', "[Console]::Write((('Q'*32)+[char]13+[char]10)*128)");
    return { ...timing, knownPayloadBytes: Buffer.byteLength(payload),
        knownPayloadSha256: createHash('sha256').update(payload).digest('hex'),
        payload: { ascii: 'Q', columns: 32, lines: 128, lineEnding: 'CRLF' },
        byteBoundary: 'known payload excludes receipt/input echo/prompt/ConPTY controls; xtermInputBytes counts all observed terminal.write bytes during interval' };
}

export async function measureResize(client, geometry) {
    const before = await client.evaluate('window.__sltermPerformance.dimensions()');
    const key = 'resize-' + nonce();
    await client.evaluate(`window[${q(key)}]={start:performance.now(),events:[],stable:null};
        (()=>{const state=window[${q(key)}],before=${q(before)};let previous='',same=0;
            function frame(){const dims=window.__sltermPerformance.dimensions();const signature=JSON.stringify(dims);
                same=signature===previous?same+1:0;previous=signature;
                if(state.events.length<100)state.events.push({atMs:performance.now()-state.start,dimensions:dims});
                const changed=dims.every(x=>{const old=before.find(y=>y.id===x.id);return !x.visible||!old||
                    ((x.width===old.width&&x.height===old.height)||(x.cols!==old.cols||x.rows!==old.rows));});
                if(innerWidth===${geometry.width}&&innerHeight===${geometry.height}&&same>=3&&changed&&dims.every(x=>!x.visible||(x.cols>0&&x.rows>0))){
                    state.stable={elapsedMs:performance.now()-state.start,dimensions:dims,viewport:window.__sltermPerformance.viewport()};return;}
                requestAnimationFrame(frame);
            }requestAnimationFrame(frame);})();`);
    await client.send('Emulation.setDeviceMetricsOverride', { width: geometry.width, height: geometry.height, deviceScaleFactor: geometry.dpr, mobile: false });
    const observed = await waitFor(async () => {
        const value = await client.evaluate(`window[${q(key)}]`);
        return value.stable ? value : false;
    }, 'stable terminal dimensions after resize', 20000);
    return { before, geometry, ...observed,
        boundary: 'three identical consecutive animation frame dimension observations after requested viewport; not backend resize acknowledgement' };
}

export async function verifyShellDimensions(client, id) {
    const marker = 'D' + nonce();
    const timing = await measureCommand(client, id, 'resize-shell-dimensions',
        `[Console]::Write(('D'+'${marker.slice(1)}:'+[Console]::WindowWidth+':'+[Console]::WindowHeight+':E'))`);
    const text = await client.evaluate(`window.__sltermPerformance.text(${q(id)})`);
    const match = text.match(new RegExp(marker + ':(\\d+):(\\d+):E'));
    if (!match) throw new Error('No shell dimension receipt ' + id);
    const actual = { cols: Number(match[1]), rows: Number(match[2]) };
    const rendered = (await client.evaluate('window.__sltermPerformance.dimensions()')).find(x => x.id === id);
    if (rendered.cols !== actual.cols || rendered.rows !== actual.rows) throw new Error('Renderer/ConPTY dimensions disagree: ' + JSON.stringify({ id, rendered, actual }));
    return { id, actual, rendered, timing };
}
