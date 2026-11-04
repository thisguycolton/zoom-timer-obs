import AppKit
import ApplicationServices
import Foundation

// ZoomTimerBridge: reads Zoom's in-meeting Timer app via Accessibility and serves it to OBS.
// Runs as a menu bar app inside "Zoom Timer Bridge.app" (or with --menubar), otherwise as a command-line tool.

setvbuf(stdout, nil, _IOLBF, 0)

var port: UInt16 = 17845
var overlayPath: String?
var menuBar = Bundle.main.bundleURL.pathExtension == "app"
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
    switch argument {
    case "--port":
        guard let value = arguments.next().flatMap(UInt16.init) else { fatalError("--port needs a number") }
        port = value
    case "--overlay":
        overlayPath = arguments.next()
    case "--menubar":
        menuBar = true
    case "--cli":
        menuBar = false
    case "-h", "--help":
        print("""
        Usage: ZoomTimerBridge [--port 17845] [--overlay path/to/overlay] [--menubar | --cli]
          Serves http://127.0.0.1:<port>/ (overlay), /state (JSON) and /events (Server-Sent Events).
        """)
        exit(0)
    default:
        // macOS may pass -psn_… or -NS… arguments to apps; ignore anything we don't know.
        if !argument.hasPrefix("-psn") && !argument.hasPrefix("-NS") { print("Ignoring unknown argument \(argument)") }
    }
}

let bridge: Bridge
do {
    bridge = try Bridge(port: port, overlayDirectory: Bridge.locateOverlay(overlayPath))
} catch {
    fatalError("Could not start server on port \(port): \(error)")
}

if menuBar {
    let app = NSApplication.shared
    let delegate = MenuBarApp(bridge: bridge)
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
} else {
    if !AXIsProcessTrusted() {
        let host = ProcessInfo.processInfo.environment["TERM_PROGRAM"].map { " (\($0))" } ?? ""
        print("""
        ⚠️  Accessibility permission is missing, so Zoom's Timer can't be read.
           Open System Settings › Privacy & Security › Accessibility and turn on the app that
           launched ZoomTimerBridge: your terminal app\(host) when started from a shell. Then restart it.
        """)
    }
    bridge.start()
    dispatchMain()
}
