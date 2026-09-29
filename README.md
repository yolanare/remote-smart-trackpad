# Remote Smart Trackpad

A local smartphone remote for a Windows PC. The PC owns access, WebSocket transport and Windows input; the phone owns the controls and mirrors the focused PC text field. [UX specification](remote-smart-trackpad-handoff.md).

## Run

1. Install Node.js 20 or newer on Windows.
2. Double-click [Start Remote Smart Trackpad.cmd](Start%20Remote%20Smart%20Trackpad.cmd). First use installs dependencies, builds the web assets and compiles the native tray host using Windows' .NET Framework compiler. The launcher exits; the server continues in the notification area.
3. Right-click the tray icon → **Connect a device**. Scan a private-network QR code, enter your name and the six-digit pairing code. Codes expire after ten minutes; refresh them on the PC setup page.

The tray offers **Show console**, **Stop server**, and **Start with Windows**. Show console opens a native Windows console with live logs from `.data/server.log`. Closing it leaves the server running; stopping the server closes the console and exits the tray. Automatic start is enabled on the first tray launch and respects later changes. Windows launches `.data/RemoteSmartTrackpad.exe` directly through the current user's Run entry, without a CMD or PowerShell window at sign-in. The manual CMD may show installation/build output. The launcher migrates only the previous scheduled task belonging to this checkout.

Keep the project and Node.js at their registered locations. After moving either, rerun the launcher and toggle startup off/on. [Manage Auto Start.cmd](Manage%20Auto%20Start.cmd) also accepts `enable`, `disable` and `status`. A previous foreground server must be stopped before switching to the tray. For development: `npm ci`, then `npm start` (foreground console; no startup registration).

## Device access

[Manage Tokens.cmd](Manage%20Tokens.cmd) opens the terminal manager: arrows select, Delete requests revocation, Y confirms, R refreshes, Q exits. Run it while the server is running. Revocation closes the device's active socket and releases input; the phone must pair again.

`.data/tokens.json` stores hashes, user names and first-connection timestamps. Old hash-only tokens migrate without revoking access; their phones are prompted for a name. Their historical first connection cannot be reconstructed and remains unknown until identification. Raw tokens stay in the phone's local storage. There is no phone-side access management.

## Controls and text

The pointer area moves the PC cursor and its dot pattern. Left/right buttons support holding while moving; the middle button sits between the two native scroll rails. Native browser scrolling supplies momentum; each rail recenters only after scrolling settles. The menu toggles function (F1–F14, as drawn in Figma), media, edit and modifier rows, plus sticky modifiers.

Opening the editor reads the entire focused editable UI Automation text field, including its selection. While open it follows PC focus, text and selection changes. It closes only through **Close text editor**. Non-text, password, read-only and unsupported fields clear/disable the mirror without closing it. Only the enabled modifier row remains visible during editing. The viewport follows the visible area above the native phone keyboard.

The phone sends changed spans, serializes edits and waits for IME composition to commit. Windows verifies field identity and revision before applying changes. A changed PC field wins over pending mobile state; rejected or uncertain edits are reconciled from a fresh PC snapshot, never replayed into another field. Reconnection rereads the PC. This deliberately replaces the previous persistent-draft workflow. Text is not stored in browser persistence.

The mirror polls while visible every 200 ms and only sends full snapshots when something changes. A field is limited to 262,144 UTF-16 code units; larger fields are reported as unavailable. Inserts are split at grapheme boundaries into at most 16,384 code units. UI Automation providers differ in their character units, so the bridge checks selected text before replacement and refuses ranges it cannot verify. Windows may reject input into elevated apps.

## Network and HTTPS

The server binds loopback and private IPv4 adapters only. Allow the private Windows firewall network when prompted. Port 8765 is configurable with `REMOTE_SMART_TRACKPAD_PORT`; `REMOTE_SMART_TRACKPAD_DATA_DIRECTORY` isolates test data. mDNS provides a `.local` address when supported; the setup page also supplies IP QR codes. New private adapters are picked up automatically.

LAN HTTP is unencrypted. For trusted HTTPS, put the certificate and key in `.data/tls/cert.pem` and `.data/tls/key.pem`, covering the host name/IP you use, and trust the issuing CA on the phone. Restart the host. Setup stays on HTTP loopback; private listeners use HTTPS/WSS. Changing origin requires pairing again. Chrome's PWA installation requires trusted HTTPS. Never copy the private key to the phone.

## Structure and validation

| Module                                           | Responsibility                                                  |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `host/server.js`                                 | HTTP routes, listener lifecycle, setup and discovery            |
| `host/access.js`                                 | Token persistence, migration, identity and revocation           |
| `host/transport.js`                              | WebSocket framing, active controller, ordering and heartbeat    |
| `host/bridge.js`                                 | Windows child process and acknowledged commands                 |
| `host/windows-input.ps1`, `host/text-mirror.ps1` | Native input and authoritative text snapshots/edits             |
| `host/TrayHost.cs`                               | Native tray, hidden server, console and startup preference      |
| `web/logic/`                                     | Connection, motion batching and mirror state                    |
| `web/ui/`                                        | Pointer, native scroll, keys and text Web Components            |
| `web/style.css`                                  | Shared colors, spacing, rem dimensions and compact editor state |

`npm run build` bundles with esbuild and tree-shakes named Lucide imports. Inter fonts are local. `web/dist` is generated; runtime needs no CDN. `npm run check` checks JavaScript syntax; `npm test` covers transport/revocation, mirror races, IME and Unicode diffs. With Node.js 22+ and Chrome installed at its standard Windows path, `npm run test:browser` exercises pairing, Figma-sized layouts, row settings and native scroll; it writes screenshots and `.data/browser-report.json`.

`powershell -NoProfile -Mta -ExecutionPolicy Bypass -File scripts/windows-mirror-check.ps1` briefly opens two disposable text fields and verifies actual UI Automation reading, writing, selection and stale-focus rejection. It requires an interactive Windows desktop, not an isolated sandbox, and writes `.data/windows-mirror-report.json`.

After the normal tray has run once, `powershell -NoProfile -Sta -ExecutionPolicy Bypass -File scripts/tray-check.ps1` checks its menu actions against a separate server and data directory. It temporarily toggles and restores the current user's startup entry, tests console launch, reopening and server shutdown, and writes `.data/tray-report.json`.

Remaining physical-device checks: Gboard/IME and viewport resizing on Android, native touch momentum over long gestures, LAN/mDNS/firewall behavior, PWA installation, real Windows editors (Notepad, VS Code, Word, browser fields), and an actual Windows sign-in. Browser emulation and the controlled UI Automation fixture do not prove these combinations.

## References

- [Figma screens](https://www.figma.com/design/IwpOo2N0yhqFFIFqEHERPH/Untitled?node-id=0-1)
- [Lucide](https://lucide.dev/guide/lucide), [esbuild tree shaking](https://esbuild.github.io/api/#tree-shaking)
- [Microsoft TextPattern](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-textpattern-overview), [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
- Setup QR codes use the locally vendored [datalog/qrcode-svg](https://github.com/datalog/qrcode-svg), under its [MIT license](web/vendor/LICENSE).
