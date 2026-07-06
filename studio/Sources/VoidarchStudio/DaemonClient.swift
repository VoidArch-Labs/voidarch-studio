// Client for the local Voidarch Studio daemon (the extended dfc-dashboard.ts server).
// Endpoints consumed: /api/state, /api/tasks/*, /api/worktrees*, /api/runs*, /api/context.
import Foundation

struct StudioTask: Identifiable, Decodable {
    var id: String
    var goal: String
    var status: String
    var tags: [String]?

    // Tolerant decode: legacy daemon rows may omit status/goal — one bad row
    // must never fail the whole /api/state decode (renders as "daemon offline").
    enum CodingKeys: String, CodingKey { case id, goal, status, tags }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        goal = try c.decodeIfPresent(String.self, forKey: .goal) ?? "(untitled)"
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "open"
        tags = try c.decodeIfPresent([String].self, forKey: .tags)
    }
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

struct Worktree: Identifiable, Decodable, Hashable {
    var id: String
    var path: String
    var branch: String
    var baseCommit: String
    var dirty: Bool
    var changedFiles: Int
}

struct WorktreeDiffFile: Identifiable, Decodable {
    var path: String
    var status: String
    var id: String { path }
}

struct WorktreeDiff: Decodable {
    var files: [WorktreeDiffFile]
    var diff: String
}

struct StudioRun: Identifiable, Decodable {
    var id: String
    var taskId: String
    var provider: String
    var model: String?
    var promptProfileId: String?
    var promptHash: String?
    var worktreeId: String?
    var transcriptPath: String
    var startedAt: String
    var finishedAt: String?
    var status: String
    var changedFiles: [String]
    var exitCode: Int?
    var notes: String?
}

struct ContextPack: Decodable {
    var task: String
    var markdown: String
    var token_estimate: Int?
    var target_tokens: Int?
}

@MainActor
final class DaemonClient: ObservableObject {
    /// Daemon base URL — the dfc-dashboard server.
    @Published var baseURL = URL(string: "http://127.0.0.1:4949")!
    @Published var healthy = false
    @Published var tasks: [StudioTask] = []
    @Published var runs: [AgentRun] = []
    @Published var worktrees: [Worktree] = []
    @Published var studioRuns: [StudioRun] = []
    /// Context pack attached from the Context Pack panel; injected as {contextPack}
    /// on the next terminal launch.
    @Published var attachedContextPack: ContextPack?
    @Published var lastError: String?

    func refresh() async {
        do {
            let (data, _) = try await URLSession.shared.data(from: baseURL.appending(path: "/api/state"))
            let state = try JSONDecoder().decode(StateResponse.self, from: data)
            tasks = state.tasks?.elements ?? []
            runs = state.spawned_agents?.elements ?? []
            worktrees = state.worktrees?.elements ?? []
            studioRuns = state.studio_runs?.elements ?? []
            healthy = true
            lastError = nil
        } catch {
            healthy = false
            lastError = error.localizedDescription
        }
    }

    // ---- worktrees (#24) ----------------------------------------------------------

    @discardableResult
    func createWorktree(taskId: String) async -> Worktree? {
        let result: Worktree? = await postDecoding(path: "/api/worktrees", body: ["taskId": taskId])
        await refresh()
        return result
    }

    /// Returns an error message, or nil on success.
    func deleteWorktree(id: String, force: Bool = false) async -> String? {
        var url = baseURL.appending(path: "/api/worktrees/\(id)")
        if force { url.append(queryItems: [URLQueryItem(name: "force", value: "1")]) }
        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            await refresh()
            if (resp as? HTTPURLResponse)?.statusCode == 200 { return nil }
            let err = try? JSONDecoder().decode(APIError.self, from: data)
            return err?.error ?? "delete failed"
        } catch {
            return error.localizedDescription
        }
    }

    func worktreeDiff(id: String) async -> WorktreeDiff? {
        let url = baseURL.appending(path: "/api/worktrees/\(id)/diff")
        guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
        return try? JSONDecoder().decode(WorktreeDiff.self, from: data)
    }

    // ---- runs (#26) -----------------------------------------------------------------

    struct RunCreated: Decodable {
        var id: String
        var transcriptPath: String
    }

    func createRun(taskId: String, worktreeId: String?, provider: String, model: String?,
                   promptProfileId: String?, promptHash: String?) async -> RunCreated? {
        var body: [String: String] = ["taskId": taskId, "provider": provider]
        if let worktreeId { body["worktreeId"] = worktreeId }
        if let model { body["model"] = model }
        if let promptProfileId { body["promptProfileId"] = promptProfileId }
        if let promptHash { body["promptHash"] = promptHash }
        let result: RunCreated? = await postDecoding(path: "/api/runs", body: body)
        await refresh()
        return result
    }

    func finishRun(id: String, status: String, exitCode: Int?, changedFiles: [String]) async {
        var req = URLRequest(url: baseURL.appending(path: "/api/runs/\(id)/finish"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["status": status, "changedFiles": changedFiles]
        if let exitCode { body["exitCode"] = exitCode }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: req)
        await refresh()
    }

    // ---- context packs (#27) --------------------------------------------------------

    func generateContext(task: String) async -> ContextPack? {
        var comps = URLComponents(url: baseURL.appending(path: "/api/context"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "task", value: task)]
        guard let url = comps.url,
              let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
        return try? JSONDecoder().decode(ContextPack.self, from: data)
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

    private func postDecoding<T: Decodable>(path: String, body: [String: String]) async -> T? {
        var req = URLRequest(url: baseURL.appending(path: path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONEncoder().encode(body)
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

private struct APIError: Decodable {
    var error: String?
}

/// Array that drops undecodable elements instead of failing the whole payload.
private struct LossyArray<T: Decodable>: Decodable {
    var elements: [T]
    private struct AnyValue: Decodable {}
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [T] = []
        while !c.isAtEnd {
            if let v = try? c.decode(T.self) { out.append(v) } else { _ = try? c.decode(AnyValue.self) }
        }
        elements = out
    }
}

private struct StateResponse: Decodable {
    var tasks: LossyArray<StudioTask>?
    var spawned_agents: LossyArray<AgentRun>?
    var worktrees: LossyArray<Worktree>?
    var studio_runs: LossyArray<StudioRun>?
}
