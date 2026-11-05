using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ZoomTimerBridge;

/// <summary>What the reader saw in Zoom's Timer app on one poll. Mirrors the macOS helper.</summary>
public abstract record RawReading
{
    public sealed record ZoomClosed : RawReading;
    public sealed record NotFound : RawReading;
    /// <summary>Setup screen: the hours/minutes/seconds fields are visible.</summary>
    public sealed record Idle(int SetSeconds) : RawReading;
    /// <summary>A countdown is on screen. Negative means Zoom shows a leading "-" (overtime).</summary>
    public sealed record Countdown(int Seconds, bool Negative, string Display, CountdownMode Mode) : RawReading;
}

public enum CountdownMode { Running, Paused, TimesUp }

/// <summary>One element read from the Timer app's web page, in document order.</summary>
public abstract record TimerItem
{
    public sealed record Text(string Value) : TimerItem;
    public sealed record Field(string Title, string Value) : TimerItem;
    public sealed record Button(string Title) : TimerItem;
}

public static class TimerParser
{
    public static RawReading Parse(IReadOnlyList<TimerItem> items)
    {
        var fields = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var texts = new List<string>();
        var buttons = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items)
        {
            switch (item)
            {
                case TimerItem.Field f:
                    fields[f.Title.Trim()] = int.TryParse(f.Value.Trim(), out var n) ? n : 0;
                    break;
                case TimerItem.Text t:
                    texts.Add(t.Value.Trim());
                    break;
                case TimerItem.Button b:
                    buttons.Add(b.Title.Trim());
                    break;
            }
        }

        if (fields.TryGetValue("hours", out var h) && fields.TryGetValue("minutes", out var m) && fields.TryGetValue("seconds", out var s))
            return new RawReading.Idle(h * 3600 + m * 60 + s);

        var time = FindTime(texts);
        if (time is null) return new RawReading.NotFound();
        var (seconds, negative, display) = time.Value;

        var timesUp = texts.Any(t => t.Replace('’', '\'').Contains("time's up", StringComparison.OrdinalIgnoreCase));
        CountdownMode mode;
        if (timesUp || (seconds == 0 && !negative)) mode = CountdownMode.TimesUp;
        else if (buttons.Contains("pause")) mode = CountdownMode.Running;
        // Best guess: digits on screen plus a Start/Resume button. Not yet observed live.
        else if (buttons.Contains("start") || buttons.Contains("resume") || buttons.Contains("play")) mode = CountdownMode.Paused;
        else mode = CountdownMode.Running;
        return new RawReading.Countdown(seconds, negative, display, mode);
    }

    static readonly Regex Number = new(@"^-?\d{1,3}$", RegexOptions.Compiled);

    /// <summary>Finds the clock by its shape: number ":" number [":" number], e.g. "00" ":" "37" or "-00" ":" "05".
    /// Also accepts a single "00:37"-style string, in case Windows exposes the clock as one text node.</summary>
    public static (int Seconds, bool Negative, string Display)? FindTime(IReadOnlyList<string> texts)
    {
        static int? Num(string s, bool allowMinus) =>
            Number.IsMatch(s) && (allowMinus || !s.StartsWith('-')) ? int.Parse(s.TrimStart('-'), CultureInfo.InvariantCulture) : null;

        for (var i = 0; i + 2 < texts.Count; i++)
        {
            if (Num(texts[i], true) is not int first || texts[i + 1] != ":" || Num(texts[i + 2], false) is not int second) continue;
            var parts = new List<int> { first, second };
            var raw = new List<string> { texts[i], texts[i + 2] };
            if (i + 4 < texts.Count && texts[i + 3] == ":" && Num(texts[i + 4], false) is int third)
            {
                parts.Add(third);
                raw.Add(texts[i + 4]);
            }
            return (parts.Aggregate(0, (acc, p) => acc * 60 + p), texts[i].StartsWith('-'), string.Join(":", raw));
        }

        foreach (var t in texts)
        {
            var match = Regex.Match(t, @"^(-?)(\d{1,3}):(\d{2})(?::(\d{2}))?$");
            if (!match.Success) continue;
            var nums = new[] { match.Groups[2], match.Groups[3], match.Groups[4] }.Where(g => g.Success).Select(g => int.Parse(g.Value, CultureInfo.InvariantCulture));
            return (nums.Aggregate(0, (acc, p) => acc * 60 + p), match.Groups[1].Value == "-", t);
        }
        return null;
    }
}

public enum TimerStatus { ZoomClosed, NotFound, Idle, Running, Paused, TimesUp, Overtime }

