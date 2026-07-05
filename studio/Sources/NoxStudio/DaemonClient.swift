// Client for the local Nox Studio daemon (the extended dfc-dashboard.ts server).
// MVP endpoints consumed: /api/health, /api/state, /api/agents, /api/workflows.
// Endpoints the daemon still needs for full MVP (tomorrow):
//   POST /api/worktrees            { task_id } → create isolated worktree
//   GET  /api/worktrees            → list (branch, base, dirty, changed files)
//   DELETE /api/worktrees/:id      → cleanup
//   GET  /api/worktrees/:id/diff   → changed files + basic diff
//   POST /api/runs                 → launch profile in worktree (PTY handled natively via SwiftTerm)
import Foundation

struct StudioTask: Identifiable, Decodable {
    var id: String
    var goal: String
    var status: String
    var tags: [String]?
}

struct AgentRun: Identifiable, Decodable {
    var id: String
    var status: String
    var provider: String?
    var model: String?
    var prompt: String?
    var cost_usd: Double?
    var num_turns: Int?
}

@MainActor
final class DaemonClient: ObservableObject {
    /// Daemon base URL — the dfc-dashboard server.
    @Published var baseURL = URL(string: "http://127.0.0.1:4949")!
    @Published var healthy = false
    @Published var tasks: [StudioTask] = []
    @Published var runs: [AgentRun] = []
    @Published var lastError: String?

    func refresh() async {
        do {
            let (data, _) = try await URLSession.shared.data(from: baseURL.appending(path: "/api/state"))
            let state = try JSONDecoder().decode(StateResponse.self, from: data)
            tasks = state.tasks ?? []
            runs = state.spawned_agents ?? []
            healthy = true
            lastError = nil
        } catch {
            healthy = false
            lastError = error.localizedDescription
        }
    }

    func setTaskStatus(id: String, status: String) async {
        await post(path: "/api/tasks/status", body: ["id": id, "status": status])
        await refresh()
    }

    func addTask(goal: String) async {
        await post(path: "/api/tasks/add", body: ["goal": goal])
        await refresh()
    }

    private func post(path: String, body: [String: String]) async {
        var req = URLRequest(url: baseURL.appending(path: path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONEncoder().encode(body)
        _ = try? await URLSession.shared.data(for: req)
    }
}

private struct StateResponse: Decodable {
    var tasks: [StudioTask]?
    var spawned_agents: [AgentRun]?
}
