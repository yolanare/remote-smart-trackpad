# Remote Smart Trackpad

A local smartphone remote for a Windows PC. The PC owns access, WebSocket transport and Windows input; the phone owns the controls and mirrors the focused PC text field. [UX specification](remote-smart-trackpad-handoff.md).

## Run

1. Install Node.js 20 or newer on Windows.
2. Double-click [Start Remote Smart Trackpad.cmd](Start%20Remote%20Smart%20Trackpad.cmd). First use installs dependencies, builds the web assets and compiles the native tray host using Windows' .NET Framework compiler. The launcher exits; the server continues in the notification area.
3. Right-click the tray icon → **Connect a device**. Scan a private-network QR code, enter your name and the six-digit pairing code. Codes expire after ten minutes; refresh them on the PC setup page.

Running the launcher again restarts the server (the running tray stops gracefully first). The tray offers **Show console**, **Stop server**, and **Start with Windows**. Show console opens a native Windows console with live logs from `.data/server.log`. Closing it leaves the server running; stopping the server closes the console and exits the tray. Automatic start is enabled on the first tray launch and respects later changes. Windows launches `.data/RemoteSmartTrackpad.exe` directly through the current user's Run entry, without a CMD or PowerShell window at sign-in. The manual CMD may show installation/build output. The launcher migrates only the previous scheduled task belonging to this checkout.

Keep the project and Node.js at their registered locations. After moving either, rerun the launcher and toggle startup off/on. [Manage Auto Start.cmd](Manage%20Auto%20Start.cmd) also accepts `enable`, `disable` and `status`. A previous foreground server must be stopped before switching to the tray. For development: `npm ci`, then `npm start` (foreground console; no startup registration).

## Device access

[Manage Tokens.cmd](Manage%20Tokens.cmd) opens the terminal manager: arrows select, Delete requests revocation, Y confirms, R refreshes, Q exits. Run it while the server is running. Revocation closes the device's active socket and releases input; the phone must pair again. Several paired phones can control the PC at once; each releases only the keys and buttons it pressed.

`.data/tokens.json` stores hashes, user names and first-connection timestamps. Old hash-only tokens migrate without revoking access; their phones are prompted for a name. Their historical first connection cannot be reconstructed and remains unknown until identification. Raw tokens stay in the phone's local storage. There is no phone-side access management.

## Controls and text

