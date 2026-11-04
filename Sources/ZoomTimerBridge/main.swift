import ApplicationServices
import Foundation

// ZoomTimerBridge: reads Zoom's in-meeting Timer app via Accessibility and serves it to OBS.

var port: UInt16 = 17845
var overlayPath: String?
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
    switch argument {
    case "--port":
        guard let value = arguments.next().flatMap(UInt16.init) else { fatalError("--port needs a number") }
        port = value
    case "--overlay":
        overlayPath = arguments.next()
    case "-h", "--help":
        print("""
        Usage: ZoomTimerBridge [--port 17845] [--overlay path/to/overlay]
          Serves http://127.0.0.1:<port>/ (overlay), /state (JSON) and /events (Server-Sent Events).
        """)
        exit(0)
    default:
        fatalError("Unknown argument \(argument). Try --help.")
    }
}

/// Uses --overlay, else ./overlay, else an overlay/ folder next to or above the executable (e.g. the repo when run from .build).
func locateOverlay() -> URL {
    let fm = FileManager.default
    if let overlayPath { return URL(fileURLWithPath: overlayPath) }
    let cwd = URL(fileURLWithPath: fm.currentDirectoryPath).appendingPathComponent("overlay")
    if fm.fileExists(atPath: cwd.appendingPathComponent("index.html").path) { return cwd }
    var dir = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
    for _ in 0..<6 {
        let candidate = dir.appendingPathComponent("overlay")
        if fm.fileExists(atPath: candidate.appendingPathComponent("index.html").path) { return candidate }
        dir.deleteLastPathComponent()
    }
    return cwd
}

func warnIfNotTrusted() {
    guard !AXIsProcessTrusted() else { return }
    let host = ProcessInfo.processInfo.environment["TERM_PROGRAM"].map { " (\($0))" } ?? ""
    print("""
    ⚠️  Accessibility permission is missing, so Zoom's Timer can't be read.
       Open System Settings › Privacy & Security › Accessibility and turn on the app that
       launched ZoomTimerBridge: your terminal app\(host) when started from a shell, or the
       ZoomTimerBridge binary itself if you added it there. Then restart ZoomTimerBridge.
    """)
}

let queue = DispatchQueue(label: "ZoomTimerBridge")
let reader = TimerReader()
let tracker = TimerTracker()
let overlay = locateOverlay()

let server: HTTPServer
do {
    server = try HTTPServer(port: port, overlayDirectory: overlay, queue: queue) { tracker.state }
} catch {
    fatalError("Could not start server on port \(port): \(error)")
}

warnIfNotTrusted()
server.start()
print("ZoomTimerBridge on http://127.0.0.1:\(port)/  (state: /state, events: /events, overlay: \(overlay.path))")

var lastLogged: TimerStatus?
let poll = DispatchSource.makeTimerSource(queue: queue)
poll.schedule(deadline: .now(), repeating: .milliseconds(250))
poll.setEventHandler {
    guard tracker.update(with: reader.read()) else { return }
    let state = tracker.state
    if state.status != lastLogged {
        print("status: \(state.status.rawValue) \(state.display)")
        lastLogged = state.status
        if state.status == .notFound || state.status == .zoomClosed, !AXIsProcessTrusted() { warnIfNotTrusted() }
    }
    server.broadcast(state)
}
poll.resume()

let heartbeat = DispatchSource.makeTimerSource(queue: queue)
heartbeat.schedule(deadline: .now() + 5, repeating: .seconds(5))
heartbeat.setEventHandler { server.heartbeat() }
heartbeat.resume()

setvbuf(stdout, nil, _IOLBF, 0)
dispatchMain()
