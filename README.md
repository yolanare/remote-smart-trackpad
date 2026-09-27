# Remote Smart Trackpad

Local Android web remote for a Windows PC. The current implementation is an early working build based on [the product handoff](remote-smart-trackpad-handoff.md). It uses a dependency-free Node.js server, a PowerShell/.NET Framework bridge for Windows UI Automation and `SendInput`, and a small browser interface. These components communicate through a command protocol with acknowledgements; the bridge can later be replaced independently.

## Run

1. Install Node.js 20 or newer on Windows.
2. Double-click [Start Remote Smart Trackpad.cmd](Start%20Remote%20Smart%20Trackpad.cmd), or run `npm start` in this directory. If the host is already running, the launcher opens its pairing page without starting a second copy.
3. Allow inbound access on your **private** Windows network if the firewall asks. The server listens on loopback and private IPv4 interfaces only, port 8765 by default (`REMOTE_SMART_TRACKPAD_PORT` changes it).
4. The launcher opens a setup page on the PC. Scan its QR code with the Android camera, open the local URL, and enter the six-digit pairing code shown on the PC. The code expires after ten minutes; use **Nouveau code** on the setup page to refresh it. If the browser does not open automatically, visit `http://127.0.0.1:8765/setup` on the PC (adjust the port if configured).

The pairing token is stored on the phone in browser local storage; its hash is stored in `.data/tokens.json` on the PC. Delete that file while the server is stopped to revoke all paired phones. Do not forward the port to the Internet. The current local HTTP transport is **unencrypted**; use only a trusted private network. HTTPS with a trusted certificate is required for standards-based PWA installation on a LAN, so the home-screen/full-screen experience is browser-dependent in this build.

## Start automatically with Windows

Double-click [Manage Auto Start.cmd](Manage%20Auto%20Start.cmd) and choose **1** to enable or **2** to disable. Enabling registers a task named **Remote Smart Trackpad** for the current Windows user and starts the host immediately. It runs at sign-in, in the user's interactive desktop session, without administrator privileges or a visible console. Disabling removes only this task; it does not erase pairing data. If the host is already running when you use the normal launcher, that launcher opens the QR pairing page.

The project folder and Node.js installation must remain at their registered locations. Re-run the enable option after moving either one. The host log for automatic starts is `.data/auto-start.log`. A private network address that appears after sign-in is picked up automatically. The task uses an [interactive logon token](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-logontype-simpletype), which is required for desktop input; it does not run before someone signs in.

## Editing behavior

Opening the editor reads only the active UI Automation text selection. Selections over 4096 characters need confirmation before transfer; the hard buffer limit is 16384 characters. With no selection, the mobile buffer starts empty at the PC caret; existing document text is not read. The server compares the PC focus and caret before each edit and refuses changes if either moved. Mobile text is kept in session storage after an uncertain or failed operation. To start a new session, review or copy the draft, then use **Ouvrir une nouvelle session sur le PC**; that explicitly replaces the mobile buffer.

Applications differ in their UI Automation support and in how they handle Unicode `SendInput`. The app reports unsupported fields rather than guessing their cursor position. The first build has no full document reconciliation or automatic conflict merging. An independent PC edit that leaves the focus and caret in place may not be detected. Avoid concurrent edits in the same field until that detection is implemented and checked on real applications. Commands to elevated windows may be blocked by Windows integrity rules.

## Validation still needed on devices

The code has been checked locally for syntax and bridge startup. Run the handoff scenarios on an Android phone and representative Windows editors: selection replacement, large documents, autocorrection and IME, emoji, AltGr, context changes, disconnections, portrait and landscape. The host cannot emulate these device and application combinations.

## Technical sources

- [FlaUI](https://github.com/FlaUI/FlaUI) was assessed for UI Automation. It is appropriate for a compiled .NET host, but this machine has only the .NET runtime, so the current bridge uses Windows' built-in UI Automation assemblies directly.
- [Microsoft TextPattern documentation](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-textpattern-overview) explains selection and caret ranges.
- [Microsoft SendInput documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput) documents integrity-level restrictions.
- [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) and [PWA installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) inform gesture handling and the HTTPS limitation.
- The setup page vendors [datalog/qrcode-svg](https://github.com/datalog/qrcode-svg) under its [MIT license](web/vendor/LICENSE) to generate QR codes locally, without a CDN or third-party QR service. QR codes contain only the private URL, not the pairing code or authentication token.
