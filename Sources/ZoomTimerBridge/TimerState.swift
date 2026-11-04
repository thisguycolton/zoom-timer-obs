import Foundation

enum TimerStatus: String {
    case zoomClosed, notFound, idle, running, paused, timesup, overtime
}

struct TimerState: Equatable {
    var status: TimerStatus = .zoomClosed
    var remainingSeconds: Int?
    var totalSeconds: Int?
    var overtimeSeconds: Int?
    var display: String = ""
    var updatedAt = Date()

    var percentRemaining: Double? {
        guard let remaining = remainingSeconds, let total = totalSeconds, total > 0 else { return nil }
        return min(1, max(0, Double(remaining) / Double(total)))
    }

    /// Equality ignores `updatedAt` so unchanged polls aren't broadcast.
    static func == (a: TimerState, b: TimerState) -> Bool {
        a.status == b.status && a.remainingSeconds == b.remainingSeconds && a.totalSeconds == b.totalSeconds
            && a.overtimeSeconds == b.overtimeSeconds && a.display == b.display
    }

    func json() -> Data {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let object: [String: Any] = [
            "status": status.rawValue,
            "remainingSeconds": remainingSeconds ?? NSNull(),
            "totalSeconds": totalSeconds ?? NSNull(),
            "overtimeSeconds": overtimeSeconds ?? NSNull(),
            "percentRemaining": percentRemaining ?? NSNull(),
            "display": display,
            "updatedAt": iso.string(from: updatedAt),
        ]
        return (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
    }
}

/// Turns successive raw readings into a state with a remembered total duration.
final class TimerTracker {
    private(set) var state = TimerState()
    private var lastIdleSeconds: Int?
    private var lastRemaining: Int?

    /// Returns true when the published state changed.
    func update(with reading: RawReading) -> Bool {
        var next = TimerState()
        switch reading {
        case .zoomClosed:
            next.status = .zoomClosed
            resetRun()
        case .notFound:
            next.status = .notFound
            resetRun()
        case let .idle(setSeconds):
            lastIdleSeconds = setSeconds
            resetRun()
            next.status = .idle
            next.remainingSeconds = setSeconds
            next.totalSeconds = setSeconds
            next.display = Self.format(setSeconds)
        case let .countdown(seconds, negative, display, mode):
            next.display = display
            if negative {
                next.status = .overtime
                next.remainingSeconds = 0
                next.overtimeSeconds = seconds
            } else {
                switch mode {
                case .running: next.status = .running
                case .paused: next.status = .paused
                case .timesUp: next.status = .timesup
                }
                next.remainingSeconds = seconds
                trackTotal(remaining: seconds)
            }
            next.totalSeconds = runTotal ?? lastIdleSeconds
        }
        next.updatedAt = Date()
        let changed = next != state
        state = next
        return changed
    }

    private var runTotal: Int?

    private func trackTotal(remaining: Int) {
        if runTotal == nil {
            // First countdown read of this run: use the duration that was set, else what's on screen.
            runTotal = lastIdleSeconds.map { max($0, remaining) } ?? remaining
            lastIdleSeconds = nil
        } else if let last = lastRemaining, remaining - last >= 20 {
            // The "+30" button (or similar) added time.
            runTotal! += remaining - last
        }
        lastRemaining = remaining
    }

    private func resetRun() {
        runTotal = nil
        lastRemaining = nil
    }

    static func format(_ seconds: Int) -> String {
        let h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }
}
