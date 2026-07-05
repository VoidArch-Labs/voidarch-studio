// Nox Studio — hybrid SwiftUI shell. MVP loop (spec v2):
// register repo → task → worktree → context pack → provider profile → terminal run
// → run tracking → diff review → cleanup.
import SwiftUI

@main
struct NoxStudioApp: App {
    @StateObject private var daemon = DaemonClient()

    var body: some Scene {
        WindowGroup("Nox Studio") {
            RootView()
                .environmentObject(daemon)
                .frame(minWidth: 1100, minHeight: 720)
        }
    }
}

enum Panel: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case repos = "Repos"
    case tasks = "Tasks"
    case contextPack = "Context Pack"
    case worktrees = "Worktrees"
    case terminal = "Terminal"
    case runs = "Runs"
    case providers = "Providers"
    case settings = "Settings"
    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .dashboard: "gauge"
        case .repos: "folder"
        case .tasks: "checklist"
        case .contextPack: "doc.text.magnifyingglass"
        case .worktrees: "arrow.triangle.branch"
        case .terminal: "terminal"
        case .runs: "play.rectangle.on.rectangle"
        case .providers: "cpu"
        case .settings: "gearshape"
        }
    }

    /// Hybrid rule: native panels own orchestration; WKWebView panels reuse the
    /// daemon's existing dashboard views for memory/context/repo inspection.
    var isNative: Bool {
        switch self {
        case .tasks, .worktrees, .terminal, .runs, .dashboard, .settings, .providers: true
        case .repos, .contextPack: false
        }
    }
}

struct RootView: View {
    @EnvironmentObject var daemon: DaemonClient
    @State private var selection: Panel = .dashboard

    var body: some View {
        NavigationSplitView {
            List(Panel.allCases, selection: $selection) { panel in
                Label(panel.rawValue, systemImage: panel.systemImage).tag(panel)
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
        } detail: {
            switch selection {
            case .dashboard: DashboardPanel()
            case .repos: WebPanel(path: "/#memory")          // daemon dashboard view
            case .tasks: TasksPanel()
            case .contextPack: WebPanel(path: "/nox")        // Nox Memory page (context builder)
            case .worktrees: WorktreesPanel()
            case .terminal: TerminalPanel()
            case .runs: RunsPanel()
            case .providers: ProvidersPanel()
            case .settings: SettingsPanel()
            }
        }
        .task { await daemon.refresh() }
    }
}
