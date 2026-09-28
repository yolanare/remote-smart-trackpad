# Remote Smart Trackpad

Local Android web remote for a Windows PC. The current implementation is an early working build based on [the product handoff](remote-smart-trackpad-handoff.md). It uses a Node.js server with a small mDNS dependency, a PowerShell/.NET Framework bridge for Windows UI Automation and `SendInput`, and a small browser interface. These components communicate through a command protocol with acknowledgements; the bridge can later be replaced independently.

## Run

1. Install Node.js 20 or newer on Windows.
2. Double-click [Start Remote Smart Trackpad.cmd](Start%20Remote%20Smart%20Trackpad.cmd). It runs `npm ci` on first use. For a terminal start, run `npm ci` and then `npm start`. If the host is already running, the launcher opens its pairing page without starting a second copy.
3. Allow inbound access on your **private** Windows network if the firewall asks. The server listens on loopback and private IPv4 interfaces only, port 8765 by default (`REMOTE_SMART_TRACKPAD_PORT` changes it).
4. The launcher opens a setup page on the PC. Scan its QR code with the Android camera, open the local URL, and enter the six-digit pairing code shown on the PC. The code expires after ten minutes; use **Nouveau code** on the setup page to refresh it. A `.local` QR code is shown when mDNS is available; it can survive a change of the PC's IP address. If it does not resolve on your phone, use the Wi-Fi IP address QR code. If the browser does not open automatically, visit `http://127.0.0.1:8765/setup` on the PC (adjust the port if configured).

The pairing token is stored on the phone in browser local storage; its hash is stored in `.data/tokens.json` on the PC. Delete that file while the server is stopped to revoke all paired phones. Do not forward the port to the Internet. The default LAN HTTP transport is **unencrypted**; use only a trusted private network. Trusted HTTPS can be enabled as described below. Switching from HTTP to HTTPS changes the browser origin, so pair the phone again after switching.

## Trusted HTTPS and Android installation

