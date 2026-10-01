# Journal and Personal Patterns presentation

## Goal

Make real Journal and Personal Patterns data concise, grouped, and useful
without adding a new service or model API path.

## Product UX

- Dense device history keeps short timeline rows and opens details on demand.
- Missing provider values stay hidden instead of appearing as zero or unknown.
- Provider naming variants become one stable member-facing concept.
- Existing members gain the improved view from their current history.
- Missing or invalid presentation metadata falls back to current deterministic
  data, so Journal and Patterns still load.

## Constraints

- Keep health facts, dates, metrics, comparisons, grades, and effect sizes
  deterministic in `@murphai/query`.
- Reuse the existing Personal Patterns Luna automation and private Knowledge
  storage. Do not add a model API call, service, dependency, or database table.
- Store only bounded display labels, aliases, and closed icon categories.
- Do not commit member exports, screenshots, transcripts, or distinctive data.
- Test the sanitized export only in an isolated local vault.
- Do not deploy or roll back Cloudflare manually.

## Tasks

- [x] Fix Journal summaries, hidden generated-image rows, and combined exercise
  details in the deterministic projection.
- [x] Add a bounded private vocabulary page that the existing Luna automation
  maintains and the deterministic query layer validates.
- [x] Apply vocabulary aliases before Personal Patterns aggregation and use its
  display label and icon category in the view.
- [x] Add outcome sorting and clear deterministic no-result explanations.
- [x] Add focused deterministic tests and a real-Codex Luna journey.
- [x] Replay dense, sparse, incomplete, and provider-variant journeys on mobile
  and desktop, including the isolated sanitized export.
- [x] Keep long test results and capture notes in details, give generated
  capture titles concise labels, and require Luna to replace clear health
  abbreviations with plain member-facing labels.
- [x] Preserve one independent comparison case when same-day aliases merge,
  keep derived detail factors outside the sparse vocabulary, and retain meal
  ingredients in concise rows and expanded details.
- [ ] Complete required review, PR, CI, and merge workflow.

Status: active
Updated: 2026-09-03
