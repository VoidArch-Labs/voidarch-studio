export const meta = {
  name: 'dfc-review',
  description: 'Review the current diff across bug/security/silent-failure dimensions, adversarially verify each finding',
  whenToUse: 'Before shipping a branch: multi-dimension review of uncommitted + branch changes with verified findings only.',
  phases: [
    { title: 'Review', detail: 'one reviewer per dimension' },
    { title: 'Verify', detail: 'adversarial check per finding' },
  ],
}

const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'title', 'detail', 'severity'],
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          title: { type: 'string' },
          detail: { type: 'string' },
          severity: { enum: ['critical', 'high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['isReal', 'reason'],
  properties: { isReal: { type: 'boolean' }, reason: { type: 'string' } },
}

const DIMENSIONS = [
  { key: 'bugs', prompt: 'logic errors, wrong conditions, off-by-one, broken control flow, type misuse' },
  { key: 'security', prompt: 'injection, secrets in code/logs, path traversal, missing auth/permission checks, unsafe shell' },
  { key: 'silent-failures', prompt: 'swallowed errors, empty catch, bad fallbacks, missing error propagation, misleading success reporting' },
]

const results = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(
      `You are reviewing the current git diff of this repository (run: git diff HEAD; also git log --oneline -5 origin/HEAD..HEAD 2>/dev/null and diff those commits if the working tree is clean). ` +
        `Report ONLY ${d.key}: ${d.prompt}. Only findings introduced by these changes, not pre-existing code. ` +
        `Read surrounding code before reporting. No style nits.`,
      { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS },
    ),
  (review, d) =>
    parallel(
      (review?.findings ?? []).map((f) => () =>
        agent(
          `Adversarially verify this ${d.key} finding — try to REFUTE it by reading the actual code at ${f.file}:${f.line} and its callers. ` +
            `Finding: ${f.title} — ${f.detail}. Default isReal=false if uncertain or pre-existing.`,
          { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT },
        ).then((v) => ({ ...f, dimension: d.key, verdict: v })),
      ),
    ),
)

const confirmed = results
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict?.isReal)
const order = { critical: 0, high: 1, medium: 2, low: 3 }
confirmed.sort((a, b) => order[a.severity] - order[b.severity])
log(`${confirmed.length} confirmed finding(s)`)
return { confirmed }