Place a certificate and its private key in `.data/tls/cert.pem` and `.data/tls/key.pem`, then restart the host. The PC setup page remains on HTTP loopback; private LAN addresses and WebSockets use HTTPS/WSS. The certificate must cover the `.local` name shown in setup and any IP address QR code you use. Trust its issuing CA on the Android phone before opening the HTTPS QR code. A local certificate tool such as [mkcert](https://github.com/FiloSottile/mkcert) can create these files, but its local CA must be transferred and trusted on the phone separately. Never copy the private key to the phone. If the PC IP changes and the phone uses an IP QR code, regenerate the certificate with the new IP; the `.local` name avoids that when resolution works.

The manifest includes 192 px and 512 px PNG icons generated from `web/icon.svg` with `npm run icons` (requires a full `npm ci`). Chrome requires a trusted HTTPS origin for its PWA installation flow on a LAN. Actual Android installation and standalone behavior still need device testing.

## Start automatically with Windows

Double-click [Manage Auto Start.cmd](Manage%20Auto%20Start.cmd) and choose **1** to enable or **2** to disable. The same CMD also accepts `enable`, `disable`, or `status` as an argument. Enabling registers a task named **Remote Smart Trackpad** for the current Windows user and starts the host immediately. It runs at sign-in, in the user's interactive desktop session, without administrator privileges or a visible console. Disabling removes only this task; it does not erase pairing data or stop a host already running. Double-click [Start Remote Smart Trackpad.cmd](Start%20Remote%20Smart%20Trackpad.cmd) whenever you need the QR pairing page; if the host is already running, no second copy starts.

The project folder and Node.js installation must remain at their registered locations. Re-run the enable option after moving either one. The host log for automatic starts is `.data/auto-start.log`. A private network address that appears after sign-in is picked up automatically. The task uses an [interactive logon token](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-logontype-simpletype), which is required for desktop input; it does not run before someone signs in.

## Editing behavior

Opening the editor reads only the active UI Automation text selection. Selections over 4096 characters need confirmation before transfer; the buffer is limited to 1 MiB of UTF-8 text. With no selection, the mobile buffer starts empty at the PC caret; existing document text is not read. Before and after each edit, the bridge checks the focused field, selection or caret, and only the text span represented by the mobile buffer. It never reloads the complete field. The phone sends only the changed span, including Android autocorrection and committed IME text. Windows line endings are normalized to the mobile editor's line endings, and its Enter/Tab buttons update the mobile buffer before sending. Each edit has an operation ID; after a disconnect, the phone checks whether the last operation was applied before retrying it. Unconfirmed drafts and operation IDs stay in browser local storage, including after a browser restart, until they are resolved or replaced by an explicit new session. Replacing a saved draft with a new session requires confirmation. A new PC selection is detected while the editor is open and loaded only after pending edits are resolved.

Applications differ in their UI Automation support and in how they handle Unicode `SendInput`. The app reports unsupported fields rather than guessing their cursor position. The current build has no automatic conflict merging. Changes outside the mobile buffer that leave the focus and caret in place may not be detected; concurrent editing in the same PC field still needs testing on real applications. Commands to elevated windows may be blocked by Windows integrity rules.

## Validation still needed on devices

Run `npm test` for transport, editor recovery, composition, gestures and shortcut ordering; the browser and Windows input are simulated in the frontend tests. With Node.js 22+ and Chrome installed at its standard Windows location, `npm run test:browser` checks real browser pairing, portrait/landscape layout, a reduced editor viewport, modifier states and focus retention. It writes screenshots and a JSON report to `.data/browser-*`. Viewport emulation does not validate Gboard or physical touch gestures.

| Requirement | Current evidence / remaining work |
| --- | --- |
| Explicit editor opening; selection-only reads | Bridge reads selection and tracked buffer only. Test document sizes and selection replacement in real Windows applications. |
| Operation IDs, acknowledgements, recovery, retained mobile text | Automated scenarios cover lost acknowledgements, reload, server restart and close races. |
| Windows focus, selection and text events | Subscriptions compile and register; notifications trigger buffer checks. Validate delivery and provider range behavior in each target application. |
| Trackpad, mouse buttons, modifiers, Fn and configurable keys | Command behavior tested; physical gestures, Windows shortcuts and French AltGr still need device tests. |
| Native Android input and standalone mode | Textarea, composition handling, keyboard resize policy and HTTPS manifest implemented; Gboard, installation, haptics and standalone mode unverified. |
| Pairing, reconnect, LAN access and discovery | Real Chrome pairing/WebSocket and local TLS checked. Android QR scanning, mDNS and firewall access remain unverified. |
| Automatic Windows startup | Task creation code and status command checked; actual sign-in under the user's account remains unverified. |
| Conflicts and capability limits | Preserve mobile text and require explicit reopening; no automatic merge. UIA providers may use different character units for emoji. |
| Large selections | Confirmation above 4096 characters, hard 1 MiB buffer limit. The technical attachment's override above 1 MiB is not implemented. |

The original technical attachment's acceptance matrix (Chrome/Edge, Notepad, VS Code, Word, Discord, address bar, elevated apps, French AZERTY, emoji and IME) remains open. The implementation is not yet proven to satisfy the full MVP on real devices.

The code has been checked locally for syntax, bridge startup, pairing, WebSocket framing, and refusal of invalid requests. HTTPS/WSS was exercised locally with a test certificate. The mDNS publisher starts on a private adapter, but this environment blocks multicast loopback, so `.local` resolution still needs testing on Android and the actual network. Run the handoff scenarios on an Android phone and representative Windows editors: selection replacement, large documents, autocorrection and IME, emoji, AltGr, context changes, disconnections, portrait and landscape. The host cannot emulate these device and application combinations. Trusted HTTPS PWA installation on Android remains unverified.

## Technical sources

- [FlaUI](https://github.com/FlaUI/FlaUI) was assessed for UI Automation. It is appropriate for a compiled .NET host, but this machine has only the .NET runtime, so the current bridge uses Windows' built-in UI Automation assemblies directly.
- [Microsoft TextPattern documentation](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-textpattern-overview) explains selection and caret ranges.
- [Microsoft SendInput documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput) documents integrity-level restrictions.
- [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) and [PWA installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) inform gesture handling and the HTTPS limitation.
- The setup page vendors [datalog/qrcode-svg](https://github.com/datalog/qrcode-svg) under its [MIT license](web/vendor/LICENSE) to generate QR codes locally, without a CDN or third-party QR service. QR codes contain only the private URL, not the pairing code or authentication token.
- [multicast-dns](https://github.com/mafintosh/multicast-dns) publishes a `.local` host and an HTTP service on each private IPv4 interface served by the host. IP QR codes remain available when Android or the router does not resolve mDNS.
