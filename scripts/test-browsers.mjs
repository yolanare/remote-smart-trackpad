// Test browser windows for the checks: each runs in a throwaway profile under the system temp folder, named with
// PROFILE_PREFIX, so its processes are recognized by their command line and can always be closed, even after an
// interrupted run. Firefox gets a profile without first-run pages, prompts or Windows notifications.
//   node scripts/test-browsers.mjs --cleanup   closes leftover test browsers and removes their profiles
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROFILE_PREFIX = 'remote-smart-trackpad-test-browser-';
const programFiles = process.env.ProgramFiles ?? 'C:/Program Files';
const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)';

// app: a window with the page alone (no address bar or tabs), or a regular browser window.
const chromium = (executable) => ({
    executable,
    args: (profile, url, app) => [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-search-engine-choice-screen',
        '--force-renderer-accessibility',
        '--window-size=1200,900',
        `--user-data-dir=${profile}`,
        app ? `--app=${url}` : url,
    ],
});
// Firefox: no welcome or what's-new pages, no default browser or "pin to taskbar" prompts (in the window or as
// Windows notifications), no session restore after being closed by force, and its native UI Automation provider.
const firefoxPreferences = {
    'accessibility.uia.enable': 1,
    'app.normandy.enabled': false,
    'browser.aboutwelcome.enabled': false,
    'browser.messaging-system.whatsNewPanel.enabled': false,
    'browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons': false,
    'browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features': false,
    'browser.promo.pin.enabled': false,
    'browser.sessionstore.resume_from_crash': false,
    'browser.shell.checkDefaultBrowser': false,
    'browser.shell.didSkipDefaultBrowserCheckOnFirstRun': true,
    'browser.startup.homepage_override.mstone': 'ignore',
    'browser.startup.upgradeDialog.enabled': false,
    'browser.tabs.warnOnClose': false,
    'browser.warnOnQuit': false,
    'datareporting.policy.dataSubmissionEnabled': false,
    'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
    'default-browser-agent.enabled': false,
    'messaging-system.rsexperimentloader.enabled': false,
    'taskbar.grouping.useprofile': false,
    'toolkit.telemetry.reportingpolicy.firstRun': false,
};
export const browsers = {
    chrome: chromium(path.join(programFiles, 'Google/Chrome/Application/chrome.exe')),
    edge: chromium(path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe')),
    firefox: {
        executable: path.join(programFiles, 'Mozilla Firefox/firefox.exe'),
        prepare: (profile) =>
            writeFile(
                path.join(profile, 'user.js'),
                Object.entries(firefoxPreferences)
                    .map(([name, value]) => `user_pref("${name}", ${JSON.stringify(value)});`)
                    .join('\n')
            ),
        // -wait-for-browser keeps the launched process alive as long as the browser it hands over to.
        args: (profile, url) => ['-no-remote', '-wait-for-browser', '-profile', profile, '-new-window', url],
    },
};
export const installed = (name) => Boolean(browsers[name]) && existsSync(browsers[name].executable);

const powershell = (command) =>
    new Promise((resolve) =>
        execFile('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true }, () => resolve())
    );
/** Ends every process started with a test profile whose path contains `marker`. */
const closeProcesses = (marker) =>
    powershell(
        `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    );

/**
 * Opens `url` in a fresh window of browser `name`, with the page alone or, `app: false`, as a regular window (with
 * an address bar; Firefox always is). close() ends all its processes and removes its profile.
 */
export async function openBrowser(name, url, { app = true } = {}) {
    const browser = browsers[name];
    const profile = await mkdtemp(path.join(tmpdir(), `${PROFILE_PREFIX}${name}-`));
    await browser.prepare?.(profile);
    spawn(browser.executable, browser.args(profile, url, app), { stdio: 'ignore', detached: false });
    return {
        async close() {
            await closeProcesses(path.basename(profile));
            await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
        },
    };
}

/** Closes test browsers an interrupted run left open and removes every test profile. */
export async function cleanupBrowsers() {
    await closeProcesses(PROFILE_PREFIX);
    const removed = [];
    for (const entry of await readdir(tmpdir(), { withFileTypes: true }))
        if (entry.isDirectory() && entry.name.startsWith(PROFILE_PREFIX)) {
            await rm(path.join(tmpdir(), entry.name), {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 200,
            });
            removed.push(entry.name);
        }
    return removed;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--cleanup')) {
    const removed = await cleanupBrowsers();
    console.log(removed.length ? `Removed ${removed.length} test browser profile(s).` : 'No test browser left.');
}
