import { generateKeyPairSync, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';

const requireFixture = createRequire(new URL('../../proof-results/ssh-proof/server/package.json', import.meta.url));
const { Server, utils } = requireFixture('ssh2');
const { STATUS_CODE: status, OPEN_MODE: openMode } = utils.sftp;

export function newHostKey() {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
    const key = utils.parseKey(pem);
    if (key instanceof Error) throw key;
    return { pem, sha256: createHash('sha256').update(key.getPublicSSH()).digest('hex') };
}

// In-memory file fixture over real SSH/SFTP. No OS account or filesystem keys.
export async function startLoopbackServer(key, onPendingRead = () => {}) {
    const clients = new Set();
    const events = [];
    const server = new Server({ hostKeys: [key.pem], algorithms: {
        serverHostKey: ['rsa-sha2-256'], kex: ['diffie-hellman-group14-sha256'],
    } }, (client) => {
        clients.add(client);
        client.on('error', (error) => events.push({ event: 'peer-error', code: error.code ?? error.level, message: error.message }));
        client.on('close', () => { events.push({ event: 'closed' }); clients.delete(client); });
        client.on('authentication', (context) => {
            events.push({ event: 'authentication', method: context.method, username: context.username });
            if (context.method === 'none' && context.username === 'fixture') context.accept();
            else context.reject();
        });
        client.on('ready', () => client.on('session', (accept) => {
            const channel = accept();
            channel.on('sftp', (acceptSftp) => attachSftp(acceptSftp(), client, events, onPendingRead));
        }));
    });
    // Deterministic owned port: EADDRINUSE fails; never pick another port.
    server.listen(19232, '127.0.0.1');
    await once(server, 'listening');
    return {
        events,
        async close() {
            for (const client of clients) client.end();
            await new Promise((resolve, reject) => {
                const deadline = setTimeout(() => {
                    for (const client of clients) client._sock.destroy();
                    reject(new Error('Loopback server cleanup exceeded 2 seconds'));
                }, 2000);
                server.close(() => { clearTimeout(deadline); resolve(); });
            });
        },
    };
}

function attachSftp(stream, client, events, onPendingRead) {
    const handles = new Map();
    const content = Buffer.from('Việt Nam 🧪\n');
    let nextHandle = 0;
    function open(id, path, flags) {
        events.push({ event: 'open', path });
        if (path === '/denied') return stream.status(id, status.PERMISSION_DENIED);
        if (!['/fixture/日本語.txt', '/fixture', '/slow', '/disconnect'].includes(path)) return stream.status(id, status.NO_SUCH_FILE);
        if (flags !== undefined && flags !== openMode.READ) return stream.status(id, status.PERMISSION_DENIED);
        const handle = Buffer.alloc(4);
        handle.writeUInt32BE(++nextHandle);
        handles.set(handle.toString('hex'), { path, listed: false });
        stream.handle(id, handle);
    }
    stream.on('OPEN', open);
    stream.on('OPENDIR', (id, path) => open(id, path));
    stream.on('READ', (id, handle, offset, length) => {
        const state = handles.get(handle.toString('hex'));
        if (!state) return stream.status(id, status.FAILURE);
        events.push({ event: 'read', path: state.path });
        if (state.path === '/slow') { onPendingRead(); return; }
        if (state.path === '/disconnect') { client.end(); return; }
        if (offset >= content.length) stream.status(id, status.EOF);
        else stream.data(id, content.subarray(offset, offset + length));
    });
    stream.on('READDIR', (id, handle) => {
        const state = handles.get(handle.toString('hex'));
        if (!state) return stream.status(id, status.FAILURE);
        if (state.listed) return stream.status(id, status.EOF);
        state.listed = true;
        stream.name(id, [
            { filename: '日本語.txt', longname: '日本語.txt', attrs: { mode: 0o100644, size: content.length } },
            { filename: 'link', longname: 'link', attrs: { mode: 0o120777, size: 0 } },
        ]);
    });
    stream.on('READLINK', (id, path) => {
        if (path !== '/fixture/link') return stream.status(id, status.NO_SUCH_FILE);
        events.push({ event: 'readlink', path });
        stream.name(id, [{ filename: '/fixture/日本語.txt', longname: '/fixture/日本語.txt', attrs: {} }]);
    });
    stream.on('CLOSE', (id, handle) => {
        const existed = handles.delete(handle.toString('hex'));
        stream.status(id, existed ? status.OK : status.FAILURE);
    });
}
