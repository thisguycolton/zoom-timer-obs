// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ZoomTimerBridge",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "ZoomTimerBridge", path: "Sources/ZoomTimerBridge")
    ]
)
