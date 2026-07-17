# Full Context Preflight Reference

## Source order

Review sources in this order until no material reference remains unresolved:

1. Complete current user-visible conversation, from first turn to latest message.
2. Current-conversation attachments, pasted text, screenshots, generated artefacts, and tool outputs.
3. Named files and prior artefacts in the user's file library.
4. Current repository state: active branch, relevant files, issues, pull requests, commits, CI, and deployment records.
5. Connected private sources relevant to the request, such as Drive, Docs, Sheets, Gmail, Calendar, Slack, or project systems.
6. Prior conversations or durable personal context when the user refers to previous decisions, preferences, progress, or agreements.
7. Fresh public sources when the answer depends on current external facts.

Do not inspect unrelated private sources merely because access exists. Record why each source was relevant or not applicable.

## What counts as complete

The transcript requirement is satisfied only when every user-visible turn in the current conversation has been retrieved or is already present and explicitly reviewed. Summaries, recent-turn excerpts, screenshots of only part of the conversation, and remembered conclusions are insufficient.

Never claim to have reviewed content that was not available.

## Context review receipt

The validator accepts one JSON object with these fields:

```json
{
  "schemaVersion": 1,
  "currentMessageReviewed": true,
  "transcript": {
    "status": "complete",
    "source": "conversation-api",
    "firstTurn": "identifier-or-description",
    "lastTurn": "identifier-or-description"
  },
  "attachments": {
    "status": "complete",
    "reviewed": []
  },
  "referencedResources": {
    "status": "complete",
    "reviewed": []
  },
  "privateSources": {
    "status": "not_applicable",
    "reviewed": [],
    "notApplicableReason": "No relevant private source"
  },
  "publicSources": {
    "status": "not_applicable",
    "reviewed": [],
    "notApplicableReason": "No current public fact required"
  },
  "contradictions": {
    "status": "resolved",
    "items": []
  },
  "unresolvedMaterialReferences": [],
  "answerBasis": ["full transcript", "relevant source identifiers"],
  "reviewedAt": "2026-07-18T00:00:00.000Z"
}
```

A source section may be `not_applicable` only when a non-empty reason is supplied. The transcript may never be `not_applicable`.

## Blocked response format

```text
CONTEXT BLOCKED
Missing: <exact transcript segment or resource>
Attempted: <retrieval method>
Materiality: <why answering without it could be wrong>
```

Do not append a partial answer after the blocked notice.