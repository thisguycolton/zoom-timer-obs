using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using ZoomTimerBridge;
using T = ZoomTimerBridge.TimerItem;

var failures = 0;
void Check(string name, bool ok, string detail = "")
{
    Console.WriteLine((ok ? "  ok   " : "  FAIL ") + name + (ok || detail == "" ? "" : "  →  " + detail));
    if (!ok) failures++;
}

// Element sequences as read from Zoom's Timer on macOS (2026-11-03); Windows is expected to look the same.
List<TimerItem> Idle(string h, string m, string s) => new()
{
    new T.Button("home"), new T.Button("stopwatch"), new T.Button("Increase Hours"),
    new T.Field("hours", h), new T.Text("hr"), new T.Button("Decrease Hours"), new T.Text(":"),
    new T.Button("Increase Minutes"), new T.Field("minutes", m), new T.Text("min"), new T.Button("Decrease Minutes"), new T.Text(":"),
    new T.Button("Increase Seconds"), new T.Field("seconds", s), new T.Text("sec"), new T.Button("Decrease Seconds"),
    new T.Button("Start"), new T.Text("Show timer to all"),
};
List<TimerItem> Running(string a, string b) => new()
{
    new T.Button("home"), new T.Button("stopwatch"), new T.Text(a), new T.Text(":"), new T.Text(b),
    new T.Button("+30"), new T.Button("Pause"), new T.Button("Close Small V2"), new T.Text("Up next"), new T.Button("Plus"),
};
List<TimerItem> TimesUp() => new()
{
    new T.Button("home"), new T.Button("stopwatch"), new T.Text("00"), new T.Text(":"), new T.Text("00"),
    new T.Button("Close Small V2"), new T.Text("Up next"), new T.Button("Plus"), new T.Text("Time's Up!"), new T.Button("Close"),
};
List<TimerItem> Overtime(string s) => new()
{
    new T.Button("home"), new T.Button("stopwatch"), new T.Text("-00"), new T.Text(":"), new T.Text(s),
    new T.Button("Close Small V2"), new T.Text("Up next"), new T.Button("Plus"),
};

Console.WriteLine("Parser");
Check("idle 00:03:00", TimerParser.Parse(Idle("00", "03", "00")) == new RawReading.Idle(180));
Check("idle 01:30:15", TimerParser.Parse(Idle("01", "30", "15")) == new RawReading.Idle(5415));
Check("running 00:37", TimerParser.Parse(Running("00", "37")) == new RawReading.Countdown(37, false, "00:37", CountdownMode.Running));
Check("running 02:59", TimerParser.Parse(Running("02", "59")) is RawReading.Countdown { Seconds: 179 });
Check("time's up", TimerParser.Parse(TimesUp()) is RawReading.Countdown { Seconds: 0, Mode: CountdownMode.TimesUp });
Check("overtime -00:05", TimerParser.Parse(Overtime("05")) == new RawReading.Countdown(5, true, "-00:05", CountdownMode.Running));
Check("paused guess", TimerParser.Parse(new List<TimerItem> { new T.Text("01"), new T.Text(":"), new T.Text("10"), new T.Button("Resume") })
    is RawReading.Countdown { Mode: CountdownMode.Paused });
Check("three-part 1:02:03", TimerParser.Parse(new List<TimerItem> { new T.Text("1"), new T.Text(":"), new T.Text("02"), new T.Text(":"), new T.Text("03"), new T.Button("Pause") })
    is RawReading.Countdown { Seconds: 3723, Display: "1:02:03" });
Check("merged text 00:37", TimerParser.Parse(new List<TimerItem> { new T.Text("00:37"), new T.Button("Pause") }) is RawReading.Countdown { Seconds: 37 });
Check("merged text -00:05", TimerParser.Parse(new List<TimerItem> { new T.Text("-00:05") }) is RawReading.Countdown { Seconds: 5, Negative: true });
Check("merged text 1:02:03", TimerParser.Parse(new List<TimerItem> { new T.Text("1:02:03") }) is RawReading.Countdown { Seconds: 3723 });
Check("curly apostrophe", TimerParser.Parse(new List<TimerItem> { new T.Text("00"), new T.Text(":"), new T.Text("00"), new T.Text("Time’s Up!") })
    is RawReading.Countdown { Mode: CountdownMode.TimesUp });
