import Foundation

/// Word-level alignment of what was heard against the target sentence.
/// Case/punctuation-insensitive, contractions expanded, word Levenshtein.
enum Align {
    static let contractions: [String: String] = [
        "that's": "that is", "it's": "it is", "what's": "what is", "there's": "there is", "here's": "here is",
        "he's": "he is", "she's": "she is", "let's": "let us", "i'm": "i am", "you're": "you are",
        "we're": "we are", "they're": "they are", "i've": "i have", "you've": "you have", "we've": "we have",
        "they've": "they have", "i'll": "i will", "you'll": "you will", "we'll": "we will", "they'll": "they will",
        "it'll": "it will", "i'd": "i would", "you'd": "you would", "we'd": "we would", "they'd": "they would",
        "don't": "do not", "doesn't": "does not", "didn't": "did not", "can't": "can not", "cannot": "can not",
        "won't": "will not", "isn't": "is not", "aren't": "are not", "wasn't": "was not", "weren't": "were not",
        "haven't": "have not", "hasn't": "has not", "wouldn't": "would not", "shouldn't": "should not",
        "couldn't": "could not",
    ]

    /// Returns (display word, normalized token) pairs. A contraction in the target expands to
    /// several tokens that all map back to the same display word.
    static func tokens(_ text: String) -> [(display: String, norm: String)] {
        var out: [(String, String)] = []
        for raw in text.split(whereSeparator: { $0.isWhitespace }) {
            let display = String(raw)
            var w = display.lowercased().replacingOccurrences(of: "’", with: "'")
            w = String(w.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "'" })
            w = w.trimmingCharacters(in: CharacterSet(charactersIn: "'"))
            if w.isEmpty { continue }
            if let exp = contractions[w] {
                for part in exp.split(separator: " ") { out.append((display, String(part))) }
            } else {
                out.append((display, w))
            }
        }
        return out
    }

    static func assess(target: String, heard: String) -> (score: Int, words: [WordResult]) {
        let T = tokens(target), H = tokens(heard)
        let n = T.count, m = H.count
        if n == 0 { return (0, []) }
        var d = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)
        for i in 0...n { d[i][0] = i }
        for j in 0...m { d[0][j] = j }
        if n > 0 && m > 0 {
            for i in 1...n { for j in 1...m {
                let cost = T[i-1].norm == H[j-1].norm ? 0 : 1
                d[i][j] = min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + cost)
            } }
        }
        // Backtrace: per target token -> heard token or nil
        var perToken: [(norm: String, display: String, heard: String?)] = []
        var i = n, j = m
        while i > 0 {
            if j > 0 && d[i][j] == d[i-1][j-1] + (T[i-1].norm == H[j-1].norm ? 0 : 1) {
                perToken.insert((T[i-1].norm, T[i-1].display, H[j-1].norm), at: 0); i -= 1; j -= 1
            } else if d[i][j] == d[i-1][j] + 1 {
                perToken.insert((T[i-1].norm, T[i-1].display, nil), at: 0); i -= 1
            } else {
                j -= 1 // extra heard word
            }
        }
        // Collapse tokens back to display words (contractions count as one word, ok only if all parts ok)
        var words: [WordResult] = []
        var idx = 0
        var okTokens = 0
        while idx < perToken.count {
            let disp = perToken[idx].display
            var parts: [(String, String?)] = []
            // tokens from the same display word are consecutive
            while idx < perToken.count && perToken[idx].display == disp && (parts.isEmpty || contractions[norm(disp)] != nil) {
                parts.append((perToken[idx].norm, perToken[idx].heard)); idx += 1
            }
            let allOk = parts.allSatisfy { $0.0 == $0.1 }
            okTokens += parts.filter { $0.0 == $0.1 }.count
            let heardWords = parts.compactMap { $0.1 }.filter { !$0.isEmpty }
            let status: WordStatus = allOk ? .ok : (heardWords.isEmpty ? .missed : (similar(norm(disp), heardWords.joined()) ? .weak : .missed))
            words.append(WordResult(word: disp, status: status, heard: allOk ? nil : (heardWords.isEmpty ? nil : heardWords.joined(separator: " "))))
        }
        // Strict on purpose (no per-word confidence on device): only exact words count, and
        // extra inserted words ("explain *me*") count against you. "weak" is shown orange as a hint.
        let ok = words.filter { $0.status == .ok }.count
        let extras = max(0, m - perToken.compactMap { $0.heard }.count)
        let score = Int((100 * Double(ok) / Double(max(words.count + extras, 1))).rounded())
        _ = okTokens
        return (score, words)
    }

    static func norm(_ w: String) -> String {
        String(w.lowercased().replacingOccurrences(of: "’", with: "'").unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "'" })
            .trimmingCharacters(in: CharacterSet(charactersIn: "'"))
    }

    /// Character edit distance ratio, to tell "near miss" (weak) from a different word.
    static func similar(_ a: String, _ b: String) -> Bool {
        let x = Array(a), y = Array(b)
        if x.isEmpty || y.isEmpty { return false }
        var prev = Array(0...y.count)
        for i in 1...x.count {
            var cur = [i] + Array(repeating: 0, count: y.count)
            for j in 1...y.count { cur[j] = min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (x[i-1] == y[j-1] ? 0 : 1)) }
            prev = cur
        }
        return Double(prev[y.count]) / Double(max(x.count, y.count)) <= 0.34
    }
}
