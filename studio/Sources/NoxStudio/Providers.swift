// Provider launch profiles + prompt rendering (#25, spec §MVP-2.6/2.7).
// Built-ins (Claude Code, Codex CLI, generic shell) are code defaults; user edits
// persist to ~/.nox-studio/providers.json and shadow built-ins by id.
import CryptoKit
import Foundation

enum PromptInjectionMode: String, Codable, CaseIterable {
    /// Prompt appended as the final command argument.
    case arg
    /// Prompt written to the process stdin after launch.
    case stdin
    /// No prompt injection (plain shell etc.).
    case none
}

struct ProviderProfile: Identifiable, Codable, Hashable {
    var id: String
    var displayName: String
    var commandTemplate: String
    var argsTemplate: [String]
    var defaultModel: String
    var effort: String
    var envVars: [String: String]
    var supportsInteractive: Bool
    var promptInjectionMode: PromptInjectionMode

    static let builtIns: [ProviderProfile] = [
        ProviderProfile(
            id: "claude-code", displayName: "Claude Code",
            commandTemplate: "claude", argsTemplate: [],
            defaultModel: "sonnet", effort: "medium", envVars: [:],
            supportsInteractive: true, promptInjectionMode: .arg
        ),
        ProviderProfile(
            id: "codex-cli", displayName: "Codex CLI",
            commandTemplate: "codex", argsTemplate: [],
            defaultModel: "", effort: "", envVars: [:],
            supportsInteractive: true, promptInjectionMode: .arg
        ),
        ProviderProfile(
            id: "generic-shell", displayName: "Generic shell",
            commandTemplate: "/bin/zsh", argsTemplate: ["-lc"],
            defaultModel: "", effort: "", envVars: [:],
            supportsInteractive: true, promptInjectionMode: .arg
        ),
    ]
}

@MainActor
final class ProfileStore: ObservableObject {
    @Published var profiles: [ProviderProfile]

    private static var fileURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: ".nox-studio/providers.json")
    }

    init() {
        var byId = Dictionary(uniqueKeysWithValues: ProviderProfile.builtIns.map { ($0.id, $0) })
        if let data = try? Data(contentsOf: Self.fileURL),
           let saved = try? JSONDecoder().decode([ProviderProfile].self, from: data) {
            for p in saved { byId[p.id] = p }
        }
        profiles = byId.values.sorted { $0.displayName < $1.displayName }
    }

    /// Persists ALL profiles (built-ins included once edited) — simpler than
    /// diffing against defaults and harmless at this scale.
    func save() {
        let dir = Self.fileURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(profiles) {
            try? data.write(to: Self.fileURL)
        }
    }

    func update(_ profile: ProviderProfile) {
        if let i = profiles.firstIndex(where: { $0.id == profile.id }) {
            profiles[i] = profile
        } else {
            profiles.append(profile)
        }
        save()
    }
}

// ---- prompt rendering (#25 §2.7) ------------------------------------------------------

/// Fixed MVP prompt sections. {task}, {contextPack}, {worktreePath} substitute at render.
struct PromptSpec {
    var role = "You are a focused coding agent working in an isolated git worktree."
    var task = "{task}"
    var contextPack = "{contextPack}"
    var allowed = "Only modify files inside the worktree: {worktreePath}"
    var forbidden = "Do not push, do not touch other worktrees, do not install global tools."
    var verification = "Run the project's typecheck/tests before declaring done."
    var outputExpectation = "Finish with a short summary of changed files and verification results."

    func render(task: String, contextPack: String, worktreePath: String) -> String {
        let sections: [(String, String)] = [
            ("Role", role), ("Task", self.task), ("Repo context", self.contextPack),
            ("Allowed", allowed), ("Forbidden", forbidden),
            ("Verification", verification), ("Output expectation", outputExpectation),
        ]
        return sections
            .map { "## \($0.0)\n\($0.1)" }
            .joined(separator: "\n\n")
            .replacingOccurrences(of: "{task}", with: task)
            .replacingOccurrences(of: "{contextPack}", with: contextPack)
            .replacingOccurrences(of: "{worktreePath}", with: worktreePath)
    }
}

func promptHash(_ prompt: String) -> String {
    SHA256.hash(data: Data(prompt.utf8)).map { String(format: "%02x", $0) }.joined()
}