Check("unrelated page → notFound", TimerParser.Parse(new List<TimerItem> { new T.Text("Apps"), new T.Button("Close app") }) is RawReading.NotFound);
Check("label with colon ignored", TimerParser.Parse(new List<TimerItem> { new T.Text("Note"), new T.Text(":"), new T.Text("hello") }) is RawReading.NotFound);

Console.WriteLine("Tracker");
{
    var t = new TimerTracker();
    t.Update(TimerParser.Parse(Idle("00", "03", "00")));
    Check("idle total", t.State is { Status: TimerStatus.Idle, TotalSeconds: 180, RemainingSeconds: 180, Display: "03:00" });
    t.Update(TimerParser.Parse(Running("03", "00")));
    Check("running keeps set total", t.State is { Status: TimerStatus.Running, TotalSeconds: 180 } && t.State.PercentRemaining == 1);
    t.Update(TimerParser.Parse(Running("01", "30")));
    Check("percent 50%", Math.Abs((t.State.PercentRemaining ?? 0) - 0.5) < 1e-9);
    t.Update(TimerParser.Parse(Running("02", "00")));
    Check("+30 grows total", t.State.TotalSeconds == 210, t.State.TotalSeconds?.ToString() ?? "null");
    t.Update(TimerParser.Parse(TimesUp()));
    Check("timesup", t.State is { Status: TimerStatus.TimesUp, RemainingSeconds: 0, TotalSeconds: 210 });
    t.Update(TimerParser.Parse(Overtime("07")));
    Check("overtime", t.State is { Status: TimerStatus.Overtime, OvertimeSeconds: 7, RemainingSeconds: 0, TotalSeconds: 210, Display: "-00:07" });
    Check("unchanged poll not reported", !t.Update(TimerParser.Parse(Overtime("07"))));
    t.Update(TimerParser.Parse(Idle("00", "03", "00")));
    Check("back to idle resets", t.State is { Status: TimerStatus.Idle, TotalSeconds: 180 });

    var mid = new TimerTracker();
    mid.Update(TimerParser.Parse(Running("02", "30")));
    Check("started mid-run uses first read", mid.State.TotalSeconds == 150);
    mid.Update(new RawReading.ZoomClosed());
    Check("zoom closed", mid.State is { Status: TimerStatus.ZoomClosed, TotalSeconds: null });
}

Console.WriteLine("JSON");
{
    var t = new TimerTracker();
    t.Update(new RawReading.Idle(180));
    using var doc = JsonDocument.Parse(t.State.ToJson());
    var keys = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();
    Check("same keys as macOS helper", keys.SequenceEqual(new[] { "display", "overtimeSeconds", "percentRemaining", "remainingSeconds", "status", "totalSeconds", "updatedAt" }), string.Join(",", keys));
    Check("status name", doc.RootElement.GetProperty("status").GetString() == "idle");
    Check("null overtime", doc.RootElement.GetProperty("overtimeSeconds").ValueKind == JsonValueKind.Null);
    Check("timesup name", TimerState.StatusName(TimerStatus.TimesUp) == "timesup");
}

