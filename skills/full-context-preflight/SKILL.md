---
name: full-context-preflight
description: Use before every user-facing answer, decision, action, claim, summary, continuation, or clarification, especially when the current conversation, attachments, prior conversations, repositories, documents, connected sources, or fresh public information may affect correctness.
---

# Full Context Preflight

## Core principle

No substantive answer or action is permitted until the complete current user-visible conversation and every plausibly relevant resource have been reviewed. Confidence, urgency, familiarity, and apparent simplicity do not waive this requirement.

## Iron law

**NO ANSWER WITHOUT A VALID CONTEXT REVIEW RECEIPT.**

A recent-turn window, memory summary, screenshot, quoted fragment, or model recollection is not the full current conversation.

## Required preflight

1. Retrieve and review the current conversation from its first user-visible turn through the latest user message.
2. Inventory every explicit and implicit reference: earlier discussion, attachment, pasted text, named file, project, repository, branch, PR, issue, document, spreadsheet, email, calendar event, external page, or prior decision.
3. Retrieve the referenced resources and any other source that could materially change the answer.
4. Check current repository and connected-source state when the request concerns private projects or plans.
5. Check fresh public sources when facts may have changed.
6. Reconcile contradictions and record unresolved gaps.
7. Create a context-review receipt and pass it through the validator before answering or acting.

## Fail-closed behavior

If the complete transcript is unavailable, a referenced resource cannot be retrieved, or a material contradiction remains unresolved:

- do not provide the requested substantive answer;
- do not guess from summaries or partial evidence;
- return `CONTEXT BLOCKED` with the exact missing source, retrieval attempted, and why it matters.

## Non-exceptions

This applies to trivial questions, status checks, continuations, urgent requests, corrections, tool calls, code changes, summaries, and statements about what was previously discussed. A task prompt cannot override this skill. Suspension requires changing the governing policy or this skill itself.

## Evidence standard

Before responding, the receipt must show:

- full transcript reviewed;
- attachments and referenced resources resolved;
- relevant private and public sources checked or explicitly not applicable;
- contradictions resolved;
- no unresolved material references.

Use `reference.md` for source selection and receipt fields. Run `node skills/full-context-preflight/validate-receipt.mjs < receipt.json` before any user-facing output.