import Foundation
import Network

/// Minimal HTTP/1.1 server bound to 127.0.0.1: /state, /events (SSE) and static files.
/// All work runs on `queue`, which the caller shares with the timer reader.
final class HTTPServer {
    private let listener: NWListener
    private let queue: DispatchQueue
    private let overlayDirectory: URL
    private let currentState: () -> TimerState
    private var eventClients: [ObjectIdentifier: NWConnection] = [:]
    private let layoutStore = LayoutStore()
    /// Called (on the server queue) if the listener fails, e.g. the port is already in use. Default: exit.
    var onFailure: ((Error) -> Void)?
    /// Request bodies are only accepted for POST /layout; a background image may be inlined as a data URL.
    private static let maxBodySize = 12 * 1024 * 1024

    init(port: UInt16, overlayDirectory: URL, queue: DispatchQueue, currentState: @escaping () -> TimerState) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        parameters.allowLocalEndpointReuse = true
        listener = try NWListener(using: parameters)
        self.queue = queue
        self.overlayDirectory = overlayDirectory
        self.currentState = currentState
    }

    func start() {
        listener.stateUpdateHandler = { [weak self] state in
            if case let .failed(error) = state {
                FileHandle.standardError.write(Data("Server failed: \(error)\n".utf8))
                if let onFailure = self?.onFailure { onFailure(error) } else { exit(1) }
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { return }
            connection.start(queue: self.queue)
            self.receiveRequest(on: connection, buffer: Data())
        }
        listener.start(queue: queue)
    }

    /// Sends the state to every /events client.
    func broadcast(_ state: TimerState) {
        let message = Data("data: ".utf8) + state.json() + Data("\n\n".utf8)
        for connection in eventClients.values {
            connection.send(content: message, completion: .contentProcessed { _ in })
        }
    }

    /// Tells /events clients (the canvas overlay in OBS) to re-fetch /layout.
    private func broadcastLayoutChanged() {
        let message = Data("event: layout\ndata: {}\n\n".utf8)
        for connection in eventClients.values {
            connection.send(content: message, completion: .contentProcessed { _ in })
        }
    }

    func heartbeat() {
        for connection in eventClients.values {
            connection.send(content: Data(": ping\n\n".utf8), completion: .contentProcessed { _ in })
        }
    }

    // MARK: - Requests

    private func receiveRequest(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[..<end.lowerBound], as: UTF8.self)
                let length = Self.contentLength(head)
                let body = buffer[end.upperBound...]
                if length > Self.maxBodySize {
                    self.respond(connection, status: "413 Payload Too Large", body: Data())
                } else if body.count >= length {
                    self.handle(head: head, body: Data(body.prefix(length)), on: connection)
                } else if error != nil || isComplete {
                    connection.cancel()
                } else {
                    self.receiveRequest(on: connection, buffer: buffer)
                }
            } else if error != nil || isComplete || buffer.count > 64 * 1024 {
                connection.cancel()
            } else {
                self.receiveRequest(on: connection, buffer: buffer)
            }
        }
    }

    private static func header(_ name: String, in head: String) -> String? {
        for line in head.split(separator: "\r\n").dropFirst() {
            let pair = line.split(separator: ":", maxSplits: 1)
            if pair.count == 2, pair[0].trimmingCharacters(in: .whitespaces).lowercased() == name {
                return pair[1].trimmingCharacters(in: .whitespaces)
            }
        }
        return nil
    }

    private static func contentLength(_ head: String) -> Int {
        header("content-length", in: head).flatMap(Int.init) ?? 0
    }

    private func handle(head: String, body: Data, on connection: NWConnection) {
        let parts = head.split(separator: "\r\n", maxSplits: 1).first?.split(separator: " ") ?? []
        guard parts.count >= 2 else { return respond(connection, status: "400 Bad Request", body: Data()) }
        let method = String(parts[0])
        let path = String(parts[1].split(separator: "?", maxSplits: 1).first ?? "/")

        if method == "OPTIONS" { return respond(connection, status: "204 No Content", body: Data()) }
        if path == "/layout" && (method == "POST" || method == "PUT") {
            guard (try? JSONSerialization.jsonObject(with: body)) is [String: Any] else {
                return respond(connection, status: "400 Bad Request", body: Data("Expected a JSON object".utf8))
            }
            do {
                try layoutStore.save(body)
            } catch {
                return respond(connection, status: "500 Internal Server Error", body: Data("\(error)".utf8))
            }
            broadcastLayoutChanged()
            return respond(connection, status: "204 No Content", body: Data())
        }
        if path == "/assets" && method == "POST" {
            do {
                let url = try layoutStore.saveAsset(body, contentType: Self.header("content-type", in: head) ?? "")
                let json = try JSONSerialization.data(withJSONObject: ["url": url])
                return respond(connection, status: "201 Created", contentType: "application/json", body: json)
            } catch {
                return respond(connection, status: "415 Unsupported Media Type", body: Data("Upload a PNG, JPEG, GIF, WebP or SVG image".utf8))
            }
        }
        guard method == "GET" || method == "HEAD" else {
            return respond(connection, status: "405 Method Not Allowed", body: Data())
        }

        switch path {
        case "/state":
            respond(connection, status: "200 OK", contentType: "application/json", body: currentState().json())
        case "/layout":
            if let layout = layoutStore.load() {
                respond(connection, status: "200 OK", contentType: "application/json", body: layout)
            } else {
                respond(connection, status: "404 Not Found", contentType: "application/json", body: Data("null".utf8))
            }
        case "/events":
            openEventStream(connection)
        case _ where path.hasPrefix("/assets/"):
            serveFile(path: String(path.dropFirst("/assets".count)), from: layoutStore.assetsDirectory, on: connection)
        default:
            serveFile(path: path, from: overlayDirectory, on: connection)
        }
    }

    private func openEventStream(_ connection: NWConnection) {
        let head = """
        HTTP/1.1 200 OK\r
        Content-Type: text/event-stream\r
        Cache-Control: no-cache\r
        Connection: keep-alive\r
        Access-Control-Allow-Origin: *\r
        \r
        retry: 1000\n\n
        """
        let id = ObjectIdentifier(connection)
        eventClients[id] = connection
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.eventClients[id] = nil
            default: break
            }
        }
        connection.send(content: Data(head.utf8) + Data("data: ".utf8) + currentState().json() + Data("\n\n".utf8),
                        completion: .contentProcessed { _ in })
        // Detect the client going away.
        watchForClose(connection)
    }

    private func watchForClose(_ connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1024) { [weak self] _, _, isComplete, error in
            if isComplete || error != nil {
                connection.cancel()
            } else {
                self?.watchForClose(connection)
            }
        }
    }

    private func serveFile(path: String, from directory: URL, on connection: NWConnection) {
        var relative = path.removingPercentEncoding ?? path
        if relative.hasSuffix("/") { relative += "index.html" }
        let components = relative.split(separator: "/").map(String.init)
        guard !components.contains(where: { $0 == ".." || $0.hasPrefix(".") }) else {
            return respond(connection, status: "404 Not Found", body: Data("Not found".utf8))
        }
        let url = components.reduce(directory) { $0.appendingPathComponent($1) }
        guard let data = try? Data(contentsOf: url) else {
            return respond(connection, status: "404 Not Found", body: Data("Not found".utf8))
        }
        respond(connection, status: "200 OK", contentType: Self.mimeType(for: url.pathExtension), body: data)
    }

    private func respond(_ connection: NWConnection, status: String, contentType: String = "text/plain; charset=utf-8", body: Data) {
        let head = "HTTP/1.1 \(status)\r\n"
            + "Content-Type: \(contentType)\r\n"
            + "Content-Length: \(body.count)\r\n"
            + "Cache-Control: no-cache\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n"
            + "Access-Control-Allow-Headers: Content-Type\r\n"
            + "Connection: close\r\n\r\n"
        connection.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
    }

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        default: return "application/octet-stream"
        }
    }
}
