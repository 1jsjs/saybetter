import Foundation

enum API {
    /// Server base URL. Override with launch argument `-server http://host:port` or the in-app setting.
    static var base: URL {
        if let s = UserDefaults.standard.string(forKey: "server"), let u = URL(string: s), !s.isEmpty { return u }
        #if targetEnvironment(simulator)
        return URL(string: "http://localhost:4173")!
        #else
        return URL(string: "http://192.168.123.105:4173")!
        #endif
    }

    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 30
        c.timeoutIntervalForResource = 120
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    struct HTTPError: LocalizedError {
        let status: Int; let body: String
        var errorDescription: String? { "HTTP \(status): \(body.prefix(120))" }
    }

    private static func check(_ data: Data, _ resp: URLResponse) throws {
        if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            throw HTTPError(status: h.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
    }

    static func drills() async throws -> [Drill] {
        let (data, resp) = try await session.data(from: base.appendingPathComponent("api/drills"))
        try check(data, resp)
        return try JSONDecoder().decode(DrillsResponse.self, from: data).items
    }

    static func complete(todoId: Int, score: Int, heard: String, words: [WordResult]) async throws -> Bool {
        var req = URLRequest(url: base.appendingPathComponent("api/drills/complete"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["todo_id": todoId, "score": score, "heard": heard, "words": words.map { ["word": $0.word, "status": $0.status.rawValue, "heard": ($0.heard.map { $0 as Any }) ?? NSNull()] }])
        let (data, resp) = try await session.data(for: req)
        try check(data, resp)
        return try JSONDecoder().decode(CompleteResponse.self, from: data).ok
    }

    /// Fallback path: upload the WAV, the Mac runs whisper.cpp and aligns.
    static func pronounce(audio: URL, target: String, id: Int) async throws -> PronounceResponse {
        var comps = URLComponents(url: base.appendingPathComponent("api/pronounce"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "target", value: target), URLQueryItem(name: "id", value: String(id))]
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "POST"
        req.setValue("audio/wav", forHTTPHeaderField: "content-type")
        req.timeoutInterval = 120
        let (data, resp) = try await session.upload(for: req, from: try Data(contentsOf: audio))
        try check(data, resp)
        return try JSONDecoder().decode(PronounceResponse.self, from: data)
    }
}
