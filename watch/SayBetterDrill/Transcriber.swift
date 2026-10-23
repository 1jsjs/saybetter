import Foundation
import WhisperKit

/// On-device transcription with WhisperKit (openai_whisper-tiny.en).
/// The model is looked up in the app bundle first (folder `openai_whisper-tiny.en`), otherwise
/// downloaded once from Hugging Face (argmaxinc/whisperkit-coreml) into the app's Documents.
@MainActor
final class Transcriber: ObservableObject {
    static let shared = Transcriber()
    static let model = "openai_whisper-tiny.en"

    enum State: Equatable { case idle, loading(String), ready, failed(String) }
    @Published var state: State = .idle
    private var kit: WhisperKit?

    func load() async throws -> WhisperKit {
        if let kit { return kit }
        state = .loading("Loading model…")
        do {
            let config: WhisperKitConfig
            if let bundled = Bundle.main.url(forResource: Self.model, withExtension: nil) {
                config = WhisperKitConfig(model: Self.model, modelFolder: bundled.path, verbose: false, logLevel: .error, prewarm: false, load: true, download: false)
            } else {
                state = .loading("Downloading tiny.en…")
                let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                config = WhisperKitConfig(model: Self.model, downloadBase: docs, verbose: false, logLevel: .error, prewarm: false, load: true, download: true)
            }
            let k = try await WhisperKit(config)
            kit = k
            state = .ready
            return k
        } catch {
            state = .failed(error.localizedDescription)
            throw error
        }
    }

    func transcribe(_ url: URL) async throws -> String {
        let k = try await load()
        let opts = DecodingOptions(task: .transcribe, language: "en", temperature: 0, usePrefillPrompt: true, skipSpecialTokens: true, withoutTimestamps: true)
        let results = try await k.transcribe(audioPath: url.path, decodeOptions: opts)
        return results.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
