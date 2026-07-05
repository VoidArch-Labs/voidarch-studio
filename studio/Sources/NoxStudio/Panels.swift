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
    var body: some View {
        ContentUnavailableView(
            "Worktrees",
            systemImage: "arrow.triangle.branch",
            description: Text("MVP scope (2026-07-06): create/list/diff/cleanup task worktrees via the daemon /api/worktrees endpoints. See studio/README.md.")
        )
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
    var body: some View {
        ContentUnavailableView(
            "Provider launch profiles",
            systemImage: "cpu",
            description: Text("MVP scope (2026-07-06): Claude Code, Codex CLI, generic shell — command template, model, effort, env, prompt-injection mode. Subscription-first; no paid gateways by default.")
        )
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
