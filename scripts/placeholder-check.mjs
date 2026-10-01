// Placeholder check: opens tests/fixtures/placeholders.html in each installed browser and reads every fixture field
// through the host's own mirror code (scripts/placeholder-probe.ps1 → Read-Mirror). Placeholders must read as an
// empty field; real text must read exactly as is. Read-only: nothing is typed or clicked. The browser window comes
// to the foreground for each read, so leave the PC alone while it runs (about a minute per browser).
//   node scripts/placeholder-check.mjs [--browser=chrome,edge,firefox] [--case=id,id]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = path.join(root, 'tests/fixtures/placeholders.html');
const option = (name) =>
    process.argv
        .find((argument) => argument.startsWith(`--${name}=`))
        ?.split('=')[1]
        .split(',');
const programFiles = process.env.ProgramFiles ?? 'C:/Program Files';
const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)';
const chromium = (executable) => ({
    executable,
    args: (profile, url) => [
        '--no-first-run',
        '--no-default-browser-check',
        '--force-renderer-accessibility',
        '--window-size=1200,900',
        `--user-data-dir=${profile}`,
        `--app=${url}`,
    ],
});
const browsers = {
    chrome: chromium(path.join(programFiles, 'Google/Chrome/Application/chrome.exe')),
    edge: chromium(path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe')),
    firefox: {
        executable: path.join(programFiles, 'Mozilla Firefox/firefox.exe'),
        // A fresh profile without first-run pages, with Firefox's native UI Automation provider.
        prepare: (profile) =>
            writeFile(
                path.join(profile, 'user.js'),
                [
                    ['browser.shell.checkDefaultBrowser', false],
                    ['browser.aboutwelcome.enabled', false],
                    ['browser.startup.homepage_override.mstone', '"ignore"'],
                    ['datareporting.policy.dataSubmissionPolicyBypassNotification', true],
                    ['toolkit.telemetry.reportingpolicy.firstRun', false],
                    ['accessibility.uia.enable', 1],
                ]
                    .map(([name, value]) => `user_pref("${name}", ${value});`)
                    .join('\n')
            ),
        args: (profile, url) => ['-no-remote', '-profile', profile, '-new-window', url],
    },
};
const wanted = option('browser') ?? Object.keys(browsers);
const onlyCases = option('case');
const timeout = (promise, ms, what) =>
    Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${what}`)), ms)),
    ]);

/** The fixture page reports its cases, then asks for the next one each time it has focused the previous one. */
async function startFixtureServer() {
    const html = await readFile(fixture, 'utf8');
    let casesReceived, stepWaiter, pendingStep;
    const cases = new Promise((resolve) => (casesReceived = resolve));
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/')
            return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
        if (url.pathname === '/cases') {
            let body = '';
            for await (const chunk of request) body += chunk;
            casesReceived(JSON.parse(body));
            return response.end();
        }
        if (url.pathname === '/step') {
            pendingStep = response;
            stepWaiter?.(url.searchParams.get('done'));
            return;
        }
        response.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}/`,
        cases,
        /** Asks the page to focus a case (null ends the run) and resolves once it has. */
        focus(id) {
            const focused = new Promise((resolve) => (stepWaiter = (done) => done === id && resolve()));
            // The page may still be on its way to ask: answer its request once it is there, and only once.
            const send = () => {
                if (!pendingStep) return setTimeout(send, 20);
                const response = pendingStep;
                pendingStep = null;
                response.end(JSON.stringify({ id }));
            };
            send();
            return id ? timeout(focused, 15000, `focus ${id}`) : Promise.resolve();
        },
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

function startProbe() {
    const probe = spawn(
        'powershell.exe',
        ['-NoProfile', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/placeholder-probe.ps1')],
        { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true }
    );
    const waiting = [];
    let exited = null;
    readline.createInterface({ input: probe.stdout }).on('line', (line) => waiting.shift()?.resolve(JSON.parse(line)));
    probe.on('exit', (code) => {
        exited = new Error(`The probe stopped (${code})`);
        for (const request of waiting.splice(0)) request.reject(exited);
    });
    return {
        read: (title) =>
            timeout(
                new Promise((resolve, reject) => {
                    if (exited) return reject(exited);
                    waiting.push({ resolve, reject });
                    probe.stdin.write(JSON.stringify({ title }) + '\n');
                }),
                30000,
                'probe read'
            ),
        stop: () => probe.stdin.end(),
    };
}

function verdict(browser, entry, result) {
    if (!result.ok) return 'error';
    const { available, text } = result.read;
    const status =
        !available ? 'blind'
        : text === entry.expected ? 'pass'
        : 'fail';
    return status !== 'pass' && entry.known?.startsWith(`${browser}:`) ? 'known' : status;
}

async function runBrowser(name, probe) {
    const browser = browsers[name];
    const server = await startFixtureServer();
    const profile = await mkdtemp(path.join(tmpdir(), `remote-smart-trackpad-placeholders-${name}-`));
    const nonce = Math.random().toString(36).slice(2, 8);
    await browser.prepare?.(profile);
    const child = spawn(browser.executable, browser.args(profile, `${server.url}?harness=${nonce}`), {
        stdio: 'ignore',
    });
    const results = [];
    try {
        const cases = (await timeout(server.cases, 30000, `${name} start`)).filter(
            (entry) => !onlyCases || onlyCases.includes(entry.id)
        );
        // Foreground first, so the page's focus calls land in an active window.
        await probe.read(`Placeholder fixtures ${nonce}`);
        for (const entry of cases) {
            const started = performance.now();
            await server.focus(entry.id);
            const result = await probe.read(`Placeholder fixtures ${nonce} ${entry.id}`);
            const checked = { browser: name, ...entry, status: verdict(name, entry, result), result };
            print(checked, performance.now() - started);
            results.push(checked);
        }
        await server.focus(null);
    } finally {
        // The browser runs several processes; end them all, then remove its throwaway profile.
        await new Promise((resolve) =>
            spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('exit', resolve)
        );
        await server.close();
        await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
    return results;
}

// What an interrupted run left behind: its browsers (recognized by their throwaway profile) and their profiles.
const leftover = 'remote-smart-trackpad-placeholders-';
await new Promise((resolve) =>
    spawn(
        'powershell.exe',
        [
            '-NoProfile',
            '-Command',
            `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${leftover}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ],
        { stdio: 'ignore', windowsHide: true }
    ).on('exit', resolve)
);
for (const entry of await readdir(tmpdir(), { withFileTypes: true }))
    if (entry.isDirectory() && entry.name.startsWith(leftover))
        await rm(path.join(tmpdir(), entry.name), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

const show = (value) => (value === undefined || value === null ? '—' : JSON.stringify(value));
function print(entry, elapsed) {
    const got = entry.result.ok ? entry.result.read.text : entry.result.error;
    const mark = entry.status === 'pass' ? 'ok  ' : entry.status.toUpperCase().padEnd(4);
    const time = `${Math.round(elapsed)}ms`.padStart(7);
    console.log(
        `${mark} ${entry.browser.padEnd(8)} ${entry.kind.padEnd(11)} ${entry.id.padEnd(31)}${time}  ${show(got)}`
    );
    if (entry.status === 'pass') return;
    console.log(`       expected ${show(entry.expected)}`);
    if (entry.status === 'known')
        return console.log(`       known limitation: ${entry.known.split(': ').slice(1).join(': ')}`);
    if (!entry.result.ok) return;
    const { field, content, read } = entry.result;
    console.log(
        `       field ${field.framework} ${field.type} name=${show(field.name)} class=${show(field.className)}`
    );
    console.log(`       ui automation text ${show(field.text)} reason=${show(read.reason)}`);
    console.log(`       iaccessible2 ${content ? JSON.stringify(content) : 'unavailable'}`);
}
const probe = startProbe();
const results = [];
try {
    for (const name of wanted) {
        if (!browsers[name] || !existsSync(browsers[name].executable)) {
            console.log(`${name}: not installed, skipped`);
            continue;
        }
        console.log(`${name}: reading fixtures…`);
        results.push(...(await runBrowser(name, probe)));
    }
} finally {
    probe.stop();
}

const failures = results.filter((entry) => !['pass', 'known'].includes(entry.status));
const report = path.join(tmpdir(), 'remote-smart-trackpad-placeholder-report.json');
await writeFile(report, JSON.stringify(results, null, 2));
console.log();
for (const name of new Set(results.map((entry) => entry.browser))) {
    const own = results.filter((entry) => entry.browser === name);
    const passed = own.filter((entry) => entry.status === 'pass').length;
    const known = own.filter((entry) => entry.status === 'known').length;
    console.log(
        `${name}: ${passed}/${own.length} passed${known ? `, ${known} known limitation${known > 1 ? 's' : ''}` : ''}`
    );
}
console.log(
    `${failures.length ? `${failures.length} failed` : 'No failure'} in ${results.length} reads. Report: ${report}`
);
process.exitCode = failures.length ? 1 : 0;
