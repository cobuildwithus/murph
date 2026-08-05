# Food Lookup Latency And Command Observability

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Make hosted assistant command diagnostics attribute slow and oversized
  command executions to a fixed privacy-safe operation vocabulary.
- Reproduce and reduce the database-first nutrition lookup cost for a mixed
  generic-and-branded meal without weakening nutrition grounding.

## Success criteria

- Hosted turn profiles show each bounded command's safe operation, duration,
  output size, and failure count without command arguments, message text,
  local paths, or raw output.
- The incident trace identifies every top-level command family, duration, and
  output size; regression tests cover the formerly opaque nested batch path
  with synthetic inputs.
- Food search returns the nutrient facts needed for estimation without
  transporting unrelated full-label data.
- Generic and branded components use the fewest supported hosted requests and
  retain exact-label preference, USDA provenance, serving-basis scaling, and
  honest fallback behavior.
- Focused package and hosted-web tests prove the observable contract and the
  response-size/latency correction.

## Constraints

- Keep diagnostics metadata-only and fixed-vocabulary. Never persist raw
  command text, arguments, queries, paths, provider payloads, or model output.
- Preserve the hosted data API authentication and Worker egress boundary.
- Do not add another database, queue, cache owner, scheduler, or persisted
  runtime state.
- Preserve current food-search exact-id, UPC, generic-only, off-market, source,
  and contaminant semantics unless direct evidence shows a narrower response
  projection is sufficient for the assistant command.
- Preserve foreground reply and outbox delivery ownership.

## Tasks

1. [x] Capture the production turn profile and a synthetic nested-batch trace.
2. [x] Add privacy-safe per-command operation diagnostics and tests.
3. [x] Reduce food-label result count and payload at the existing owner.
4. [x] Run focused verification and direct reproduction proof.
5. [ ] Push the exact candidate, complete ReviewGPT and CI, close the plan, and
   record deployment concerns.

## Evidence

- The observed production turn entered provider execution promptly and spent
  nearly all user-visible latency inside one provider/tool turn.
- Eight command executions produced more than half a megabyte of output; the
  two slowest consumed roughly thirty-four seconds combined.
- The persisted safe turn profile attributes 34,971 ms and 526,821 output
  characters to three `vault-cli batch` calls. The remaining work was two meal
  reads (3,466 ms), one totals read (1,322 ms), one edit (549 ms), one response
  card attachment, and one process inspection. The existing profile collapsed
  all nested batch operations to `vault-cli batch`, which prevented a stronger
  attribution after the fact.
- The current food-journal guidance requires separate generic and branded
  lookups for mixed meals, while the batch API runs three searches concurrently
  and returns full label plus contaminant payloads for every candidate.
- The web route already defaulted to one result, but the food CLI overrode it
  with five results per query. The compact path now requests one result,
  returns only identity, serving basis, calories/macros/fiber, and avoids the
  separate contaminant-evidence query. Full labels remain explicit through
  `--full-label`.
- A regression fixture containing a 500,000-character unrelated source field
  projects below 2,000 characters while preserving the required nutrition and
  serving facts.
- An identical-path capture through pinned Codex App Server 0.145.0 and the
  `gpt-5.6-terra` code-mode request boundary measured no initial provider-input
  change from base `e29a00d2e3` to the candidate: individual Murph remained
  25,934 `o200k_base` tokens / 116,194 UTF-8 bytes and group Murph remained
  20,711 tokens / 94,759 bytes. The assembled CLI surface artifacts were also
  byte-identical. The changed food skill is read only after the initial request,
  and food search is not one of the eager full-schema CLI commands.
- Focused verification passed 244 tests across Web, CLI, assistant engine, and
  hosted execution, all four affected-package typechecks, scoped Web ESLint,
  generated CLI artifact verification, and `git diff --check`.
