using System.Diagnostics;
using System.Windows.Automation;

namespace ZoomTimerBridge;

/// <summary>Reads Zoom's Timer app (a WebView2 page inside Zoom.exe) through Windows UI Automation.
/// The macOS helper reads the same page through the Accessibility API; the element shapes are expected to
/// match (texts "00" ":" "37", edits named hours/minutes/seconds, buttons Start/Pause), but on Windows this
/// is untested, so the search is deliberately forgiving.</summary>
public sealed class ZoomReader
{
    static readonly string[] ProcessNames = { "Zoom" };
    const string TimerDocumentName = "Timer App";

    AutomationElement? cachedDocument;
    int? cachedPid;
    DateTime nextSearch = DateTime.MinValue;

    static HashSet<int> ZoomProcessIds() =>
        ProcessNames.SelectMany(name => Process.GetProcessesByName(name)).Select(p => p.Id).ToHashSet();

    public RawReading Read()
    {
        var pids = ZoomProcessIds();
        if (pids.Count == 0)
        {
            cachedDocument = null;
            cachedPid = null;
            return new RawReading.ZoomClosed();
        }
        if (cachedPid is int pid && !pids.Contains(pid)) cachedDocument = null;

        if (cachedDocument is not null)
        {
            var items = TryCollect(cachedDocument);
            if (items is not null && items.Count > 0)
            {
                var reading = TimerParser.Parse(items);
                if (reading is not RawReading.NotFound) return reading;
            }
            cachedDocument = null;
        }

        // Searching every Zoom window is slow; don't do it more than once a second.
        if (DateTime.UtcNow < nextSearch) return new RawReading.NotFound();
        nextSearch = DateTime.UtcNow.AddSeconds(1);

        foreach (var (document, ownerPid) in FindTimerDocuments(pids))
        {
            var items = TryCollect(document);
            if (items is null) continue;
            var reading = TimerParser.Parse(items);
            if (reading is RawReading.NotFound) continue;
            cachedDocument = document;
            cachedPid = ownerPid;
            return reading;
        }
        return new RawReading.NotFound();
    }

    /// <summary>Zoom's top-level windows, the one whose title mentions "Timer" first (popped out
    /// "Zoom Apps - Timer"), then the rest (e.g. the meeting window when the app is docked).</summary>
    static IEnumerable<(AutomationElement Document, int Pid)> FindTimerDocuments(HashSet<int> pids)
    {
        var windows = new List<AutomationElement>();
        foreach (AutomationElement window in AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition))
        {
            try
            {
                if (pids.Contains(window.Current.ProcessId)) windows.Add(window);
            }
            catch (ElementNotAvailableException) { }
        }
        windows.Sort((a, b) => TitleRank(a).CompareTo(TitleRank(b)));

