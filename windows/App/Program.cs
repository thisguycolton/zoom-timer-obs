using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace ZoomTimerBridge;

// ZoomTimerBridge for Windows: reads Zoom's in-meeting Timer app via UI Automation and serves it to OBS.
// Runs in the notification area; --console runs it in a console window instead, --dump writes diagnostics.
static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        var port = 17845;
        string? overlay = null;
        var console = false;
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--port" when i + 1 < args.Length && int.TryParse(args[i + 1], out var p):
                    port = p; i++; break;
                case "--overlay" when i + 1 < args.Length:
                    overlay = args[++i]; break;
                case "--console":
                    console = true; break;
                case "--dump":
                    AttachConsole(-1);
                    Console.WriteLine(ZoomReader.Dump());
                    return 0;
                case "-h" or "--help":
                    AttachConsole(-1);
                    Console.WriteLine("Usage: ZoomTimerBridge [--port 17845] [--overlay path] [--console] [--dump]");
                    return 0;
            }
        }
        if (console && !AttachConsole(-1)) AllocConsole();

        // A second copy can't bind the port; say so instead of failing silently.
        using var mutex = new Mutex(true, "ZoomTimerBridge-" + port, out var first);
        var reader = new ZoomReader();
        var bridge = new Bridge(port, Bridge.LocateOverlay(overlay), reader.Read);
        try
        {
            bridge.Start();
        }
        catch (SocketException e)
        {
            var message = $"Zoom Timer Bridge couldn't start: port {port} is unavailable ({e.Message}).\n\n" +
                          (first ? "Another program is using it." : "Zoom Timer Bridge is already running; look for its icon in the notification area (you may need to click ^).");
            if (console) Console.Error.WriteLine(message);
            else MessageBox.Show(message, "Zoom Timer Bridge", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }

        if (console)
        {
            Console.WriteLine("Press Ctrl+C to quit.");
            var done = new ManualResetEventSlim();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };
            done.Wait();
            bridge.Dispose();
            return 0;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new TrayApp(bridge));
        return 0;
    }

    [DllImport("kernel32.dll")]
    static extern bool AttachConsole(int processId);

    [DllImport("kernel32.dll")]
    static extern bool AllocConsole();
}
