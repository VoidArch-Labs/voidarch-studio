export const meta = {
  name: 'dfc-understand',
  description: 'Map the repository: parallel subsystem readers produce an architecture map plus memory-worthy facts',
  whenToUse: 'Onboarding a repo or returning after a long gap. Args: optional focus question string.',
  phases: [
    { title: 'Scout', detail: 'discover subsystems' },
    { title: 'Read', detail: 'one reader per subsystem' },
    { title: 'Synthesize', detail: 'merge into one map' },
  ],
}

const SUBSYSTEMS = {
  type: 'object',
  required: ['subsystems'],
  properties: {
    subsystems: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        required: ['name', 'paths'],
        properties: {
          name: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

phase('Scout')
const focus = typeof args === 'string' && args.trim() ? ` Focus on what is relevant to: ${args.trim()}.` : ''
const scout = await agent(
  `List the top-level subsystems of this repository (max 8) with their key paths. Use directory listing and README/manifest files only — no deep reads.${focus}`,
  { schema: SUBSYSTEMS },
)

const notes = await parallel(
  scout.subsystems.map((s) => () =>
    agent(
      `Read subsystem "${s.name}" (paths: ${s.paths.join(', ')}). Return: purpose, entry points, key data flows, external dependencies, sharp edges/gotchas.${focus} Be concrete with file paths.`,
      { label: `read:${s.name}`, phase: 'Read' },
    ),
  ),
)

phase('Synthesize')
const map = await agent(
  `Merge these subsystem notes into one architecture map: overview paragraph, per-subsystem bullets (purpose, entries, flows), cross-subsystem dependencies, then a short "worth remembering" list of durable facts an agent should persist to dev-memory (each one sentence, prefixed with the suggested command \`pnpm dfc:remember --kind decision|evidence --text "..."\`).\n\n${notes
    .filter(Boolean)
    .join('\n\n---\n\n')}`,
)
return map