        var documentCondition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document);
        foreach (var window in windows)
        {
            AutomationElementCollection documents;
            try { documents = window.FindAll(TreeScope.Descendants, documentCondition); }
            catch (ElementNotAvailableException) { continue; }
            var list = documents.Cast<AutomationElement>().ToList();
            // The page title shows up as the document name; prefer it, but try every web document.
            list.Sort((a, b) => (SafeName(a).Contains("Timer", StringComparison.OrdinalIgnoreCase) ? 0 : 1)
                .CompareTo(SafeName(b).Contains("Timer", StringComparison.OrdinalIgnoreCase) ? 0 : 1));
            foreach (var document in list) yield return (document, SafePid(window));
        }
    }

    static int TitleRank(AutomationElement window)
    {
        var name = SafeName(window);
        if (name.Equals("Zoom Apps - Timer", StringComparison.OrdinalIgnoreCase)) return 0;
        if (name.Contains("Timer", StringComparison.OrdinalIgnoreCase)) return 1;
        if (name.Contains("Zoom Apps", StringComparison.OrdinalIgnoreCase)) return 2;
        if (name.Contains("Meeting", StringComparison.OrdinalIgnoreCase)) return 3;
        return 4;
    }

    static string SafeName(AutomationElement e)
    {
        try { return e.Current.Name ?? ""; } catch { return ""; }
    }

    static int SafePid(AutomationElement e)
    {
        try { return e.Current.ProcessId; } catch { return 0; }
    }

    /// <summary>Walks the document in reading order and maps elements like the macOS reader:
    /// Text → text(Name), Edit/Spinner → field(Name, Value), Button → button(Name).</summary>
    static List<TimerItem>? TryCollect(AutomationElement document)
    {
        try
        {
            var items = new List<TimerItem>();
            Collect(TreeWalker.ControlViewWalker, document, 0, items);
            return items;
        }
        catch (ElementNotAvailableException) { return null; }
        catch (InvalidOperationException) { return null; }
        catch (System.Runtime.InteropServices.COMException) { return null; }
    }

    static void Collect(TreeWalker walker, AutomationElement element, int depth, List<TimerItem> items)
    {
        if (depth > 25 || items.Count > 2000) return;
        var child = walker.GetFirstChild(element);
        while (child is not null)
        {
            var type = child.Current.ControlType;
            var name = child.Current.Name ?? "";
            if (type == ControlType.Text)
            {
                if (name.Length > 0) items.Add(new TimerItem.Text(name));
            }
            else if (type == ControlType.Edit || type == ControlType.Spinner)
            {
                items.Add(new TimerItem.Field(FieldTitle(child, name), Value(child)));
                child = walker.GetNextSibling(child);
                continue;
            }
            else if (type == ControlType.Button)
            {
                if (name.Length > 0) items.Add(new TimerItem.Button(name));
            }
            Collect(walker, child, depth + 1, items);
            child = walker.GetNextSibling(child);
        }
    }

    /// <summary>On macOS the fields' titles are exactly "hours"/"minutes"/"seconds" (their aria-labels);
    /// Chromium on Windows may append more, so normalize anything that starts with one of them.</summary>
    static string FieldTitle(AutomationElement element, string name)
    {
        var candidates = new[] { name, SafeHelpText(element), SafeAutomationId(element) };
        foreach (var c in candidates)
        {
            foreach (var unit in new[] { "hours", "minutes", "seconds" })
                if (c.StartsWith(unit, StringComparison.OrdinalIgnoreCase)) return unit;
        }
        return name;
    }

    static string SafeHelpText(AutomationElement e)
    {
        try { return e.Current.HelpText ?? ""; } catch { return ""; }
    }

    static string SafeAutomationId(AutomationElement e)
    {
        try { return e.Current.AutomationId ?? ""; } catch { return ""; }
    }

    static string Value(AutomationElement element)
    {
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var vp)) return ((ValuePattern)vp).Current.Value ?? "";
        if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out var rp)) return ((RangeValuePattern)rp).Current.Value.ToString("0");
        return element.Current.Name ?? "";
    }

    /// <summary>Writes every Zoom window's UI Automation tree (role, name, value) as text, for troubleshooting
    /// on machines where the reader doesn't find the timer.</summary>
    public static string Dump()
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"Zoom Timer Bridge diagnostics {DateTime.Now:yyyy-MM-dd HH:mm:ss}, {Environment.OSVersion}");
        var pids = ZoomProcessIds();
        sb.AppendLine("Zoom process ids: " + (pids.Count == 0 ? "none (Zoom not running)" : string.Join(", ", pids)));
        foreach (AutomationElement window in AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition))
        {
            try
            {
                if (!pids.Contains(window.Current.ProcessId)) continue;
                sb.AppendLine();
                sb.AppendLine($"=== Window \"{window.Current.Name}\" class={window.Current.ClassName}");
                DumpElement(TreeWalker.RawViewWalker, window, 0, sb);
            }
            catch (Exception e) { sb.AppendLine("  (error: " + e.Message + ")"); }
        }
        sb.AppendLine();
        sb.AppendLine("Current reading: " + new ZoomReader().Read());
        return sb.ToString();
    }

    static void DumpElement(TreeWalker walker, AutomationElement element, int depth, System.Text.StringBuilder sb)
    {
        if (depth > 40 || sb.Length > 4_000_000) return;
        var child = walker.GetFirstChild(element);
        while (child is not null)
        {
            try
            {
                var c = child.Current;
                var value = child.TryGetCurrentPattern(ValuePattern.Pattern, out var vp) ? ((ValuePattern)vp).Current.Value : "";
                sb.Append(' ', depth * 2).Append('[').Append(c.ControlType.ProgrammaticName.Replace("ControlType.", ""))
                  .Append("] name=\"").Append(c.Name).Append("\" value=\"").Append(value)
                  .Append("\" id=\"").Append(c.AutomationId).Append("\" class=\"").Append(c.ClassName).AppendLine("\"");
            }
            catch (Exception e) { sb.Append(' ', depth * 2).AppendLine("(error: " + e.Message + ")"); }
            DumpElement(walker, child, depth + 1, sb);
            child = walker.GetNextSibling(child);
        }
    }
}
