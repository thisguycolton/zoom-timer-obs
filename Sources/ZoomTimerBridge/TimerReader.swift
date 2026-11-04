import AppKit
import ApplicationServices

/// What the reader saw in Zoom's Timer app on one poll.
enum RawReading: Equatable {
    case zoomClosed
    case notFound
    /// Setup screen: the hours/minutes/seconds text fields are visible.
    case idle(setSeconds: Int)
    /// A countdown is on screen. `negative` means Zoom shows a leading "-" (overtime).
    case countdown(seconds: Int, negative: Bool, display: String, mode: CountdownMode)
}

enum CountdownMode: Equatable {
    case running
    /// Best guess: digits on screen plus a Start/Resume button. Not yet observed live.
    case paused
    case timesUp
}

/// Reads Zoom's Timer app (a WKWebView inside zoom.us) through the macOS Accessibility API.
final class TimerReader {
    static let zoomBundleID = "us.zoom.xos"
    static let timerWindowTitle = "Zoom Apps - Timer"
    static let webAreaDescription = "Timer App"

    private var cachedPID: pid_t?
    private var cachedWebArea: AXUIElement?

    func read() -> RawReading {
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: Self.zoomBundleID).first else {
            cachedPID = nil
            cachedWebArea = nil
            return .zoomClosed
        }
        if cachedPID != app.processIdentifier {
            cachedPID = app.processIdentifier
            cachedWebArea = nil
        }
        if let area = cachedWebArea, isAlive(area) == false {
            cachedWebArea = nil
        }
        if cachedWebArea == nil {
            cachedWebArea = findWebArea(pid: app.processIdentifier)
        }
        guard let area = cachedWebArea else { return .notFound }

        var items: [Item] = []
        collect(area, depth: 0, into: &items)
        if items.isEmpty {
            // The element may have been recycled by WebKit; search again next poll.
            cachedWebArea = nil
            return .notFound
        }
        return Self.parse(items)
    }

    // MARK: - Parsing

    enum Item: Equatable {
        case text(String)
        case field(title: String, value: String)
        case button(String)
    }

    static func parse(_ items: [Item]) -> RawReading {
        var fields: [String: Int] = [:]
        var texts: [String] = []
        var buttons: Set<String> = []
        for item in items {
            switch item {
            case let .field(title, value): fields[title.lowercased()] = Int(value) ?? 0
            case let .text(value): texts.append(value.trimmingCharacters(in: .whitespaces))
            case let .button(title): buttons.insert(title.lowercased())
            }
        }

        if let h = fields["hours"], let m = fields["minutes"], let s = fields["seconds"] {
            return .idle(setSeconds: h * 3600 + m * 60 + s)
        }

        guard let time = findTime(in: texts) else { return .notFound }

        let timesUp = texts.contains { $0.lowercased().replacingOccurrences(of: "’", with: "'").contains("time's up") }
        let mode: CountdownMode
        if timesUp || (time.seconds == 0 && !time.negative) {
            mode = .timesUp
        } else if buttons.contains("pause") {
            mode = .running
        } else if !buttons.isDisjoint(with: ["start", "resume", "play"]) {
            mode = .paused
        } else {
            mode = .running
        }
        return .countdown(seconds: time.seconds, negative: time.negative, display: time.display, mode: mode)
    }

    /// Finds the clock by its shape: number ":" number [":" number], e.g. "00" ":" "37" or "-00" ":" "05".
    static func findTime(in texts: [String]) -> (seconds: Int, negative: Bool, display: String)? {
        func number(_ s: String) -> Int? {
            let digits = s.hasPrefix("-") ? String(s.dropFirst()) : s
            guard !digits.isEmpty, digits.count <= 3, digits.allSatisfy(\.isNumber) else { return nil }
            return Int(digits)
        }
        var i = 0
        while i + 2 < texts.count {
            if let first = number(texts[i]), texts[i + 1] == ":", let second = number(texts[i + 2]), !texts[i + 2].hasPrefix("-") {
                var parts = [first, second]
                var raw = [texts[i], texts[i + 2]]
                if i + 4 < texts.count, texts[i + 3] == ":", let third = number(texts[i + 4]), !texts[i + 4].hasPrefix("-") {
                    parts.append(third)
                    raw.append(texts[i + 4])
                }
                let seconds = parts.reduce(0) { $0 * 60 + $1 }
                return (seconds, texts[i].hasPrefix("-"), raw.joined(separator: ":"))
            }
            i += 1
        }
        return nil
    }

    // MARK: - Accessibility helpers

    private func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
        var value: AnyObject?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }

    private func string(_ element: AXUIElement, _ name: String) -> String {
        (attribute(element, name) as? String) ?? ""
    }

    private func children(_ element: AXUIElement) -> [AXUIElement] {
        (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
    }

    private func isAlive(_ element: AXUIElement) -> Bool {
        var value: AnyObject?
        return AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &value) == .success
    }

    /// Prefers the popped-out "Zoom Apps - Timer" window, then any other window (e.g. popped in to the meeting).
    private func findWebArea(pid: pid_t) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        let windows = (attribute(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
        let ordered = windows.sorted { a, _ in string(a, kAXTitleAttribute) == Self.timerWindowTitle }
        for window in ordered {
            if let area = searchWebArea(window, depth: 0) { return area }
        }
        return nil
    }

    private func searchWebArea(_ element: AXUIElement, depth: Int) -> AXUIElement? {
        if depth > 30 { return nil }
        if string(element, kAXRoleAttribute) == "AXWebArea" {
            return string(element, kAXDescriptionAttribute) == Self.webAreaDescription ? element : nil
        }
        for child in children(element) {
            if let found = searchWebArea(child, depth: depth + 1) { return found }
        }
        return nil
    }

    private func collect(_ element: AXUIElement, depth: Int, into items: inout [Item]) {
        if depth > 20 { return }
        switch string(element, kAXRoleAttribute) {
        case "AXStaticText":
            items.append(.text(string(element, kAXValueAttribute)))
        case "AXTextField":
            items.append(.field(title: string(element, kAXTitleAttribute), value: string(element, kAXValueAttribute)))
            return
        case "AXButton":
            let title = string(element, kAXTitleAttribute)
            if !title.isEmpty { items.append(.button(title)) }
        default:
            break
        }
        for child in children(element) {
            collect(child, depth: depth + 1, into: &items)
        }
    }
}
