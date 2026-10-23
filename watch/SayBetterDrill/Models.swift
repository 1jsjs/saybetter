import Foundation

struct Drill: Codable, Identifiable, Hashable {
    let todo_id: Int
    let natural: String
    let original: String?
    let alarm_at: String?
    var done: Bool?
    var score: Int?

    var id: Int { todo_id }

    var alarmLabel: String? {
        guard let s = alarm_at else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: s) ?? ISO8601DateFormatter().date(from: s) else { return nil }
        let out = DateFormatter()
        out.dateFormat = Calendar.current.isDateInToday(d) ? "'Today' HH:mm" : (Calendar.current.isDateInTomorrow(d) ? "'Tomorrow' HH:mm" : "MMM d HH:mm")
        return out.string(from: d)
    }
}

struct DrillsResponse: Codable { let items: [Drill] }

enum WordStatus: String, Codable { case ok, weak, missed }

struct WordResult: Codable, Hashable {
    let word: String
    let status: WordStatus
    let heard: String?
}

/// Which engine actually produced the transcript (shown on the result screen).
enum TranscriptionPath: String, CaseIterable, Identifiable {
    case onDevice = "On-watch WhisperKit"
    case server = "Mac whisper.cpp"
    var id: String { rawValue }
}

struct DrillResult {
    let target: String
    let heard: String
    let score: Int
    let words: [WordResult]
    let tips: [String]
    let path: TranscriptionPath
    let note: String?          // e.g. why we fell back
    var passed: Bool { score >= 80 }
}

/// Server response of POST /api/pronounce
struct PronounceResponse: Codable {
    struct Tip: Codable { let tip_ko: String? }
    let heard: String?
    let score: Int
    let words: [WordResult]
    let tips: [Tip]?
}

struct CompleteResponse: Codable { let ok: Bool }
