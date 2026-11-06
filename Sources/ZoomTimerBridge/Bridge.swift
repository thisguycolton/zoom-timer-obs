import ApplicationServices
import Foundation

/// Polls Zoom's Timer and serves it over HTTP. Shared by the command-line and menu bar modes.
final class Bridge {
    let port: UInt16
    let overlayDirectory: URL
    /// Called on the main queue whenever the published state changes.
    var onChange: ((TimerState) -> Void)?

    private let queue = DispatchQueue(label: "ZoomTimerBridge")
    private let reader = TimerReader()
    private let tracker = TimerTracker()
    private var server: HTTPServer!
    private var poll: DispatchSourceTimer?
    private var heartbeat: DispatchSourceTimer?
    private var lastLogged: TimerStatus?

    init(port: UInt16, overlayDirectory: URL) throws {
        self.port = port
        self.overlayDirectory = overlayDirectory
        server = try HTTPServer(port: port, overlayDirectory: overlayDirectory, queue: queue) { [unowned self] in
            self.tracker.state
        }
        server.onVisibilityChange = { [unowned self] _ in
            let state = self.clientState()
            DispatchQueue.main.async { self.onChange?(state) }
        }
    }

    /// Hide Overlay toggle (also reachable at /visibility/...). Safe to call from any thread.
    func setOverlayHidden(_ hidden: Bool) {
        queue.async { self.server.setOverlayHidden(hidden) }
    }

    /// Must be called on `queue`.
    private func clientState() -> TimerState {
        var state = tracker.state
        state.overlayHidden = server.overlayHidden
        return state
    }

    /// Forwarded to the main queue; e.g. "address already in use".
    var onServerFailure: ((Error) -> Void)? {
        didSet {
            let handler = onServerFailure
            server.onFailure = handler.map { h in { error in DispatchQueue.main.async { h(error) } } }
        }
    }

    var baseURL: String { "http://127.0.0.1:\(port)" }

    func start() {
        server.start()
        print("ZoomTimerBridge on \(baseURL)/  (state: /state, events: /events, overlay: \(overlayDirectory.path))")

        let poll = DispatchSource.makeTimerSource(queue: queue)
        poll.schedule(deadline: .now(), repeating: .milliseconds(250))
        poll.setEventHandler { [unowned self] in self.tick() }
        poll.resume()
        self.poll = poll

        let heartbeat = DispatchSource.makeTimerSource(queue: queue)
        heartbeat.schedule(deadline: .now() + 5, repeating: .seconds(5))
        heartbeat.setEventHandler { [unowned self] in self.server.heartbeat() }
        heartbeat.resume()
        self.heartbeat = heartbeat
    }

    private func tick() {
        guard tracker.update(with: reader.read()) else { return }
        let state = clientState()
        if state.status != lastLogged {
            print("status: \(state.status.rawValue) \(state.display)")
            lastLogged = state.status
        }
        server.broadcast(state)
        DispatchQueue.main.async { self.onChange?(state) }
    }

    /// Uses --overlay, else the app bundle's Resources/overlay, else ./overlay, else an overlay/ folder
    /// next to or above the executable (e.g. the repo when run from .build).
    static func locateOverlay(_ explicitPath: String?) -> URL {
        let fm = FileManager.default
        let hasIndex = { (url: URL) in fm.fileExists(atPath: url.appendingPathComponent("index.html").path) }
        if let explicitPath { return URL(fileURLWithPath: explicitPath) }
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("overlay"), hasIndex(bundled) { return bundled }
        let cwd = URL(fileURLWithPath: fm.currentDirectoryPath).appendingPathComponent("overlay")
        if hasIndex(cwd) { return cwd }
        var dir = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
        for _ in 0..<6 {
            let candidate = dir.appendingPathComponent("overlay")
            if hasIndex(candidate) { return candidate }
            dir.deleteLastPathComponent()
        }
        return cwd
    }
}