Console.WriteLine("Server");
{
    var overlay = Directory.CreateTempSubdirectory("ztb-overlay").FullName;
    File.WriteAllText(Path.Combine(overlay, "index.html"), "<p>overlay</p>");
    File.WriteAllText(Path.Combine(overlay, "app.js"), "1");
    var store = new LayoutStore(Directory.CreateTempSubdirectory("ztb-store").FullName);
    var probe = new TcpListener(IPAddress.Loopback, 0);
    probe.Start();
    var port = ((IPEndPoint)probe.LocalEndpoint).Port;
    probe.Stop();
    var reading = (RawReading)new RawReading.Idle(180);
    using var bridge = new Bridge(port, overlay, () => reading, store);
    bridge.Start();
    Thread.Sleep(600);
    using var http = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{port}") };

    var state = http.GetStringAsync("/state").Result;
    Check("/state idle", state.Contains("\"status\":\"idle\"") && state.Contains("\"totalSeconds\":180"), state);
    var index = http.GetAsync("/").Result;
    Check("/ serves index.html", index.IsSuccessStatusCode && index.Content.Headers.ContentType?.MediaType == "text/html");
    Check("js mime", http.GetAsync("/app.js").Result.Content.Headers.ContentType?.MediaType == "text/javascript");
    Check("CORS header", index.Headers.TryGetValues("Access-Control-Allow-Origin", out var cors) && cors.Single() == "*");
    Check("missing file 404", http.GetAsync("/nope.html").Result.StatusCode == HttpStatusCode.NotFound);
    Check("traversal 404", RawGet(port, "/../../etc/hosts").StartsWith("HTTP/1.1 404"));
    Check("encoded traversal 404", http.GetAsync("/%2e%2e/%2e%2e/etc/hosts").Result.StatusCode == HttpStatusCode.NotFound);
    Check("dotfile 404", http.GetAsync("/.hidden").Result.StatusCode == HttpStatusCode.NotFound);
    Check("layout 404 before save", http.GetAsync("/layout").Result.StatusCode == HttpStatusCode.NotFound);

    // SSE: first event is the current state, then a layout event after saving.
    var events = new StreamReader(http.GetStreamAsync("/events").Result);
    string? NextData()
    {
        var task = Task.Run(() =>
        {
            string? line;
            while ((line = events.ReadLine()) is not null)
                if (line.StartsWith("data:") || line.StartsWith("event:")) return line;
            return null;
        });
        return task.Wait(3000) ? task.Result : null;
    }
    var first = NextData();
    Check("SSE initial state", first?.Contains("\"status\":\"idle\"") == true, first ?? "timeout");

    var post = http.PostAsync("/layout", new StringContent("{\"items\":[]}", Encoding.UTF8, "application/json")).Result;
    Check("POST /layout 204", post.StatusCode == HttpStatusCode.NoContent);
    Check("GET /layout returns it", http.GetStringAsync("/layout").Result == "{\"items\":[]}");
    Check("SSE layout event", NextData() == "event: layout");
    Check("bad JSON 400", http.PostAsync("/layout", new StringContent("nope")).Result.StatusCode == HttpStatusCode.BadRequest);
    Check("JSON array 400", http.PostAsync("/layout", new StringContent("[1]")).Result.StatusCode == HttpStatusCode.BadRequest);

    reading = new RawReading.Countdown(37, false, "00:37", CountdownMode.Running);
    string? change = null;
    for (var i = 0; i < 5 && change?.Contains("\"status\":\"running\"") != true; i++) change = NextData();
    Check("SSE pushes changes", change?.Contains("\"status\":\"running\"") == true, change ?? "timeout");

    var png = new ByteArrayContent(new byte[] { 0x89, 0x50, 0x4E, 0x47, 1, 2, 3 });
    png.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
    var upload = http.PostAsync("/assets", png).Result;
    var url = upload.IsSuccessStatusCode ? JsonDocument.Parse(upload.Content.ReadAsStringAsync().Result).RootElement.GetProperty("url").GetString() : null;
    Check("upload image 201", upload.StatusCode == HttpStatusCode.Created && url?.StartsWith("/assets/") == true);
    var asset = url is null ? null : http.GetAsync(url).Result;
    Check("serve uploaded image", asset?.IsSuccessStatusCode == true && asset.Content.Headers.ContentType?.MediaType == "image/png");
    var html = new StringContent("<x>");
    html.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/html");
    Check("reject non-image 415", http.PostAsync("/assets", html).Result.StatusCode == HttpStatusCode.UnsupportedMediaType);
    Check("OPTIONS 204", http.SendAsync(new HttpRequestMessage(HttpMethod.Options, "/layout")).Result.StatusCode == HttpStatusCode.NoContent);
    Check("DELETE 405", http.DeleteAsync("/state").Result.StatusCode == HttpStatusCode.MethodNotAllowed);

    try
    {
        using var second = new Bridge(port, overlay, () => reading, store);
        second.Start();
        Check("second copy on same port throws", false);
    }
    catch (SocketException) { Check("second copy on same port throws", true); }
}

Console.WriteLine(failures == 0 ? "All tests passed." : $"{failures} test(s) failed.");
return failures == 0 ? 0 : 1;

// Sends a request line exactly as written (HttpClient would normalize "..").
static string RawGet(int port, string path)
{
    using var client = new TcpClient("127.0.0.1", port);
    var stream = client.GetStream();
    var request = Encoding.ASCII.GetBytes($"GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    stream.Write(request);
    var buffer = new byte[512];
    var n = stream.Read(buffer);
    return Encoding.ASCII.GetString(buffer, 0, n);
}
