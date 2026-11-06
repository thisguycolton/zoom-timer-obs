namespace ZoomTimerBridge;

/// <summary>Polls a timer reader every 250 ms and serves the result. The reader is platform-specific
/// (UI Automation on Windows); everything else here is shared.</summary>
public sealed class Bridge : IDisposable
{
    readonly Func<RawReading> read;
    readonly TimerTracker tracker = new();
    readonly HttpServer server;
    readonly object stateLock = new();
    Thread? thread;
    volatile bool stopping;
    TimerStatus? lastLogged;

    /// <summary>Raised on the polling thread whenever the published state changes.</summary>
    public event Action<TimerState>? Changed;

    public Bridge(int port, string overlayDirectory, Func<RawReading> read, LayoutStore? layoutStore = null)
    {
        this.read = read;
        server = new HttpServer(port, overlayDirectory, () => { lock (stateLock) return tracker.State; }, layoutStore);
        OverlayDirectory = overlayDirectory;
    }

    public int Port => server.Port;
    /// <summary>Hides the OBS overlays (fully transparent) without stopping the reader.</summary>
    public bool OverlayHidden { get => server.OverlayHidden; set => server.OverlayHidden = value; }
    /// <summary>Raised when OverlayHidden changes, including from the /visibility endpoints (on a server thread).</summary>
    public event Action<bool>? OverlayHiddenChanged { add => server.OverlayHiddenChanged += value; remove => server.OverlayHiddenChanged -= value; }
    /// <summary>Supplies installed font names for GET /fonts.</summary>
    public Func<IEnumerable<string>>? FontProvider { get => server.FontProvider; set => server.FontProvider = value; }
    public string OverlayDirectory { get; }
    public string BaseUrl => $"http://127.0.0.1:{Port}";
    public TimerState State { get { lock (stateLock) return tracker.State; } }

    /// <summary>Throws SocketException if the port is already in use.</summary>
    public void Start()
    {
        server.Start();
        Console.WriteLine($"ZoomTimerBridge on {BaseUrl}/  (state: /state, events: /events, overlay: {OverlayDirectory})");
        // UI Automation calls must come from one thread; keep polling, broadcasting and heartbeats on it.
        thread = new Thread(Loop) { IsBackground = true, Name = "ZoomTimerBridge poll" };
        if (OperatingSystem.IsWindows()) thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
    }

    void Loop()
    {
        var nextHeartbeat = DateTime.UtcNow.AddSeconds(5);
        while (!stopping)
        {
            RawReading reading;
            try { reading = read(); }
            catch (Exception e)
            {
                Console.Error.WriteLine("Read failed: " + e.Message);
                reading = new RawReading.NotFound();
            }
            TimerState? changed = null;
            lock (stateLock)
            {
                if (tracker.Update(reading)) changed = tracker.State;
            }
            if (changed is not null)
            {
                if (changed.Status != lastLogged)
                {
                    Console.WriteLine($"status: {TimerState.StatusName(changed.Status)} {changed.Display}");
                    lastLogged = changed.Status;
                }
                server.Broadcast(changed);
                Changed?.Invoke(changed);
            }
            if (DateTime.UtcNow >= nextHeartbeat)
            {
                server.Heartbeat();
                nextHeartbeat = DateTime.UtcNow.AddSeconds(5);
            }
            Thread.Sleep(250);
        }
    }

    public void Dispose()
    {
        stopping = true;
        server.Dispose();
    }

    /// <summary>Uses the given path, else an overlay\ folder next to the exe, else one in the current
    /// directory, else one in a parent folder (the repo, when running from bin\).</summary>
    public static string LocateOverlay(string? explicitPath)
    {
        if (explicitPath is not null) return Path.GetFullPath(explicitPath);
        static bool HasIndex(string dir) => File.Exists(Path.Combine(dir, "index.html"));
        var candidates = new List<string> { Path.Combine(AppContext.BaseDirectory, "overlay"), Path.Combine(Environment.CurrentDirectory, "overlay") };
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 8 && dir is not null; i++, dir = dir.Parent) candidates.Add(Path.Combine(dir.FullName, "overlay"));
        return candidates.FirstOrDefault(HasIndex) ?? candidates[0];
    }
}
