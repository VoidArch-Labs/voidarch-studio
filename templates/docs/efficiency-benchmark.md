# Efficiency Benchmark

Benchmark before claiming improvement. The architecture is a hypothesis until measured.

Run each task twice: **baseline** (plain Claude Code, no plugin) vs **dev-flow-control**. Use the
same repo, model, and effort.

### Where the numbers come from

- **Tool calls, files touched, graph usage, approvals, subagent counts** → the session log
  `.agent-runs/sessions/<id>/tools.jsonl` and the `observability-report` skill.
- **Token and cache metrics** → **NOT** the hook log. Hooks cannot see token accounting. Pull these
  from **Claude Code telemetry (OpenTelemetry)** or the **Session Report** skill. Do not infer token
  counts from `tools.jsonl`.

## Task A — repo investigation

Measure: main-session input tokens · files read · repo-graph used (y/n) · tool calls · subagent
calls · correction turns · accuracy of located files.

## Task B — small implementation

Measure: files read · files changed · tests run · unrelated edits · review defects · correction
turns.

## Task C — docs/API-sensitive change

Measure: Context7 calls · stale-API mistakes · docs relevance · tests run · correction turns.

## Success indicators

The plugin should produce:

- fewer main-session input tokens
- fewer broad file reads
- fewer tool calls
- fewer correction turns
- same or better test pass rate
- fewer unrelated edits
- better PR-review defect catch rate
- less raw Git/log/context dumping
- measurable graph/index benefit (graph runs correlate with fewer reads + higher file-location accuracy)

## Method notes

- Hold everything constant except the plugin. Repeat each task ≥3 times; report medians (model
  output varies run to run).
- For the graph benefit specifically, compare Task A with `graphify` available vs forced fallback
  (`touch .agent-runs/graph-scanned` to silence the nudge in the fallback arm, or unset graphify).
- Record raw numbers; do not eyeball. "It feels faster" is not a measurement.
- If an indicator regresses, treat it as a finding, not noise — tune the routing or the thresholds.
