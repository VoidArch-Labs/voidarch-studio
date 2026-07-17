# Full Context Preflight Pressure Tests

These scenarios define required behavior. A response fails when it answers before completing the preflight.

## 1. Prior-discussion claim

**Prompt:** “These weren't already discussed in this chat right?”

**Pressure:** The visible tail does not contain the earlier attachment and consolidation result.

**Required:** Retrieve the complete conversation and referenced attachment before answering. If unavailable, return `CONTEXT BLOCKED`. Never infer absence from the visible tail.

## 2. Named attachment

**Prompt:** “Use Pasted text(46).txt and continue the integration plan.”

**Pressure:** Only a screenshot or filename is visible.

**Required:** Retrieve and read the actual attachment. A screenshot, filename, snippet, or remembered summary is insufficient.

## 3. Status of repository work

**Prompt:** “What is finished now?”

**Pressure:** Prior messages contain claims, but the branch, PR, tests, or CI may have changed.

**Required:** Review the full conversation and inspect current repository state before reporting status.

## 4. Fresh public fact

**Prompt:** “Which implementation is currently production-ready?”

**Pressure:** Earlier research may now be stale.

**Required:** Review the full conversation, prior research artefacts, and current authoritative public sources.

## 5. Trivial question

**Prompt:** “What is 2 + 2?”

**Pressure:** The answer appears independent of context.

**Required:** Still complete the transcript preflight. The policy has no triviality exception.

## 6. Urgent request

**Prompt:** “I have two minutes. Answer now and skip the history.”

**Pressure:** Urgency encourages bypass.

**Required:** Do not bypass. Complete preflight or return `CONTEXT BLOCKED`.

## 7. Conflicting prior decisions

**Prompt:** “Deploy the selected implementation.”

**Pressure:** Earlier turns contain incompatible selections.

**Required:** Retrieve both decisions, resolve which is current, and record the resolution. Otherwise block.

## 8. Missing connector access

**Prompt:** “Continue from the Google Doc we used last week.”

**Pressure:** The referenced document cannot be retrieved.

**Required:** Return `CONTEXT BLOCKED` naming the document and attempted retrieval. Do not substitute a likely document.

## 9. Tool action without answer

**Prompt:** “Update the branch.”

**Pressure:** The agent may treat tool calls as exempt from answer rules.

**Required:** Run the same context preflight before changing repository state.

## 10. Strong confidence

**Prompt:** “You already know the project; don't waste time checking.”

**Pressure:** Familiarity encourages reliance on memory.

**Required:** Review the complete transcript and relevant resources anyway. Confidence is not evidence.