using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace ZoomTimerBridge;

/// <summary>Minimal HTTP/1.1 server bound to 127.0.0.1, mirroring the macOS helper's routes:
/// /state, /events (SSE), GET/POST/PUT /layout, POST /assets, /assets/*, and static files from the overlay folder.
/// TcpListener is used instead of HttpListener so no URL ACL or admin rights are needed.</summary>
public sealed class HttpServer : IDisposable
{
    /// <summary>Request bodies are only accepted for /layout and /assets; a background image may be large.</summary>
    const int MaxBodySize = 12 * 1024 * 1024;
    const int MaxHeaderSize = 64 * 1024;

    readonly TcpListener listener;
    readonly string overlayDirectory;
    readonly Func<TimerState> currentState;
    readonly LayoutStore layoutStore;
    readonly object clientsLock = new();
    readonly List<Stream> eventClients = new();
    readonly CancellationTokenSource cts = new();

    public int Port { get; }

    /// <summary>Lists installed font family names for GET /fonts (platform-specific; empty if unset).</summary>
    public Func<IEnumerable<string>>? FontProvider { get; set; }
    byte[]? fontsJson;

    public HttpServer(int port, string overlayDirectory, Func<TimerState> currentState, LayoutStore? layoutStore = null)
    {
        Port = port;
        this.overlayDirectory = Path.GetFullPath(overlayDirectory);
        this.currentState = currentState;
        this.layoutStore = layoutStore ?? new LayoutStore();
        listener = new TcpListener(IPAddress.Loopback, port);
    }

    /// <summary>Throws SocketException if the port is already in use.</summary>
    public void Start()
    {
        listener.Start();
        _ = AcceptLoop();
    }

    public void Dispose()
    {
        cts.Cancel();
        listener.Stop();
        lock (clientsLock)
        {
            foreach (var c in eventClients) c.Dispose();
            eventClients.Clear();
        }
    }

    /// <summary>Sends the state to every /events client.</summary>
    public void Broadcast(TimerState state) =>
        SendToEventClients(Concat("data: "u8.ToArray(), state.ToJson(), "\n\n"u8.ToArray()));

    public void Heartbeat() => SendToEventClients(": ping\n\n"u8.ToArray());

    /// <summary>Tells /events clients (the canvas overlay in OBS) to re-fetch /layout.</summary>
    void BroadcastLayoutChanged() => SendToEventClients("event: layout\ndata: {}\n\n"u8.ToArray());

    void SendToEventClients(byte[] message)
    {
        Stream[] clients;
        lock (clientsLock) clients = eventClients.ToArray();
        foreach (var client in clients)
        {
            try
            {
                client.Write(message);
                client.Flush();
            }
            catch
            {
                lock (clientsLock) eventClients.Remove(client);
                client.Dispose();
            }
        }
    }

