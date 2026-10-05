// A busy app never holds up the pointer: the real Windows bridge (host/bridge.js) reads the focused field of a test
// window whose UI thread freezes (tests/fixtures/hung-window.ps1), as a browser streaming a long answer does, and a
// pointer move sent right after must still answer at once. Fails when the move waits behind the read.
//
// About 25 seconds. The test window comes to the foreground: leave the PC alone meanwhile. The bridge runs with the
// input guard (only the test window takes input) and the move is 0,0: the pointer does not move.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { startBridge } from '../../host/bridge.js';

const marker = `bridge-busy-check-${process.pid}`;
process.env.REMOTE_SMART_TRACKPAD_INPUT_GUARD = marker;
const bridge = startBridge(path.resolve('host/windows/windows-bridge.ps1'), () => {});
const window = spawn(
    'powershell.exe',
    [
        '-NoProfile',
        '-Sta',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'tests/fixtures/hung-window.ps1',
        marker,
        '2500',
        '15000',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: false }
);
const frozen = new Promise((resolve) =>
    window.stdout.on('data', (chunk) => String(chunk).includes('frozen') && resolve())
);
/** How long a command takes, and how it ended. */
async function timed(action, data = {}) {
    const started = performance.now();
    const outcome = await bridge.command(action, data).then(
        (result) => (result.ok ? 'ok' : result.error),
        (error) => error.message
    );
    return { action, ms: Math.round(performance.now() - started), outcome };
}
let failed = true;
try {
    // The first read loads the bridge's UI Automation code: not the case under check.
    await timed('mirror-read');
    await frozen;
    const read = timed('mirror-read');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const move = await timed('move', { dx: 0, dy: 0 });
    console.log(JSON.stringify({ move, read: await read }));
    failed = move.outcome !== 'ok' || move.ms > 1500;
    console.log(failed ? `FAIL: the move waited ${move.ms} ms behind the read` : `ok: the move took ${move.ms} ms`);
} finally {
    bridge.stop();
    window.kill();
    await once(window, 'exit').catch(() => {});
    process.exitCode = failed ? 1 : 0;
}
