import SwiftUI

extension ShapeStyle where Self == Color {
    static var bee: Color { Color(red: 1.0, green: 0.831, blue: 0.0) } // #FFD400
    static var miss: Color { Color(red: 1.0, green: 0.42, blue: 0.42) }
}

@main
struct SayBetterDrillApp: App {
    var body: some Scene {
        WindowGroup { DrillListView() }
    }
}

// MARK: - Settings

enum Settings {
    /// "auto" (WhisperKit, fall back to server on failure), "device", "server".
    static var mode: String {
        get { UserDefaults.standard.string(forKey: "mode") ?? "auto" }
        set { UserDefaults.standard.set(newValue, forKey: "mode") }
    }
    /// Test hook: a WAV path to use instead of the microphone (simulator demos).
    static var testAudio: String? { UserDefaults.standard.string(forKey: "testAudio") }
    /// Test hook: open the first drill automatically.
    static var openFirst: Bool { UserDefaults.standard.bool(forKey: "openFirst") }
}

// MARK: - Screen 1: list

struct DrillListView: View {
    @State private var drills: [Drill] = []
    @State private var error: String?
    @State private var loading = true
    @State private var path: [Drill] = []
    @State private var source: String?

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if loading && drills.isEmpty {
                    HStack { ProgressView(); Text("Loading…") }
                }
                if let error {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Can't reach SayBetter").font(.headline)
                        Text(error).font(.caption2).foregroundStyle(.secondary)
                        Text(API.base.absoluteString).font(.caption2).foregroundStyle(.secondary)
                        Button("Retry") { Task { await reload() } }.tint(.bee)
                    }
                }
                ForEach(drills) { d in
                    NavigationLink(value: d) {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 4) {
                                if d.done == true { Image(systemName: "checkmark.circle.fill").foregroundStyle(.bee) }
                                if let a = d.alarmLabel { Text(a).font(.caption2).foregroundStyle(.bee) }
                            }
                            Text(d.natural).font(.system(.body, design: .rounded)).lineLimit(3)
                                .foregroundStyle(d.done == true ? .secondary : .primary)
                        }.padding(.vertical, 2)
                    }
                }
                if !drills.isEmpty {
                    Text(source == "bee" ? "From your Bee todos" : "Offline copy — Bee unreachable")
                        .font(.caption2).foregroundStyle(.secondary).listRowBackground(Color.clear)
                }
                if !drills.isEmpty || error != nil {
                    NavigationLink { SettingsView() } label: {
                        Label("Settings", systemImage: "gearshape").font(.footnote)
                    }
                }
            }
            .navigationTitle("Today's drills")
            .navigationDestination(for: Drill.self) { d in
                DrillView(drill: d) { done in
                    if let i = drills.firstIndex(where: { $0.id == d.id }) { drills[i].done = true; drills[i].score = done }
                }
            }
            .task { await reload() }
            .refreshable { await reload() }
        }
        .tint(.bee)
    }

    func reload() async {
        loading = true
        defer { loading = false }
        do {
            let r = try await API.drills()
            drills = r.items
            source = r.source
            error = nil
            if Settings.openFirst, path.isEmpty, let first = drills.first(where: { $0.done != true }) ?? drills.first { path = [first] }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct SettingsView: View {
    @State private var mode = Settings.mode
    var body: some View {
        Form {
            Picker("Transcription", selection: $mode) {
                Text("Auto").tag("auto")
                Text("On watch").tag("device")
                Text("Mac server").tag("server")
            }
            .onChange(of: mode) { _, v in Settings.mode = v }
            Section("Server") { Text(API.base.absoluteString).font(.caption2) }
            Section("Model") { ModelStatusRow() }
        }
        .navigationTitle("Settings")
    }
}

struct ModelStatusRow: View {
    @ObservedObject var t = Transcriber.shared
    var body: some View {
        switch t.state {
        case .idle: Button("Load tiny.en") { Task { _ = try? await t.load() } }
        case .loading(let s): HStack { ProgressView(); Text(s).font(.caption2) }
        case .ready: Label("tiny.en ready", systemImage: "checkmark").font(.caption2)
        case .failed(let e): Text("Failed: \(e)").font(.caption2).foregroundStyle(.miss)
        }
    }
}

// MARK: - Screen 2: drill

struct DrillView: View {
    let drill: Drill
    var onDone: (Int) -> Void

    enum Phase: Equatable { case ready, recording, checking(String), result, error(String) }
    @State private var phase: Phase = .ready
    @State private var result: DrillResult?
    @State private var beeState: String?
    @StateObject private var recorder = Recorder()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if let result {
                    ResultView(result: result, beeState: beeState)
                } else {
                    Text(drill.natural)
                        .font(.system(.title3, design: .rounded).weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    if let o = drill.original, !o.isEmpty {
                        Text("You said: \(o)").font(.caption2).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                controls.frame(maxWidth: .infinity).padding(.top, 4)
            }
        }
        .navigationTitle("Say it")
        .task {
            if Settings.testAudio != nil && phase == .ready && result == nil { await run() }
        }
    }

    @ViewBuilder var controls: some View {
        switch phase {
        case .ready, .result, .error:
            if case .error(let e) = phase { Text(e).font(.caption2).foregroundStyle(.miss) }
            if result?.passed != true {
                Button { Task { await run() } } label: {
                    Label(result == nil ? "Say it" : "Try again", systemImage: "mic.fill").font(.headline)
                }
                .buttonStyle(.borderedProminent).tint(.bee).foregroundStyle(.black)
            }
        case .recording:
            VStack(spacing: 4) {
                ProgressView(value: min(recorder.elapsed, recorder.maxSeconds), total: recorder.maxSeconds).tint(.bee)
                Button { recorder.stop() } label: { Label("Stop", systemImage: "stop.fill") }
                    .buttonStyle(.bordered)
            }
        case .checking(let s):
            HStack { ProgressView(); Text(s).font(.caption2) }
        }
    }

    func run() async {
        result = nil; beeState = nil
        // 1. audio
        var audio: URL?
        if let t = Settings.testAudio {
            audio = URL(fileURLWithPath: t)
        } else {
            guard await recorder.requestPermission() else { phase = .error("Microphone permission denied"); return }
            phase = .recording
            do { audio = try await recorder.record() } catch { phase = .error(error.localizedDescription); return }
        }
        guard let audio else { phase = .error("Recording failed"); return }

        // 2. transcribe + align
        let mode = Settings.mode
        var note: String?
        var r: DrillResult?
        if mode != "server" {
            phase = .checking("Listening on watch…")
            do {
                let heard = try await Transcriber.shared.transcribe(audio)
                let a = Align.assess(target: drill.natural, heard: heard)
                r = DrillResult(target: drill.natural, heard: heard, score: a.score, words: a.words, tips: [], path: .onDevice, note: nil)
            } catch {
                if mode == "device" { phase = .error("WhisperKit: \(error.localizedDescription)"); return }
                note = "WhisperKit failed: \(error.localizedDescription)"
            }
        }
        if r == nil {
            phase = .checking("Checking on Mac…")
            do {
                let s = try await API.pronounce(audio: audio, target: drill.natural, id: drill.todo_id)
                r = DrillResult(target: drill.natural, heard: s.heard ?? "", score: s.score, words: s.words,
                                tips: (s.tips ?? []).compactMap(\.tip_ko), path: .server, note: note)
            } catch {
                phase = .error("Server: \(error.localizedDescription)"); return
            }
        }
        guard let r else { return }
        result = r
        phase = .result
        print("[SayBetterDrill] path=\(r.path.rawValue) score=\(r.score) heard=\(r.heard)")

        // 3. complete in Bee on pass
        if r.passed {
            beeState = "Marking done in Bee…"
            do {
                let res = try await API.complete(todoId: drill.todo_id, score: r.score, heard: r.heard, words: r.words)
                if res.ok {
                    beeState = "Done in Bee ✓"
                    if let n = res.fact?.watch_passes { beeState! += "\nBee fact: practised \(n)× on watch" }
                } else {
                    beeState = "Saved, but Bee didn't confirm"
                }
                onDone(r.score)
            } catch {
                beeState = "Couldn't reach Bee: \(error.localizedDescription)"
            }
        }
    }
}

struct ResultView: View {
    let result: DrillResult
    let beeState: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(result.score)%").font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(result.passed ? Color.bee : Color.miss)
                Text(result.passed ? "Pass" : "Again").font(.headline).foregroundStyle(.secondary)
            }
            words
            if !result.heard.isEmpty {
                Text("Heard: \(result.heard)").font(.caption2).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(result.tips.prefix(2), id: \.self) { t in
                Text(t).font(.caption2).fixedSize(horizontal: false, vertical: true)
            }
            if let beeState {
                Text(beeState).font(.footnote.weight(.semibold)).foregroundStyle(.bee)
            }
            Text(result.path.rawValue).font(.system(size: 10)).foregroundStyle(.secondary)
            if let n = result.note { Text(n).font(.system(size: 9)).foregroundStyle(.secondary) }
        }
    }

    var words: some View {
        result.words.reduce(Text("")) { acc, w in
            let color: Color = w.status == .ok ? .primary : (w.status == .weak ? .orange : .miss)
            var t = Text(w.word + " ").foregroundColor(color)
            if w.status != .ok { t = t.underline() }
            return acc + t
        }
        .font(.system(.body, design: .rounded))
        .fixedSize(horizontal: false, vertical: true)
    }
}
