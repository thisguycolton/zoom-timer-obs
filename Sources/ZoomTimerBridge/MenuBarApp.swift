import AppKit
import ApplicationServices
import ServiceManagement

/// Menu bar UI used when running as "Zoom Timer Bridge.app".
final class MenuBarApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let bridge: Bridge
    private var statusItem: NSStatusItem!
    private let statusLine = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    private let permissionItem = NSMenuItem(title: "Grant Accessibility Permission…", action: #selector(openAccessibilitySettings), keyEquivalent: "")
    private let loginItem = NSMenuItem(title: "Start at Login", action: #selector(toggleLogin), keyEquivalent: "")
    private var state = TimerState()
    private var permissionTimer: Timer?

    init(bridge: Bridge) {
        self.bridge = bridge
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "timer", accessibilityDescription: "Zoom Timer Bridge")
        statusItem.button?.imagePosition = .imageLeading

        let menu = NSMenu()
        menu.delegate = self
        statusLine.isEnabled = false
        menu.addItem(statusLine)
        permissionItem.target = self
        menu.addItem(permissionItem)
        menu.addItem(.separator())
        menu.addItem(item("Open Layout Editor", #selector(openEditor), "e"))
        menu.addItem(item("Copy OBS URL", #selector(copyOBSURL), "c"))
        menu.addItem(item("Open Simple Setup", #selector(openSimpleSetup), ""))
        menu.addItem(.separator())
        loginItem.target = self
        menu.addItem(loginItem)
        menu.addItem(item("Setup Guide", #selector(openGuide), ""))
        menu.addItem(.separator())
        menu.addItem(item("Quit Zoom Timer Bridge", #selector(quit), "q"))
        statusItem.menu = menu

        bridge.onChange = { [weak self] state in
            self?.state = state
            self?.refresh()
        }
        bridge.onServerFailure = { error in
            let alert = NSAlert()
            alert.messageText = "Zoom Timer Bridge couldn't start"
            alert.informativeText = "Port \(self.bridge.port) is unavailable (\(error.localizedDescription)). Another copy of Zoom Timer Bridge may already be running; quit it and open this one again."
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
            NSApp.terminate(nil)
        }
        bridge.start()

        if !AXIsProcessTrusted() {
            // Shows the system dialog that offers to open Accessibility settings for this app.
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
            // The grant takes effect without a restart; keep the menu up to date until it arrives.
            permissionTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] timer in
                if AXIsProcessTrusted() { timer.invalidate() }
                self?.refresh()
            }
        }
        refresh()
    }

    private func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    func menuWillOpen(_ menu: NSMenu) { refresh() }

    private func refresh() {
        let trusted = AXIsProcessTrusted()
        permissionItem.isHidden = trusted
        statusLine.title = trusted ? Self.describe(state) : "Needs Accessibility permission"
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off

        // Show the countdown next to the icon while a timer is active.
        let showTime = trusted && [.running, .paused, .timesup, .overtime].contains(state.status)
        statusItem.button?.title = showTime ? " " + state.display : ""
        statusItem.button?.appearsDisabled = !trusted || state.status == .zoomClosed || state.status == .notFound
    }

    static func describe(_ state: TimerState) -> String {
        let total = state.totalSeconds.map(TimerTracker.format)
        switch state.status {
        case .zoomClosed: return "Waiting for Zoom"
        case .notFound: return "Waiting for Zoom Timer (open it in your meeting)"
        case .idle: return "Ready · \(state.display) set"
        case .running: return "Running · \(state.display)" + (total.map { " of \($0)" } ?? "")
        case .paused: return "Paused · \(state.display)"
        case .timesup: return "Time's up"
        case .overtime: return "Over time · \(state.display)"
        }
    }

    // MARK: - Actions

    @objc private func openEditor() { open("/editor.html") }
    @objc private func openSimpleSetup() { open("/config.html") }
    @objc private func openGuide() { NSWorkspace.shared.open(URL(string: "https://github.com/thisguycolton/zoom-timer-obs/blob/main/SETUP.md")!) }

    @objc private func copyOBSURL() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(bridge.baseURL + "/canvas.html", forType: .string)
    }

    @objc private func openAccessibilitySettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }

    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Couldn't change Start at Login"
            alert.informativeText = "\(error.localizedDescription)\n\nMove Zoom Timer Bridge to your Applications folder and try again, or add it in System Settings › General › Login Items."
            alert.runModal()
        }
        refresh()
    }

    @objc private func quit() { NSApp.terminate(nil) }

    private func open(_ path: String) {
        NSWorkspace.shared.open(URL(string: bridge.baseURL + path)!)
    }
}