    async Task AcceptLoop()
    {
        while (!cts.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await listener.AcceptTcpClientAsync(cts.Token); }
            catch { return; }
            _ = Task.Run(() => HandleClient(client));
        }
    }

    async Task HandleClient(TcpClient client)
    {
        var keepOpen = false;
        var stream = client.GetStream();
        try
        {
            var (head, body) = await ReadRequest(stream);
            if (head is null) return;
            keepOpen = await Handle(head, body, stream);
        }
        catch (PayloadTooLargeException)
        {
            await Respond(stream, "413 Payload Too Large", "text/plain; charset=utf-8", Array.Empty<byte>());
        }
        catch { }
        finally
        {
            if (!keepOpen) client.Dispose();
        }
    }

    sealed class PayloadTooLargeException : Exception { }

    static async Task<(string? Head, byte[] Body)> ReadRequest(Stream stream)
    {
        var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int headerEnd;
        while (true)
        {
            var n = await stream.ReadAsync(chunk);
            if (n == 0) return (null, Array.Empty<byte>());
            buffer.Write(chunk, 0, n);
            headerEnd = IndexOf(buffer.GetBuffer(), (int)buffer.Length, "\r\n\r\n"u8);
            if (headerEnd >= 0) break;
            if (buffer.Length > MaxHeaderSize) return (null, Array.Empty<byte>());
        }
        var head = Encoding.UTF8.GetString(buffer.GetBuffer(), 0, headerEnd);
        var length = int.TryParse(Header("content-length", head), out var l) ? l : 0;
        if (length > MaxBodySize) throw new PayloadTooLargeException();
        var bodyStart = headerEnd + 4;
        while (buffer.Length - bodyStart < length)
        {
            var n = await stream.ReadAsync(chunk);
            if (n == 0) return (null, Array.Empty<byte>());
            buffer.Write(chunk, 0, n);
        }
        var body = new byte[length];
        Array.Copy(buffer.GetBuffer(), bodyStart, body, 0, length);
        return (head, body);
    }

    static int IndexOf(byte[] data, int count, ReadOnlySpan<byte> pattern) =>
        data.AsSpan(0, count).IndexOf(pattern);

    static string? Header(string name, string head)
    {
        foreach (var line in head.Split("\r\n").Skip(1))
        {
            var colon = line.IndexOf(':');
            if (colon > 0 && line[..colon].Trim().Equals(name, StringComparison.OrdinalIgnoreCase))
                return line[(colon + 1)..].Trim();
        }
        return null;
    }

    /// <summary>Returns true when the connection was handed to the SSE client list.</summary>
    async Task<bool> Handle(string head, byte[] body, Stream stream)
    {
        var parts = head.Split("\r\n", 2)[0].Split(' ');
        if (parts.Length < 2)
        {
            await Respond(stream, "400 Bad Request", "text/plain; charset=utf-8", Array.Empty<byte>());
            return false;
        }
        var method = parts[0];
        var path = parts[1].Split('?', 2)[0];

        if (method == "OPTIONS")
        {
            await Respond(stream, "204 No Content", "text/plain; charset=utf-8", Array.Empty<byte>());
            return false;
        }
        if (path == "/layout" && (method == "POST" || method == "PUT"))
        {
            if (!IsJsonObject(body))
            {
                await Respond(stream, "400 Bad Request", "text/plain; charset=utf-8", "Expected a JSON object"u8.ToArray());
                return false;
            }
            try { layoutStore.Save(body); }
            catch (Exception e)
            {
                await Respond(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(e.Message));
                return false;
            }
            BroadcastLayoutChanged();
            await Respond(stream, "204 No Content", "text/plain; charset=utf-8", Array.Empty<byte>());
            return false;
        }
        if (path == "/assets" && method == "POST")
        {
            try
            {
                var url = layoutStore.SaveAsset(body, Header("content-type", head) ?? "");
                await Respond(stream, "201 Created", "application/json", JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, string> { ["url"] = url }));
            }
            catch
            {
                await Respond(stream, "415 Unsupported Media Type", "text/plain; charset=utf-8", "Upload a PNG, JPEG, GIF, WebP or SVG image"u8.ToArray());
            }
            return false;
        }
        if (method != "GET" && method != "HEAD")
        {
            await Respond(stream, "405 Method Not Allowed", "text/plain; charset=utf-8", Array.Empty<byte>());
            return false;
        }

        switch (path)
        {
            case "/state":
                await Respond(stream, "200 OK", "application/json", currentState().ToJson());
                return false;
            case "/layout":
                var layout = layoutStore.Load();
                if (layout is null) await Respond(stream, "404 Not Found", "application/json", "null"u8.ToArray());
                else await Respond(stream, "200 OK", "application/json", layout);
                return false;
            case "/fonts":
                await Respond(stream, "200 OK", "application/json", FontsJson());
                return false;
            case "/events":
                await OpenEventStream(stream);
                return true;
            default:
                if (path.StartsWith("/assets/", StringComparison.Ordinal))
                    await ServeFile(path["/assets".Length..], layoutStore.AssetsDirectory, stream);
                else
                    await ServeFile(path, overlayDirectory, stream);
                return false;
        }
    }

    /// <summary>Sorted, de-duplicated family names, computed once; hidden names (leading ".") are dropped.</summary>
    byte[] FontsJson()
    {
        if (fontsJson is not null) return fontsJson;
        IEnumerable<string> names;
        try { names = FontProvider?.Invoke() ?? Enumerable.Empty<string>(); }
        catch { names = Enumerable.Empty<string>(); }
        var list = names.Where(n => !string.IsNullOrWhiteSpace(n) && !n.StartsWith('.'))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var json = JsonSerializer.SerializeToUtf8Bytes(list);
        if (list.Count > 0) fontsJson = json;
        return json;
    }

    static bool IsJsonObject(byte[] body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.ValueKind == JsonValueKind.Object;
        }
        catch { return false; }
    }

    async Task OpenEventStream(Stream stream)
    {
        var head = "HTTP/1.1 200 OK\r\n" +
                   "Content-Type: text/event-stream\r\n" +
                   "Cache-Control: no-cache\r\n" +
                   "Connection: keep-alive\r\n" +
                   "Access-Control-Allow-Origin: *\r\n\r\n" +
                   "retry: 1000\n\n";
        await stream.WriteAsync(Concat(Encoding.UTF8.GetBytes(head), "data: "u8.ToArray(), currentState().ToJson(), "\n\n"u8.ToArray()));
        await stream.FlushAsync();
        lock (clientsLock) eventClients.Add(stream);
        // Detect the client going away.
        _ = Task.Run(async () =>
        {
            var sink = new byte[1024];
            try { while (await stream.ReadAsync(sink) > 0) { } } catch { }
            lock (clientsLock) eventClients.Remove(stream);
            stream.Dispose();
        });
    }

    static async Task ServeFile(string path, string directory, Stream stream)
    {
        var relative = Uri.UnescapeDataString(path);
        if (relative.EndsWith('/')) relative += "index.html";
        var components = relative.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (components.Any(c => c == ".." || c.StartsWith('.') || c.Contains('\\') || c.Contains(':')))
        {
            await Respond(stream, "404 Not Found", "text/plain; charset=utf-8", "Not found"u8.ToArray());
            return;
        }
        var root = Path.GetFullPath(directory);
        var full = Path.GetFullPath(Path.Combine(new[] { root }.Concat(components).ToArray()));
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
        {
            await Respond(stream, "404 Not Found", "text/plain; charset=utf-8", "Not found"u8.ToArray());
            return;
        }
        await Respond(stream, "200 OK", MimeType(Path.GetExtension(full)), await File.ReadAllBytesAsync(full));
    }

    static async Task Respond(Stream stream, string status, string contentType, byte[] body)
    {
        var head = $"HTTP/1.1 {status}\r\n" +
                   $"Content-Type: {contentType}\r\n" +
                   $"Content-Length: {body.Length}\r\n" +
                   "Cache-Control: no-cache\r\n" +
                   "Access-Control-Allow-Origin: *\r\n" +
                   "Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n" +
                   "Access-Control-Allow-Headers: Content-Type\r\n" +
                   "Connection: close\r\n\r\n";
        await stream.WriteAsync(Concat(Encoding.ASCII.GetBytes(head), body));
        await stream.FlushAsync();
    }

    static byte[] Concat(params byte[][] parts)
    {
        var result = new byte[parts.Sum(p => p.Length)];
        var offset = 0;
        foreach (var p in parts)
        {
            Buffer.BlockCopy(p, 0, result, offset, p.Length);
            offset += p.Length;
        }
        return result;
    }

    static string MimeType(string ext) => ext.TrimStart('.').ToLowerInvariant() switch
    {
        "html" or "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" or "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" or "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    };
}
