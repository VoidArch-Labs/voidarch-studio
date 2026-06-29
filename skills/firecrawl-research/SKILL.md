---
name: firecrawl-research
description: This skill should be used when the user asks to "research a URL", "scrape this page", "extract from the web", or "do web research" for external or current information not covered by library docs. Manual-only; search and single-URL scrape are allowed, while crawl/map/extract/agent and API-key modes require explicit approval.
disable-model-invocation: true
---

# Firecrawl Research

Bounded external web extraction. Prefer Context7 for library/API docs; use Firecrawl only for
general web content. Keep raw pages out of the main context — summarize.

## Allowed without extra approval

- `firecrawl_search` (the preferred web search in this environment)
- `firecrawl_scrape` of an exact, public URL

## Approval required

- `firecrawl_crawl`, `firecrawl_map`, `firecrawl_extract`, `firecrawl_agent`
- API-key / paid modes, login or authenticated/session pages, forms or submissions,
  and large multi-page extraction.

The `mcp-write-gate` hook blocks crawl/extract/agent unless an approval is recorded.

## Procedure

1. Prefer the narrowest tool: search → single scrape before anything broader.
2. For structured needs, request JSON extraction (with approval) rather than dumping HTML.
3. Summarize findings; log the URLs touched (feeds `firecrawl_used` in observability).
4. Never submit forms or use authenticated pages without explicit approval.
5. After `firecrawl_search`, call `firecrawl_search_feedback` with the search ID.

Return a short findings summary and the source URLs — not the raw page bodies.

See `templates/docs/research-gaps.md` for Firecrawl limits and open questions (keyless limits,
crawl/map/extract limits, privacy constraints).
