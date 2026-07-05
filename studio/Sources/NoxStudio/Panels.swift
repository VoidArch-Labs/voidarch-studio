// MVP panels. Native panels own orchestration state; WebPanel embeds the daemon's
// existing dashboard/Nox pages (hybrid rule from the v2 spec decisions).
import SwiftUI
import WebKit
import SwiftTerm

// ---- native panels -----------------------------------------------------------------

struct DashboardPanel: View {
    @EnvironmentObject var daemon: DaemonClient
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(daemon.healthy ? "Daemon connected" : "Daemon offline — run `pnpm dfc:dashboard`",
                  systemImage: daemon.healthy ? "checkmark.circle" : "xmark.octagon")
                .foregroundStyle(daemon.healthy ? .green : .red)
            if let err = daemon.lastError { Text(err).font(.caption).foregroundStyle(.secondary) }
            Text("Open tasks: \(daemon.tasks.filter { $0.status != "done" }.count)")
            Text("Tracked runs: \(daemon.runs.count)")
            Button("Refresh") { Task { await daemon.refresh() } }
            Spacer()
        }
        .padding().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct TasksPanel: View {
    @EnvironmentObject var daemon: DaemonClient
    @State private var newGoal = ""
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TextField("New task goal", text: $newGoal).textFieldStyle(.roundedBorder)
                Button("Add") {
                    let goal = newGoal.trimmingCharacters(in: .whitespaces)
                    guard !goal.isEmpty else { return }
                    newGoal = ""
                    Task { await daemon.addTask(goal: goal) }
                }
            }.padding()
            List(daemon.tasks) { t in
                HStack {
                    VStack(alignment: .leading) {
                        Text(t.goal)
                        Text(t.status).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if t.status != "done" {
                        Button("Done") { Task { await daemon.setTaskStatus(id: t.id, status: "done") } }
                    }
                }
            }
        }
    }
}

