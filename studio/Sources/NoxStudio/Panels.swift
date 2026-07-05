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
    var body: some View {
        List(daemon.runs) { r in
            VStack(alignment: .leading) {
                Text([r.provider, r.model].compactMap { $0 }.joined(separator: " / "))
                    .font(.headline)
                Text(r.prompt ?? "").lineLimit(2).font(.caption)
                HStack {
                    Text(r.status).font(.caption2)
                    if let c = r.cost_usd { Text(String(format: "$%.4f", c)).font(.caption2) }
                    if let n = r.num_turns { Text("\(n) turns").font(.caption2) }
                }.foregroundStyle(.secondary)
            }
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

// ---- integrated terminal (SwiftTerm) -------------------------------------------------

struct TerminalPanel: View {
    var body: some View {
        LocalProcessTerminal()
            .padding(4)
    }
}

/// PTY-backed terminal running the user's shell. MVP (tomorrow) binds cwd to the
/// selected worktree and launches provider profiles in here.
struct LocalProcessTerminal: NSViewRepresentable {
    func makeNSView(context: Context) -> LocalProcessTerminalView {
        let view = LocalProcessTerminalView(frame: .zero)
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        view.startProcess(executable: shell, args: ["-l"])
        return view
    }
    func updateNSView(_ nsView: LocalProcessTerminalView, context: Context) {}
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
