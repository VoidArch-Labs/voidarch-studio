export const meta = {
  name: 'dfc-preship',
  description: 'Ship-readiness gate: run deterministic checks and independent release/security verdicts on the current branch',
  whenToUse: 'Right before merging/PR: verification evidence + release-checker style verdicts in one pass.',
  phases: [
    { title: 'Checks', detail: 'tests/lint/typecheck/build as available' },
    { title: 'Verdicts', detail: 'release + security reviewers' },
  ],
}

const VERDICT = {
  type: 'object',
  required: ['ready', 'blockers', 'notes'],
  properties: {
    ready: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

phase('Checks')
const checks = await agent(
  'Detect and run this repository\'s deterministic checks (whatever exists: package.json scripts test/lint/typecheck/build, Makefile, cargo check, pytest…). Run each, capture pass/fail with the key error lines. Do NOT fix anything. Return a compact pass/fail table as text.',
  { label: 'deterministic-checks' },
)

const [release, security] = await parallel([
  () =>
    agent(
      `Release-readiness verdict for the current branch. Evidence from deterministic checks:\n${checks}\n\nAlso inspect: uncommitted files (git status), TODO/FIXME introduced by the diff, docs drift for changed behavior. Blockers = anything that must be fixed before ship.`,
      { label: 'release-checker', phase: 'Verdicts', schema: VERDICT },
    ),
  () =>
    agent(
      'Security verdict for the current branch diff (git diff origin/HEAD...HEAD or HEAD): secrets, injection, path traversal, permission gaps, unsafe shell, dependency changes. Blockers = exploitable issues only; notes = hardening suggestions.',
      { label: 'security-reviewer', phase: 'Verdicts', schema: VERDICT },
    ),
])

const ready = Boolean(release?.ready && security?.ready)
log(ready ? 'SHIP: ready' : 'SHIP: blocked')
return { ready, checks, release, security }