public sealed record TimerState
{
    public TimerStatus Status { get; init; } = TimerStatus.ZoomClosed;
    public int? RemainingSeconds { get; init; }
    public int? TotalSeconds { get; init; }
    public int? OvertimeSeconds { get; init; }
    public string Display { get; init; } = "";
    public DateTimeOffset UpdatedAt { get; init; } = DateTimeOffset.UtcNow;

    public double? PercentRemaining =>
        RemainingSeconds is int r && TotalSeconds is int t && t > 0 ? Math.Clamp((double)r / t, 0, 1) : null;

    /// <summary>Same JSON shape as the macOS helper (status names match its rawValues).</summary>
    public static string StatusName(TimerStatus s) => s switch
    {
        TimerStatus.ZoomClosed => "zoomClosed",
        TimerStatus.NotFound => "notFound",
        TimerStatus.Idle => "idle",
        TimerStatus.Running => "running",
        TimerStatus.Paused => "paused",
        TimerStatus.TimesUp => "timesup",
        _ => "overtime",
    };

    /// <summary>Equality ignores UpdatedAt so unchanged polls aren't broadcast.</summary>
    public bool SameAs(TimerState o) => Status == o.Status && RemainingSeconds == o.RemainingSeconds &&
        TotalSeconds == o.TotalSeconds && OvertimeSeconds == o.OvertimeSeconds && Display == o.Display;

    public byte[] ToJson()
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream))
        {
            w.WriteStartObject();
            w.WriteString("display", Display);
            WriteNumber(w, "overtimeSeconds", OvertimeSeconds);
            if (PercentRemaining is double p) w.WriteNumber("percentRemaining", p); else w.WriteNull("percentRemaining");
            WriteNumber(w, "remainingSeconds", RemainingSeconds);
            w.WriteString("status", StatusName(Status));
            WriteNumber(w, "totalSeconds", TotalSeconds);
            w.WriteString("updatedAt", UpdatedAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
            w.WriteEndObject();
        }
        return stream.ToArray();
    }

    static void WriteNumber(Utf8JsonWriter w, string name, int? value)
    {
        if (value is int v) w.WriteNumber(name, v); else w.WriteNull(name);
    }
}

/// <summary>Turns successive raw readings into a state with a remembered total duration.</summary>
public sealed class TimerTracker
{
    public TimerState State { get; private set; } = new();
    int? lastIdleSeconds;
    int? lastRemaining;
    int? runTotal;

    /// <summary>Returns true when the published state changed.</summary>
    public bool Update(RawReading reading)
    {
        TimerState next;
        switch (reading)
        {
            case RawReading.ZoomClosed:
                ResetRun();
                next = new TimerState { Status = TimerStatus.ZoomClosed };
                break;
            case RawReading.Idle idle:
                lastIdleSeconds = idle.SetSeconds;
                ResetRun();
                next = new TimerState
                {
                    Status = TimerStatus.Idle, RemainingSeconds = idle.SetSeconds, TotalSeconds = idle.SetSeconds,
                    Display = Format(idle.SetSeconds),
                };
                break;
            case RawReading.Countdown c when c.Negative:
                next = new TimerState
                {
                    Status = TimerStatus.Overtime, RemainingSeconds = 0, OvertimeSeconds = c.Seconds,
                    TotalSeconds = runTotal ?? lastIdleSeconds, Display = c.Display,
                };
                break;
            case RawReading.Countdown c:
                TrackTotal(c.Seconds);
                next = new TimerState
                {
                    Status = c.Mode switch { CountdownMode.Paused => TimerStatus.Paused, CountdownMode.TimesUp => TimerStatus.TimesUp, _ => TimerStatus.Running },
                    RemainingSeconds = c.Seconds, TotalSeconds = runTotal ?? lastIdleSeconds, Display = c.Display,
                };
                break;
            default:
                ResetRun();
                next = new TimerState { Status = TimerStatus.NotFound };
                break;
        }
        var changed = !next.SameAs(State);
        State = next;
        return changed;
    }

    void TrackTotal(int remaining)
    {
        if (runTotal is null)
        {
            // First countdown read of this run: use the duration that was set, else what's on screen.
            runTotal = lastIdleSeconds is int set ? Math.Max(set, remaining) : remaining;
            lastIdleSeconds = null;
        }
        else if (lastRemaining is int last && remaining - last >= 20)
        {
            // The "+30" button (or similar) added time.
            runTotal += remaining - last;
        }
        lastRemaining = remaining;
    }

    void ResetRun()
    {
        runTotal = null;
        lastRemaining = null;
    }

    public static string Format(int seconds)
    {
        int h = seconds / 3600, m = seconds % 3600 / 60, s = seconds % 60;
        return h > 0 ? $"{h}:{m:00}:{s:00}" : $"{m:00}:{s:00}";
    }
}