struct WorktreesPanel: View {
    @EnvironmentObject var daemon: DaemonClient
    @State private var selectedTaskId = ""
    @State private var selected: Worktree?
    @State private var diff: WorktreeDiff?
    @State private var confirmForceDelete: Worktree?
    @State private var errorText: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("Task", selection: $selectedTaskId) {
                    Text("Select task…").tag("")
                    ForEach(daemon.tasks.filter { $0.status != "done" }) { t in
                        Text(t.goal).lineLimit(1).tag(t.id)
                    }
                }
                Button("Create worktree") {
                    let taskId = selectedTaskId
                    guard !taskId.isEmpty else { return }
                    Task {
                        if await daemon.createWorktree(taskId: taskId) == nil {
                            errorText = "worktree create failed — see daemon log"
                        }
                    }
                }
                .disabled(selectedTaskId.isEmpty)
                Spacer()
                Button("Refresh") { Task { await daemon.refresh() } }
            }
            .padding()
            if let errorText {
                Text(errorText).font(.caption).foregroundStyle(.red).padding(.horizontal)
            }
            HSplitView {
                List(daemon.worktrees, selection: $selected) { w in
                    VStack(alignment: .leading) {
                        HStack {
                            Text(w.id).font(.headline)
                            if w.dirty {
                                Text("\(w.changedFiles) changed")
                                    .font(.caption2).padding(3)
                                    .background(.orange.opacity(0.3), in: Capsule())
                            }
                        }
                        Text("\(w.branch) @ \(String(w.baseCommit.prefix(8)))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .tag(w)
                    .contextMenu {
                        Button("Remove", role: .destructive) { remove(w) }
                    }
                }
                .frame(minWidth: 260)
                worktreeDetail
            }
        }
        .onChange(of: selected) { _, w in
            diff = nil
            guard let w else { return }
            Task { diff = await daemon.worktreeDiff(id: w.id) }
        }
        .confirmationDialog(
            "Worktree \(confirmForceDelete?.id ?? "") has uncommitted changes. Remove anyway?",
            isPresented: Binding(get: { confirmForceDelete != nil }, set: { if !$0 { confirmForceDelete = nil } })
        ) {
            Button("Force remove", role: .destructive) {
                guard let w = confirmForceDelete else { return }
                Task { errorText = await daemon.deleteWorktree(id: w.id, force: true) }
            }
        }
    }

    private func remove(_ w: Worktree) {
        if w.dirty {
            confirmForceDelete = w
        } else {
            Task { errorText = await daemon.deleteWorktree(id: w.id) }
        }
        if selected == w { selected = nil }
    }

    @ViewBuilder private var worktreeDetail: some View {
        if let w = selected {
            VStack(alignment: .leading, spacing: 8) {
                Text(w.path).font(.caption).textSelection(.enabled)
                if let diff {
                    if diff.files.isEmpty {
                        Text("No changes").foregroundStyle(.secondary)
                    } else {
                        List(diff.files) { f in
                            HStack {
                                Text(f.status).font(.caption.monospaced()).foregroundStyle(.orange)
                                Text(f.path).font(.caption.monospaced())
                            }
                        }
                        .frame(maxHeight: 160)
                        ScrollView {
                            Text(diff.diff)
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                } else {
                    ProgressView()
                }
                Spacer()
            }
            .padding()
        } else {
            ContentUnavailableView("Select a worktree", systemImage: "arrow.triangle.branch")
        }
    }
}

struct RunsPanel: View {
    @EnvironmentObject var daemon: DaemonClient
    @State private var selectedRunId: String?

    var body: some View {
        HSplitView {
            List(selection: $selectedRunId) {
                Section("Studio runs") {
                    ForEach(daemon.studioRuns) { r in
                        VStack(alignment: .leading) {
                            Text("\(r.provider) · \(r.status)").font(.headline)
                            Text("task \(r.taskId) · \(r.startedAt)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .tag(r.id)
                    }
                }
                Section("Headless agents") {
                    ForEach(daemon.runs) { r in
                        VStack(alignment: .leading) {
                            Text([r.provider, r.model].compactMap { $0 }.joined(separator: " / ")).font(.headline)
                            Text(r.status).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .frame(minWidth: 280)
            if let run = daemon.studioRuns.first(where: { $0.id == selectedRunId }) {
                RunDetailView(run: run)
            } else {
                ContentUnavailableView("Select a studio run", systemImage: "play.rectangle.on.rectangle")
            }
        }
    }
}

/// Post-run review (#27): transcript tail, changed files + diff, task status, cleanup.
struct RunDetailView: View {
    @EnvironmentObject var daemon: DaemonClient
    let run: StudioRun
    @State private var diff: WorktreeDiff?

    private var transcriptTail: String {
        guard let text = try? String(contentsOfFile: run.transcriptPath, encoding: .utf8) else {
            return "(no transcript at \(run.transcriptPath))"
        }
        return text.split(separator: "\n").suffix(40).joined(separator: "\n")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("\(run.provider) · \(run.status) · exit \(run.exitCode.map(String.init) ?? "—")")
                    .font(.headline)
                if let hash = run.promptHash {
                    Text("prompt \(run.promptProfileId ?? "?") #\(String(hash.prefix(12)))")
                        .font(.caption.monospaced()).foregroundStyle(.secondary)
                }
                GroupBox("Transcript (tail)") {
                    Text(transcriptTail)
                        .font(.caption.monospaced()).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                GroupBox("Changed files") {
                    if run.changedFiles.isEmpty {
                        Text("none").foregroundStyle(.secondary)
                    } else {
                        ForEach(run.changedFiles, id: \.self) { Text($0).font(.caption.monospaced()) }
                    }
                }
                if let diff, !diff.diff.isEmpty {
                    GroupBox("Diff") {
                        Text(diff.diff)
                            .font(.caption.monospaced()).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                HStack {
                    Text("Mark task:")
                    ForEach(["done", "blocked", "failed"], id: \.self) { s in
                        Button(s) { Task { await daemon.setTaskStatus(id: run.taskId, status: s) } }
                    }
                    Spacer()
                    if let wt = run.worktreeId {
                        Button("Clean up worktree", role: .destructive) {
                            Task { _ = await daemon.deleteWorktree(id: wt, force: true) }
                        }
                    }
                }
            }
            .padding()
        }
        .task(id: run.id) {
            diff = nil
            if let wt = run.worktreeId { diff = await daemon.worktreeDiff(id: wt) }
        }
    }
}

/// Native context-pack builder (#27). The old WKWebView "/nox" embed pointed at the
/// standalone nox page server, which the daemon does not serve — native replaces it
/// against the daemon's /api/context.
struct ContextPackPanel: View {
    @EnvironmentObject var daemon: DaemonClient
    @State private var taskText = ""
    @State private var pack: ContextPack?
    @State private var loading = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TextField("Task to build context for", text: $taskText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { generate() }
                Button("Generate") { generate() }
                    .disabled(taskText.trimmingCharacters(in: .whitespaces).isEmpty || loading)
                if let pack {
                    Button(daemon.attachedContextPack?.task == pack.task ? "Attached ✓" : "Attach to next launch") {
                        daemon.attachedContextPack = pack
                    }
                }
            }
            .padding()
            if loading { ProgressView().padding() }
            if let pack {
                HStack {
                    Text("~\(pack.token_estimate ?? 0) tokens (budget \(pack.target_tokens ?? 0))")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal)
                ScrollView {
                    Text(pack.markdown)
                        .font(.caption.monospaced()).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
            } else if !loading {
                ContentUnavailableView("Generate a context pack", systemImage: "doc.text.magnifyingglass",
                                       description: Text("Built by Nox Memory via the daemon /api/context endpoint. Attach it to inject as {contextPack} on the next terminal launch."))
            }
            Spacer(minLength: 0)
        }
    }

    private func generate() {
        let task = taskText.trimmingCharacters(in: .whitespaces)
        guard !task.isEmpty else { return }
        loading = true
        Task {
            pack = await daemon.generateContext(task: task)
            loading = false
        }
    }
}

struct ProvidersPanel: View {
    @EnvironmentObject var daemon: DaemonClient
    @EnvironmentObject var store: ProfileStore
    @State private var selectedId: String?
    @State private var draft: ProviderProfile?
    @State private var previewTask = "example: fix the dashboard route issue"

    var body: some View {
        HSplitView {
            List(store.profiles, selection: $selectedId) { p in
                VStack(alignment: .leading) {
                    Text(p.displayName).font(.headline)
                    Text("\(p.commandTemplate) \(p.argsTemplate.joined(separator: " "))")
                        .font(.caption.monospaced()).foregroundStyle(.secondary)
                }
                .tag(p.id)
            }
            .frame(minWidth: 220)
            if let d = draft {
                editor(d)
            } else {
                ContentUnavailableView("Select a profile", systemImage: "cpu")
            }
        }
        .onChange(of: selectedId) { _, id in
            draft = store.profiles.first { $0.id == id }
        }
    }

    private func binding<T>(_ keyPath: WritableKeyPath<ProviderProfile, T>) -> Binding<T> {
        Binding(
            get: { draft![keyPath: keyPath] },
            set: { draft?[keyPath: keyPath] = $0 }
        )
    }

    @ViewBuilder private func editor(_ d: ProviderProfile) -> some View {
        let prompt = PromptSpec().render(
            task: previewTask,
            contextPack: daemon.attachedContextPack?.markdown ?? "(no context pack attached)",
            worktreePath: daemon.worktrees.first?.path ?? "(no worktree)"
        )
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Form {
                    TextField("Display name", text: binding(\.displayName))
                    TextField("Command", text: binding(\.commandTemplate))
                    TextField("Args (space-separated)", text: Binding(
                        get: { draft!.argsTemplate.joined(separator: " ") },
                        set: { draft?.argsTemplate = $0.split(separator: " ").map(String.init) }
                    ))
                    TextField("Default model", text: binding(\.defaultModel))
                    TextField("Effort", text: binding(\.effort))
                    TextField("Env vars (KEY=V,KEY2=V2)", text: Binding(
                        get: { draft!.envVars.map { "\($0.key)=\($0.value)" }.sorted().joined(separator: ",") },
                        set: { text in
                            var env: [String: String] = [:]
                            for pair in text.split(separator: ",") {
                                let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
                                if kv.count == 2 { env[kv[0]] = kv[1] }
                            }
                            draft?.envVars = env
                        }
                    ))
                    Toggle("Interactive", isOn: binding(\.supportsInteractive))
                    Picker("Prompt injection", selection: binding(\.promptInjectionMode)) {
                        ForEach(PromptInjectionMode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    Button("Save") {
                        if let draft { store.update(draft) }
                    }
                }
                Divider()
                Text("Final prompt preview").font(.headline)
                TextField("Preview task text", text: $previewTask).textFieldStyle(.roundedBorder)
                Text("hash: \(promptHash(prompt))")
                    .font(.caption.monospaced()).foregroundStyle(.secondary)
                    .textSelection(.enabled)
                Text(prompt)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 6))
            }
            .padding()
        }
    }
}

struct SettingsPanel: View {
    @EnvironmentObject var daemon: DaemonClient
    @State private var urlText = ""
    var body: some View {
        Form {
            TextField("Daemon URL", text: $urlText, prompt: Text(daemon.baseURL.absoluteString))
            Button("Apply") {
                if let u = URL(string: urlText), u.scheme != nil { daemon.baseURL = u }
                Task { await daemon.refresh() }
            }
        }.padding()
    }
}

// ---- integrated terminal + run loop (#26) --------------------------------------------

/// One terminal launch bound to a run record.
struct TerminalLaunch: Identifiable, Equatable {
    var id: String            // run id
    var worktreeId: String?
    var cwd: String
    var shellCommand: String  // full zsh -lc line (cd + command + tee transcript)
    var stdinPrompt: String?  // sent after launch when injection mode is .stdin
}

/// Escape a string for single-quoted zsh interpolation.
private func shellQuote(_ s: String) -> String {
    "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

struct TerminalPanel: View {
    @EnvironmentObject var daemon: DaemonClient
    @EnvironmentObject var store: ProfileStore
    @State private var selectedTaskId = ""
    @State private var selectedProfileId = "generic-shell"
    @State private var selectedWorktreeId = ""
    @State private var promptOverride = ""
    @State private var launch: TerminalLaunch?
    @State private var running = false
    private let terminalRef = TerminalRef()

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("Task", selection: $selectedTaskId) {
                    Text("Task…").tag("")
                    ForEach(daemon.tasks.filter { $0.status != "done" }) { Text($0.goal).lineLimit(1).tag($0.id) }
                }.frame(maxWidth: 260)
                Picker("Profile", selection: $selectedProfileId) {
                    ForEach(store.profiles) { Text($0.displayName).tag($0.id) }
                }.frame(maxWidth: 200)
                Picker("Worktree", selection: $selectedWorktreeId) {
                    Text("repo root").tag("")
                    ForEach(daemon.worktrees) { Text($0.id).tag($0.id) }
                }.frame(maxWidth: 200)
                Button("Launch agent") { Task { await launchAgent() } }
                    .disabled(selectedTaskId.isEmpty || running)
                Button("Kill", role: .destructive) { killRun() }
                    .disabled(!running)
                Spacer()
            }
            .padding(8)
            TextField("Prompt override (empty = rendered profile prompt; for generic shell this is the command)",
                      text: $promptOverride)
                .textFieldStyle(.roundedBorder).padding(.horizontal, 8)
            RunTerminal(launch: launch, ref: terminalRef) { exitCode in
                Task { await runExited(exitCode: exitCode) }
            }
            .id(launch?.id ?? "idle-shell")
            .padding(4)
        }
    }

    private func launchAgent() async {
        guard let task = daemon.tasks.first(where: { $0.id == selectedTaskId }),
              let profile = store.profiles.first(where: { $0.id == selectedProfileId }) else { return }
        let worktree = daemon.worktrees.first { $0.id == selectedWorktreeId }
        let cwd = worktree?.path ?? FileManager.default.currentDirectoryPath
        let prompt = promptOverride.isEmpty
            ? PromptSpec().render(
                task: task.goal,
                contextPack: daemon.attachedContextPack?.markdown ?? "(none)",
                worktreePath: cwd)
            : promptOverride
        guard let run = await daemon.createRun(
            taskId: task.id, worktreeId: worktree?.id,
            provider: profile.id, model: profile.defaultModel.isEmpty ? nil : profile.defaultModel,
            promptProfileId: profile.id, promptHash: promptHash(prompt)) else { return }

        var parts = [profile.commandTemplate] + profile.argsTemplate
        if profile.promptInjectionMode == .arg { parts.append(prompt) }
        let env = profile.envVars.map { "export \($0.key)=\(shellQuote($0.value));" }.joined(separator: " ")
        let cmd = parts.dropFirst().reduce(shellQuote(parts[0])) { $0 + " " + shellQuote($1) }
        // ponytail: transcript via tee, not a dataReceived subclass — captures stdout/stderr,
        // loses raw keystrokes; switch to a TerminalView subclass if full fidelity matters.
        let line = "cd \(shellQuote(cwd)) && \(env) \(cmd) 2>&1 | tee \(shellQuote(run.transcriptPath)); exit ${pipestatus[1]}"
        launch = TerminalLaunch(
            id: run.id, worktreeId: worktree?.id, cwd: cwd, shellCommand: line,
            stdinPrompt: profile.promptInjectionMode == .stdin ? prompt : nil)
        running = true
    }

    private func runExited(exitCode: Int32?) async {
        guard let launch else { return }
        running = false
        var changed: [String] = []
        if let wt = launch.worktreeId, let diff = await daemon.worktreeDiff(id: wt) {
            changed = diff.files.map(\.path)
        }
        await daemon.finishRun(
            id: launch.id,
            status: exitCode == 0 ? "done" : "failed",
            exitCode: exitCode.map(Int.init),
            changedFiles: changed)
    }

    private func killRun() {
        terminalRef.view?.process.terminate()
        // processTerminated fires with a nil/normal exit; force failed status here.
        if let launch {
            running = false
            Task { await daemon.finishRun(id: launch.id, status: "failed", exitCode: nil, changedFiles: []) }
        }
        launch = nil
    }
}

/// Escape hatch so the panel can terminate the PTY child.
final class TerminalRef {
    weak var view: LocalProcessTerminalView?
}

struct RunTerminal: NSViewRepresentable {
    var launch: TerminalLaunch?
    var ref: TerminalRef
    var onExit: (Int32?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onExit: onExit) }

    func makeNSView(context: Context) -> LocalProcessTerminalView {
        let view = LocalProcessTerminalView(frame: .zero)
        view.processDelegate = context.coordinator
        ref.view = view
        if let launch {
            view.startProcess(executable: "/bin/zsh", args: ["-lc", launch.shellCommand],
                              currentDirectory: launch.cwd)
            if let prompt = launch.stdinPrompt {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak view] in
                    view?.send(txt: prompt + "\n")
                }
            }
        } else {
            let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
            view.startProcess(executable: shell, args: ["-l"])
        }
        return view
    }
    func updateNSView(_ nsView: LocalProcessTerminalView, context: Context) {}

    final class Coordinator: NSObject, LocalProcessTerminalViewDelegate {
        let onExit: (Int32?) -> Void
        init(onExit: @escaping (Int32?) -> Void) { self.onExit = onExit }
        func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}
        func setTerminalTitle(source: LocalProcessTerminalView, title: String) {}
        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
        func processTerminated(source: TerminalView, exitCode: Int32?) {
            onExit(exitCode)
        }
    }
}

// ---- embedded dashboard views (WKWebView) --------------------------------------------

struct WebPanel: NSViewRepresentable {
    @EnvironmentObject var daemon: DaemonClient
    let path: String

    func makeNSView(context: Context) -> WKWebView {
        let web = WKWebView()
        web.load(URLRequest(url: URL(string: daemon.baseURL.absoluteString + path)!))
        return web
    }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
