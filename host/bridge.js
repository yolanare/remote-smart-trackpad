import { spawn } from 'node:child_process';

export function startBridge(script, onExit) {
    const process = spawn('powershell.exe', ['-NoProfile', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', script], {
        stdio: ['pipe', 'pipe', 'inherit'],
        windowsHide: true,
    });
    const pending = new Map();
    let sequence = 0,
        buffer = '',
        available = true;
    function stopped(error) {
        if (!available) return;
        available = false;
        for (const request of pending.values()) request.reject(error);
        pending.clear();
        onExit(error);
    }
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (chunk) => {
        buffer += chunk;
        for (let end; (end = buffer.indexOf('\n')) >= 0;) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            if (!line) continue;
            try {
                const result = JSON.parse(line);
                pending.get(result.id)?.resolve(result);
            } catch (error) {
                console.error('Bridge response error:', error.message);
            }
        }
    });
    process.on('error', stopped);
    process.stdin.on('error', stopped);
    process.on('exit', (code) => stopped(new Error(`Windows bridge stopped (${code})`)));
    return {
        get available() {
            return available;
        },
        stop() {
            process.kill();
        },
        command(action, data = {}) {
            if (!available) return Promise.reject(new Error('Windows bridge unavailable'));
            const id = ++sequence;
            return new Promise((resolve, reject) => {
                const finish = (callback, value) => {
                    clearTimeout(timeout);
                    pending.delete(id);
                    callback(value);
                };
                const timeout = setTimeout(
                    () => finish(reject, new Error('Windows did not respond')),
                    action.startsWith('mirror') ? 30000 : 12000
                );
                pending.set(id, {
                    resolve: (value) => finish(resolve, value),
                    reject: (error) => finish(reject, error),
                });
                process.stdin.write(JSON.stringify({ id, action, ...data }) + '\n');
            });
        },
    };
}
