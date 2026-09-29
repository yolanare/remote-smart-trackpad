using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class TrayHost {
    [STAThread]
    private static void Main(string[] args) {
        Application.EnableVisualStyles();
        string root = Directory.GetParent(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)).FullName;
        using (var mutex = new Mutex(false, "Local\\RemoteSmartTrackpad-" + Convert.ToBase64String(Encoding.UTF8.GetBytes(root)).Replace('/', '_'))) {
            if (!mutex.WaitOne(0)) return;
            try { using (var context = new HostContext(root)) Application.Run(context); }
            catch (Exception error) { MessageBox.Show(error.Message, "Remote Smart Trackpad", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { mutex.ReleaseMutex(); }
        }
    }
}

internal sealed class HostContext : ApplicationContext {
    private const string StartupName = "Remote Smart Trackpad";
    private readonly NotifyIcon tray;
    private readonly Control dispatcher = new Control();
    private readonly object logLock = new object();
    private readonly StreamWriter log;
    private readonly string logPath;
    private readonly string node;
    private Process console;
    private readonly Process server;
    private readonly string root;
    private readonly ToolStripMenuItem startup;
    private bool stopping;

    public HostContext(string projectRoot) {
        root = projectRoot;
        Icon appIcon = Icon.ExtractAssociatedIcon(Path.Combine(root, ".data", "RemoteSmartTrackpad.exe"));
        string data = Environment.GetEnvironmentVariable("REMOTE_SMART_TRACKPAD_DATA_DIRECTORY") ?? Path.Combine(root, ".data");
        Directory.CreateDirectory(data);
        logPath = Path.Combine(data, "server.log");
        log = new StreamWriter(new FileStream(logPath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false)) { AutoFlush = true };
        IntPtr handle = dispatcher.Handle;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Show console", null, delegate { ShowConsole(); });
        menu.Items.Add("Connect a device", null, delegate { Process.Start(new ProcessStartInfo("http://127.0.0.1:" + (Environment.GetEnvironmentVariable("REMOTE_SMART_TRACKPAD_PORT") ?? "8765") + "/setup") { UseShellExecute = true }); });
        startup = new ToolStripMenuItem("Start with Windows") { CheckOnClick = false };
        startup.Click += delegate { try { SetStartup(!startup.Checked); } catch (Exception error) { MessageBox.Show(error.Message, StartupName); } };
        menu.Items.Add(startup);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Stop server", null, delegate { ExitThread(); });
        tray = new NotifyIcon { Icon = appIcon, Text = StartupName, ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += delegate { ShowConsole(); };
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) startup.Checked = key != null && key.GetValue(StartupName) != null;
        string marker = Path.Combine(root, ".data", "tray-initialized");
        if (!File.Exists(marker)) { SetStartup(true); File.WriteAllText(marker, "Startup preference initialized; use the tray menu to change it."); }
        node = File.ReadAllText(Path.Combine(root, ".data", "node-path.txt")).Trim();
        server = new Process { StartInfo = new ProcessStartInfo(node, "\"" + Path.Combine(root, "host", "server.js") + "\"") { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 }, EnableRaisingEvents = true };
        server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Append(e.Data); };
        server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Append(e.Data); };
        server.Exited += delegate { if (!stopping && !dispatcher.IsDisposed) dispatcher.BeginInvoke((Action)delegate { if (stopping) return; tray.Text = "Remote Smart Trackpad - stopped"; Append("Server stopped. Close the tray and launch again to retry."); ShowConsole(); }); };
        server.Start(); server.BeginOutputReadLine(); server.BeginErrorReadLine();
    }

    private void Append(string line) {
        lock (logLock) { if (line != null && !stopping) log.WriteLine(line); }
    }
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    private void ShowConsole() {
        if (console != null && !console.HasExited) {
            console.Refresh();
            ShowWindow(console.MainWindowHandle, 9);
            SetForegroundWindow(console.MainWindowHandle);
            return;
        }
        if (console != null) console.Dispose();
        console = Process.Start(new ProcessStartInfo(node, "\"" + Path.Combine(root, "host", "show-console.js") + "\" \"" + logPath + "\"") { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = false });
    }
    private void SetStartup(bool enabled) {
        using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) {
            if (enabled) key.SetValue(StartupName, "\"" + Application.ExecutablePath + "\"");
            else key.DeleteValue(StartupName, false);
        }
        startup.Checked = enabled;
    }
    protected override void ExitThreadCore() {
        if (stopping) return;
        stopping = true;
        if (server != null && !server.HasExited) {
            try { server.StandardInput.WriteLine("shutdown"); server.StandardInput.Flush(); } catch (IOException) { }
            if (!server.WaitForExit(5000)) server.Kill();
        }
        tray.Visible = false; tray.Dispose(); dispatcher.Dispose();
        if (console != null) { if (!console.HasExited) console.Kill(); console.Dispose(); }
        lock (logLock) log.Dispose();
        if (server != null) server.Dispose();
        base.ExitThreadCore();
    }
}
