using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using Microsoft.Win32;

namespace ZoomTimerBridge;

/// <summary>Notification-area (tray) UI, matching the macOS menu bar app.</summary>
sealed class TrayApp : System.Windows.Forms.ApplicationContext
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunValue = "ZoomTimerBridge";
    const string GuideUrl = "https://github.com/thisguycolton/zoom-timer-obs/blob/main/SETUP.md#windows";

    readonly Bridge bridge;
    readonly NotifyIcon icon;
    readonly ToolStripMenuItem statusLine = new("Starting…") { Enabled = false };
    readonly ToolStripMenuItem loginItem = new("Start with Windows");
    readonly ToolStripMenuItem hideItem = new("Hide Overlay") { CheckOnClick = false };
    readonly SynchronizationContext ui;
    TimerState state = new();

    public TrayApp(Bridge bridge)
    {
        this.bridge = bridge;
        ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();

        var menu = new ContextMenuStrip();
        menu.Items.Add(statusLine);
        hideItem.Click += (_, _) => bridge.OverlayHidden = !bridge.OverlayHidden;
        menu.Items.Add(hideItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open Layout Editor", null, (_, _) => Open("/editor.html"));
        menu.Items.Add("Copy OBS URL", null, (_, _) => System.Windows.Forms.Clipboard.SetText(bridge.BaseUrl + "/canvas.html"));
        menu.Items.Add("Open Simple Setup", null, (_, _) => Open("/config.html"));
        menu.Items.Add(new ToolStripSeparator());
        loginItem.Click += (_, _) => ToggleLogin();
        menu.Items.Add(loginItem);
        menu.Items.Add("Save Diagnostics to Desktop", null, (_, _) => SaveDiagnostics());
        menu.Items.Add("Setup Guide", null, (_, _) => OpenUrl(GuideUrl));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit Zoom Timer Bridge", null, (_, _) => Quit());
        menu.Opening += (_, _) => Refresh();

        icon = new NotifyIcon { Icon = MakeIcon(), ContextMenuStrip = menu, Visible = true, Text = "Zoom Timer Bridge" };
        icon.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) Open("/editor.html"); };

        bridge.Changed += s => ui.Post(_ => { state = s; Refresh(); }, null);
        bridge.OverlayHiddenChanged += _ => ui.Post(_ => Refresh(), null);
        Refresh();
    }

    void Refresh()
    {
        var hidden = bridge.OverlayHidden;
        statusLine.Text = Describe(state) + (hidden ? " · overlay hidden" : "");
        hideItem.Checked = hidden;
        loginItem.Checked = IsLoginEnabled();
        // Tooltip text is limited to 63 characters.
        var tip = (hidden ? "Zoom Timer Bridge (hidden) · " : "Zoom Timer Bridge · ") + Describe(state);
        icon.Text = tip.Length > 63 ? tip[..63] : tip;
    }

    static string Describe(TimerState s)
    {
        var total = s.TotalSeconds is int t ? TimerTracker.Format(t) : null;
        return s.Status switch
        {
            TimerStatus.ZoomClosed => "Waiting for Zoom",
            TimerStatus.NotFound => "Waiting for Zoom Timer (open it in your meeting)",
            TimerStatus.Idle => $"Ready · {s.Display} set",
            TimerStatus.Running => $"Running · {s.Display}" + (total is null ? "" : $" of {total}"),
            TimerStatus.Paused => $"Paused · {s.Display}",
            TimerStatus.TimesUp => "Time's up",
            _ => $"Over time · {s.Display}",
        };
    }

    void Open(string path) => OpenUrl(bridge.BaseUrl + path);

    static void OpenUrl(string url) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });

    static bool IsLoginEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(RunValue) is string;
    }

    void ToggleLogin()
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (IsLoginEnabled()) key.DeleteValue(RunValue, false);
        else key.SetValue(RunValue, $"\"{Environment.ProcessPath}\"");
        Refresh();
    }

    void SaveDiagnostics()
    {
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "ZoomTimerBridge-diagnostics.txt");
        // UI Automation is slow on big trees; keep the tray responsive.
        Task.Run(() =>
        {
            string text;
            try { text = ZoomReader.Dump(); } catch (Exception e) { text = "Dump failed: " + e; }
            File.WriteAllText(path, text);
            ui.Post(_ => icon.ShowBalloonTip(4000, "Zoom Timer Bridge", "Saved " + Path.GetFileName(path) + " to your Desktop.", ToolTipIcon.Info), null);
        });
    }

    void Quit()
    {
        icon.Visible = false;
        bridge.Dispose();
        ExitThread();
    }

    /// <summary>Draws the tray icon (white timer on a blue rounded square) so no image file is needed.</summary>
    static Icon MakeIcon()
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var path = new GraphicsPath();
            const int r = 8;
            path.AddArc(1, 1, r * 2, r * 2, 180, 90);
            path.AddArc(31 - r * 2, 1, r * 2, r * 2, 270, 90);
            path.AddArc(31 - r * 2, 31 - r * 2, r * 2, r * 2, 0, 90);
            path.AddArc(1, 31 - r * 2, r * 2, r * 2, 90, 90);
            path.CloseFigure();
            using var fill = new LinearGradientBrush(new System.Drawing.Point(0, 0), new System.Drawing.Point(0, 32), Color.FromArgb(51, 140, 255), Color.FromArgb(26, 77, 217));
            g.FillPath(fill, path);
            using var pen = new Pen(Color.White, 3f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.DrawArc(pen, 7, 8, 18, 18, -60, 300);
            g.DrawLine(pen, 16, 6, 16, 9);
            g.DrawLine(pen, 16, 17, 12, 13);
        }
        return Icon.FromHandle(bmp.GetHicon());
    }
}