The pointer area moves the PC cursor and its dot pattern. A tap clicks (a single tap's click waits 250 ms for a possible second tap), two quick taps double-click, and tap-then-touch-and-move drags with the left button held until the finger lifts. Left/right buttons support holding while moving; the middle button sits between the two native scroll rails. Native browser scrolling supplies momentum; each rail recenters only after scrolling settles. The menu holds mouse sliding, acceleration (an S-curve that damps slow strokes and amplifies flicks; 0 turns it off), speeds, X/Y inversion for mouse and scroll, the function, media, edit and modifier rows, sticky modifiers and an interface scale (0.25× to 8×). Defaults are the input attributes in `web/index.html`; values changed on the phone are stored locally and **Reset options to defaults** clears them. Play/pause and mute show the PC's playback and mute state, polled every 3 s only while the media row is visible.

Opening the editor reads the entire focused editable UI Automation text field, including its selection. While open it follows PC focus, text and selection changes. It closes only through **Close text editor**. Non-text, password, read-only and unsupported fields clear the mirror without closing it; typing is then sent to the PC as raw keystrokes. An invisible anchor character keeps Backspace working in an empty field, and Escape/Tab are always forwarded. Placeholders never reach the phone: UI Automation reads them like text (CSS `::before`/`::after`, `contenteditable=false` overlays, native placeholders as an embedded object or the field's name), so web fields (Chromium, Electron apps, Firefox) are checked through IAccessible2, which tells editable text from text the page only draws (`host/field-content.ps1`). A field showing only non-editable text is empty; `<input>`/`<textarea>` content is their value. A native field too small to show text is the hidden input of an editor drawn elsewhere (VS Code's editor and terminal) and counts as unreadable. The phone's Enter never presses plain Enter on the PC, which would send chat messages: Chromium rich-text fields receive Shift+Enter, the only break that keeps their caret on the new line; other fields receive a pasted line break (the clipboard is restored and excluded from clipboard history). Edits at the caret use Backspace and typing without repositioning the PC caret. Only the enabled modifier row remains visible during editing. The viewport follows the visible area above the native phone keyboard.

The phone sends changed spans, serializes edits and waits for IME composition to commit. Windows verifies field identity and revision before applying changes. A changed PC field wins over pending mobile state; rejected or uncertain edits are reconciled from a fresh PC snapshot, never replayed into another field. Reconnection rereads the PC. This deliberately replaces the previous persistent-draft workflow. Text is not stored in browser persistence.

The mirror polls every 200 ms only while the editor is open and the page is visible, and only sends full snapshots when something changes. With no editor open the host reads no text; idle phones only exchange WebSocket heartbeats. A crashed Windows bridge restarts automatically and phones reconnect on their own. A field is limited to 262,144 UTF-16 code units; larger fields are reported as unavailable. Inserts are split at grapheme boundaries into at most 16,384 code units. UI Automation providers differ in their character units, so the bridge checks selected text before replacement and refuses ranges it cannot verify. Windows may reject input into elevated apps.

## Network and HTTPS

The server binds loopback and private IPv4 adapters only. Allow the private Windows firewall network when prompted. Port 8765 is configurable with `REMOTE_SMART_TRACKPAD_PORT`; `REMOTE_SMART_TRACKPAD_DATA_DIRECTORY` isolates test data. mDNS provides a `.local` address when supported; the setup page also supplies IP QR codes. New private adapters are picked up automatically.

The private network uses HTTPS, which the PWA needs. On first start the host creates a local certificate authority in `.data/tls` and a server certificate for the PC's private IPs and `.local` name, reissued when addresses change. Each phone trusts the authority once through `http://<pc>:8765/trust` (QR code on the setup page), the only plain-HTTP page; other HTTP requests redirect to HTTPS on the same port. Then the browser offers to install the remote; the options menu shows **Install as app** or a link to the trust page. Moving from HTTP to HTTPS changes the origin, so phones pair again. Your own `.data/tls/cert.pem` and `key.pem` (without `generated.json`) are used as is. Setup stays on HTTP loopback. Never copy `ca-key.pem` to the phone.

## Structure and validation

| Module                                           | Responsibility                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `host/server.js`                                 | HTTP routes, listener lifecycle, setup and discovery             |
| `host/access.js`                                 | Token persistence, migration, identity and revocation            |
| `host/transport.js`                              | WebSocket framing, per-device ordering, held input and heartbeat |
| `host/bridge.js`                                 | Windows child process and acknowledged commands                  |
| `host/windows-input.ps1`, `host/text-mirror.ps1` | Native input and authoritative text snapshots/edits              |
| `host/TrayHost.cs`                               | Native tray, hidden server, console and startup preference       |
| `web/logic/`                                     | Connection, motion batching and mirror state                     |
| `web/ui/`                                        | Pointer, native scroll, keys and text Web Components             |
| `web/style.css`                                  | Shared colors, spacing, rem dimensions and compact editor state  |

`npm run build` bundles with esbuild and tree-shakes named Lucide imports. Inter fonts are local. `web/dist` is generated; runtime needs no CDN. `npm run check` checks JavaScript syntax; `npm test` covers transport/revocation, mirror races, IME and Unicode diffs. With Node.js 22+ and Chrome installed at its standard Windows path, `npm run test:browser` exercises pairing, Figma-sized layouts, row settings and native scroll; its throwaway host data and Chrome profile live in the system temp folder and are removed afterwards; screenshots and `browser-report.json` go to a temp folder printed at the end. `npm run test:placeholders` opens `tests/fixtures/placeholders.html` (placeholders drawn every way editors and sites do, and real text that resembles them) in each installed browser (Chrome, Edge, Firefox) and reads every field through the host's mirror code; placeholders must read as empty and real text as is. It is read-only but brings its window to the foreground for each read, so leave the PC alone for the few minutes it takes; failures print what UI Automation and IAccessible2 reported.

`powershell -NoProfile -Mta -ExecutionPolicy Bypass -File scripts/windows-mirror-check.ps1` briefly opens two disposable text fields and verifies actual UI Automation reading, writing, selection and stale-focus rejection. It requires an interactive Windows desktop, not an isolated sandbox, and writes its report to the system temp folder (path printed at the end).

After the normal tray has run once, `powershell -NoProfile -Sta -ExecutionPolicy Bypass -File scripts/tray-check.ps1` checks its menu actions against a separate server and data directory. It temporarily toggles and restores the current user's startup entry, tests console launch, reopening and server shutdown, and writes its data and report to the system temp folder (report path printed at the end).

Remaining physical-device checks: Gboard/IME and viewport resizing on Android, native touch momentum over long gestures, LAN/mDNS/firewall behavior, PWA installation, real Windows editors (Notepad, VS Code, Word, browser fields), and an actual Windows sign-in. Browser emulation and the controlled UI Automation fixture do not prove these combinations.

## References

- [Lucide](https://lucide.dev/guide/lucide), [esbuild tree shaking](https://esbuild.github.io/api/#tree-shaking)
- [Microsoft TextPattern](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-textpattern-overview), [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
- Setup QR codes use the locally vendored [datalog/qrcode-svg](https://github.com/datalog/qrcode-svg), under its [MIT license](web/vendor/LICENSE).
