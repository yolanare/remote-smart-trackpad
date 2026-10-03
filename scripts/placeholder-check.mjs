// Placeholder check: opens tests/fixtures/placeholders.html in each installed browser and reads every fixture field
// through the host's own mirror code (scripts/placeholder-probe.ps1 → Read-Mirror). Placeholders must read as an
// empty field; real text must read exactly as is. Read-only: nothing is typed or clicked. The browser window comes
// to the foreground for each read, so leave the PC alone while it runs (about a minute per browser).
//   node scripts/placeholder-check.mjs [--browser=chrome,edge,firefox] [--case=id,id] [--record]
//   --record saves the facts each verdict was decided on, and the verdict, to tests/fixtures/field-facts.json: the
//   unit tests (tests/host-rules.test.mjs) replay them without browsers.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { browsers, cleanupBrowsers, installed, openBrowser } from './test-browsers.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = path.join(root, 'tests/fixtures/placeholders.html');
const option = (name) =>
    process.argv
        .find((argument) => argument.startsWith(`--${name}=`))
        ?.split('=')[1]
        .split(',');
// Always in this order, whatever the command line says: a browser started right after Firefox closes may not get
// the foreground (Windows hands it elsewhere), and Firefox last avoids that.
const wanted = Object.keys(browsers).filter((name) => (option('browser') ?? Object.keys(browsers)).includes(name));
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
    const { readable, text } = result.read;
    const singleLineRight =
        entry.singleLine === undefined || String(result.read.singleLine === true) === entry.singleLine;
    const status =
        !readable ? 'blind'
        : text === entry.expected && singleLineRight ? 'pass'
        : 'fail';
    return status !== 'pass' && entry.known?.startsWith(`${browser}:`) ? 'known' : status;
}

async function runBrowser(name, probe) {
    const server = await startFixtureServer();
    const nonce = Math.random().toString(36).slice(2, 8);
    const browser = await openBrowser(name, `${server.url}?harness=${nonce}`);
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
        await browser.close();
        await server.close();
    }
    return results;
}

// Browsers an interrupted run left open; an interruption now (Ctrl+C) closes them on the way out.
await cleanupBrowsers();
process.once('SIGINT', async () => {
    await cleanupBrowsers();
    process.exit(130);
});

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
    console.log(
        `       ui automation text ${show(field.text)} reason=${show(read.reason)} single-line=${read.singleLine === true}`
    );
    console.log(`       iaccessible2 ${content ? JSON.stringify(content) : 'unavailable'}`);
}
const probe = startProbe();
const results = [];
try {
    for (const name of wanted) {
        if (!installed(name)) {
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
if (process.argv.includes('--record')) {
    // Only verdicts the check accepted: the recording pins today's right answers, not its failures.
    const recorded = results
        .filter((entry) => ['pass', 'known'].includes(entry.status) && entry.result.facts)
        .map((entry) => ({
            browser: entry.browser,
            id: entry.id,
            facts: entry.result.facts,
            verdict: entry.result.verdict,
        }));
    await writeFile(path.join(root, 'tests/fixtures/field-facts.json'), JSON.stringify(recorded, null, 2) + '\n');
    console.log(`Recorded ${recorded.length} field verdicts to tests/fixtures/field-facts.json`);
}
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
