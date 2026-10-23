import AVFoundation

/// Records up to `maxSeconds` of 16 kHz mono 16-bit PCM WAV.
@MainActor
final class Recorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published var isRecording = false
    @Published var elapsed: Double = 0
    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var continuation: CheckedContinuation<URL?, Never>?
    let maxSeconds: Double = 8

    func requestPermission() async -> Bool {
        await withCheckedContinuation { c in
            AVAudioApplication.requestRecordPermission { ok in c.resume(returning: ok) }
        }
    }

    /// Starts recording; returns the file URL when stopped (by `stop()` or after maxSeconds).
    func record() async throws -> URL? {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [])
        try session.setActive(true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("drill-\(Int(Date().timeIntervalSince1970)).wav")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]
        let r = try AVAudioRecorder(url: url, settings: settings)
        r.delegate = self
        guard r.record(forDuration: maxSeconds) else { throw NSError(domain: "Recorder", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not start recording"]) }
        recorder = r
        isRecording = true
        elapsed = 0
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.elapsed = self?.recorder?.currentTime ?? 0 }
        }
        return await withCheckedContinuation { c in self.continuation = c }
    }

    func stop() { recorder?.stop() }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            self.timer?.invalidate(); self.timer = nil
            self.isRecording = false
            try? AVAudioSession.sharedInstance().setActive(false)
            self.continuation?.resume(returning: flag ? recorder.url : nil)
            self.continuation = nil
        }
    }
}
