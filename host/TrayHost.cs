using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
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
    private readonly Form console;
    private readonly TextBox output;
    private readonly Process server;
    private readonly string root;
    private readonly ToolStripMenuItem startup;
    private bool stopping;

    public HostContext(string projectRoot) {
        root = projectRoot;
        Icon appIcon = Icon.ExtractAssociatedIcon(Path.Combine(root, ".data", "RemoteSmartTrackpad.exe"));
        console = new Form { Icon = appIcon, Text = "Remote Smart Trackpad - Console", Size = new Size(850, 500), StartPosition = FormStartPosition.CenterScreen };
        output = new TextBox { Multiline = true, ReadOnly = true, Dock = DockStyle.Fill, ScrollBars = ScrollBars.Both, WordWrap = false, BackColor = Color.FromArgb(20, 20, 20), ForeColor = Color.Gainsboro, Font = new Font("Consolas", 10) };
        console.Controls.Add(output);
        console.FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!stopping) { e.Cancel = true; console.Hide(); } };
        // Create the handle without displaying a window, so log callbacks can marshal to the UI thread.
        IntPtr handle = console.Handle;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Show console", null, delegate { console.Show(); console.Activate(); });
        menu.Items.Add("Connect a device", null, delegate { Process.Start(new ProcessStartInfo("http://127.0.0.1:" + (Environment.GetEnvironmentVariable("REMOTE_SMART_TRACKPAD_PORT") ?? "8765") + "/setup") { UseShellExecute = true }); });
        startup = new ToolStripMenuItem("Start with Windows") { CheckOnClick = false };
        startup.Click += delegate { try { SetStartup(!startup.Checked); } catch (Exception error) { MessageBox.Show(error.Message, StartupName); } };
        menu.Items.Add(startup);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Stop server", null, delegate { ExitThread(); });
        tray = new NotifyIcon { Icon = appIcon, Text = StartupName, ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += delegate { console.Show(); console.Activate(); };
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) startup.Checked = key != null && key.GetValue(StartupName) != null;
        string marker = Path.Combine(root, ".data", "tray-initialized");
        if (!File.Exists(marker)) { SetStartup(true); File.WriteAllText(marker, "Startup preference initialized; use the tray menu to change it."); }
        string node = File.ReadAllText(Path.Combine(root, ".data", "node-path.txt")).Trim();
        server = new Process { StartInfo = new ProcessStartInfo(node, "\"" + Path.Combine(root, "host", "server.js") + "\"") { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 }, EnableRaisingEvents = true };
        server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Append(e.Data); };
        server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Append(e.Data); };
        server.Exited += delegate { if (!stopping && !console.IsDisposed) console.BeginInvoke((Action)delegate { tray.Text = "Remote Smart Trackpad - stopped"; Append("Server stopped. Close the tray and launch again to retry."); console.Show(); }); };
        server.Start(); server.BeginOutputReadLine(); server.BeginErrorReadLine();
    }

    private void Append(string line) {
        if (line == null || console.IsDisposed || stopping) return;
        if (console.InvokeRequired) { console.BeginInvoke((Action)(() => Append(line))); return; }
        if (output.TextLength > 200000) output.Text = output.Text.Substring(output.TextLength - 100000);
        output.AppendText(line + Environment.NewLine);
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
        tray.Visible = false; tray.Dispose(); console.Dispose();
        if (server != null) server.Dispose();
        base.ExitThreadCore();
    }
}
