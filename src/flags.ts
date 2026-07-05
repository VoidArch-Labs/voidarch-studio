// Feature-flag registry for the Nox / Nox Studio split.
// The status field is the truth claim — never mark a flag past what actually works.
// Spec: docs/mvp/nox-and-nox-studio-mvp.md

export type FlagStatus = "planned" | "scaffolded" | "experimental" | "stable";

export interface FeatureFlag {
  id: string;
  owner: "memory" | "studio";
  status: FlagStatus;
  defaultEnabled: boolean;
  requiresApproval: boolean;
  description: string;
}

export const FLAGS: FeatureFlag[] = [
  // ---- Nox (memory engine) -----------------------------------------------------------
  {
    id: "memory.localEmbeddings",
    owner: "memory",
    status: "stable",
    defaultEnabled: true,
    requiresApproval: false,
    description: "No-key local embedding default: Transformers.js model auto-downloads and caches outside the repo, content-hash dedupe.",
  },
  {
    id: "memory.openaiCompatibleEmbeddings",
    owner: "memory",
    status: "stable",
    defaultEnabled: false,
    requiresApproval: true,
    description: "OpenAI-compatible embedding endpoint (dfc:embed). Paid path needs DFC_EMBED_PROVIDER + key + explicit approval — never silent.",
  },
  {
    id: "memory.graph",
    owner: "memory",
    status: "stable",
    defaultEnabled: true,
    requiresApproval: false,
    description: "Graph channel: dfc:graph:build (external graphify-surreal binary) or dfc:graph:import (graphify JSON), query/status.",
  },
  {
    id: "memory.contextPackExplain",
    owner: "memory",
    status: "experimental",
    defaultEnabled: true,
    requiresApproval: false,
    description: "Deterministic query-plan seed and context-pack preview metadata (issue #11/#16).",
  },
  {
    id: "memory.lifecycle",
    owner: "memory",
    status: "scaffolded",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Retrieval-facing lifecycle hints and stale/superseded score penalty seed; review/merge/promote flows remain future work (issue #12).",
  },
  // ---- Nox Studio (agent orchestration) ----------------------------------------------
  {
    id: "studio.worktrees",
    owner: "studio",
    status: "experimental",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Worktree creation, tracking, cleanup, and PR promotion per agent run.",
  },
  {
    id: "studio.terminal",
    owner: "studio",
    status: "scaffolded",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Integrated PTY terminal sessions attached to runs/worktrees.",
  },
  {
    id: "studio.promptRegistry",
    owner: "studio",
    status: "scaffolded",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Versioned system prompts/presets for agent launches (issue #10).",
  },
  {
    id: "studio.providerRouter",
    owner: "studio",
    status: "experimental",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Provider/model routing controller, subscription-first (issue #9). Seeds exist: launcher provider registry, haiku verify-clamp.",
  },
  {
    id: "studio.quotaTracking",
    owner: "studio",
    status: "scaffolded",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Quota windows, cooldowns, fallback chains (issue #9). Seed exists: Grok 24h cooldown.",
  },
  {
    id: "studio.mcpGateway",
    owner: "studio",
    status: "planned",
    defaultEnabled: false,
    requiresApproval: true,
    description: "Central MCP allow/deny + observability proxy for launched agents.",
  },
  {
    id: "studio.hookGateway",
    owner: "studio",
    status: "planned",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Serve the fail-closed hook policy to launched agents uniformly.",
  },
  {
    id: "studio.github",
    owner: "studio",
    status: "planned",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Read-only GitHub PR/check/review monitoring panel.",
  },
  {
    id: "studio.vercelReadonly",
    owner: "studio",
    status: "planned",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Read-only Vercel deployment status panel. No write actions.",
  },
  {
    id: "studio.observabilityTimeline",
    owner: "studio",
    status: "planned",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Trace model + timeline UI over .agent-runs and agent_run/tool_event (issue #13).",
  },
  {
    id: "studio.contextPackPreview",
    owner: "studio",
    status: "planned",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Context-pack preview, scoring, and feedback loop panel (issue #16).",
  },
  {
    id: "studio.memoryLifecycle",
    owner: "studio",
    status: "planned",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Studio panel over memory.lifecycle state (issue #12).",
  },
  {
    id: "studio.workflowPlaybooks",
    owner: "studio",
    status: "scaffolded",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Reusable execution playbooks (issue #14). Seeds: workflows/*.js + dashboard Run ▸.",
  },
  {
    id: "studio.mlxEmbeddings",
    owner: "studio",
    status: "planned",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Apple-silicon MLX-accelerated local embeddings. Optional, never required.",
  },
  {
    id: "studio.swiftuiNativeApp",
    owner: "studio",
    status: "scaffolded",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Native macOS Studio client consuming AG-UI events.",
  },
  {
    id: "studio.aguiEvents",
    owner: "studio",
    status: "planned",
    defaultEnabled: false,
    requiresApproval: false,
    description: "Standard event protocol between Studio backend and UI clients.",
  },
];
