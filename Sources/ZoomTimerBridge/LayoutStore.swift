import Foundation

/// Persists the canvas layout made in editor.html, plus uploaded images, under
/// ~/Library/Application Support/ZoomTimerBridge/ (layout.json and assets/).
final class LayoutStore {
    private let directory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("ZoomTimerBridge")
    }()
    private var layoutURL: URL { directory.appendingPathComponent("layout.json") }
    var assetsDirectory: URL { directory.appendingPathComponent("assets") }

    func load() -> Data? {
        try? Data(contentsOf: layoutURL)
    }

    func save(_ data: Data) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: layoutURL, options: .atomic)
    }

    /// Stores an uploaded image and returns the path it is served at.
    func saveAsset(_ data: Data, contentType: String) throws -> String {
        let ext: String
        switch contentType.lowercased().split(separator: ";").first.map(String.init) ?? "" {
        case "image/png": ext = "png"
        case "image/jpeg": ext = "jpg"
        case "image/gif": ext = "gif"
        case "image/webp": ext = "webp"
        case "image/svg+xml": ext = "svg"
        default: throw CocoaError(.fileWriteUnsupportedScheme)
        }
        try FileManager.default.createDirectory(at: assetsDirectory, withIntermediateDirectories: true)
        let name = UUID().uuidString.lowercased() + "." + ext
        try data.write(to: assetsDirectory.appendingPathComponent(name), options: .atomic)
        return "/assets/" + name
    }
}
