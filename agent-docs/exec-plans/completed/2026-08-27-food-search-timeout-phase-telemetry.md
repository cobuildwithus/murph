# Food search timeout phase telemetry

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Extend the existing privacy-safe `foods_api_failed` production error so a
  later bounded query can determine whether a food-search statement timeout
  occurred during primary result selection or contaminant-summary attachment.

## Success criteria

- A database failure in the search path carries one fixed, low-cardinality
  phase value through the existing error log pipeline.
- The original PostgreSQL error code remains available for classification.
- The change performs no extra query, retry, write, network call, control-flow
  change, canonical-state change, or user-visible behavior change.
- No query text, product value, identifier, row, message, health value,
  credential, raw error text, stack, or private scenario is logged.
- Focused tests prove both phase classifications and the privacy exclusions;
  affected typechecks, ReviewGPT gates, and exact-head CI pass.

## Scope

- In scope: the existing product-label query owner, the existing safe food API
  error formatter, focused tests, and the durable Web observability contract.
- Out of scope: changing search SQL, indexes, statement timeouts, database
  configuration, retries, fallback results, device sync, or any production
  provider or database state.

## Investigation question

- Two post-fix production `/api/foods` searches ended after roughly eight
  seconds with PostgreSQL cancellation code `57014`. The route-level event
  identifies only `operation=search`.
- Competing hypothesis A: the primary bounded food-search statement timed out.
- Competing hypothesis B: primary search completed and the contaminant-summary
  attachment statement timed out.
- Existing telemetry cannot distinguish these phases, and direct read-only
  access to the production labels database is unavailable because the
  configured sensitive variable is not injected by the local environment
  runner. That access friction is already tracked in Frog issue #2337.

## Constraints

- ReviewGPT exclusively owns production-code implementation and remediation.
- Reuse the existing logger and error event; add no telemetry backend, table,
  queue, scheduler, state owner, persistence, or higher-volume success event.
- Emit only a fixed typed stage on the existing failure path. Preserve the
  original error as the cause so the safe formatter can retain code `57014`.
- Keep the patch telemetry-only: tests and required observability documentation
  may accompany it, but no functional search correction may be included.
- Deployment is Web-only and additive. No Cloudflare change or tandem deploy is
  required; older and newer readers tolerate the optional field.

## Risks and mitigations

1. Risk: stage annotation changes exception or response behavior.
   Mitigation: annotate and rethrow only at the existing query boundary,
   preserving cause and the route's existing status/body behavior.
2. Risk: telemetry leaks a private search or product fact.
   Mitigation: use a closed stage union and test that inputs, rows, error text,
   stacks, and identifiers never enter the structured payload.
3. Risk: a wrapper obscures PostgreSQL classification or adds architecture.
   Mitigation: use the narrowest existing owner boundary and preserve the
   original error cause; reject any generalized observability abstraction.
4. Risk: more telemetry is stacked before prior evidence is evaluated.
   Mitigation: deduplication found no food-boundary telemetry PR, task, issue,
   or deployment awaiting evidence; the unrelated Stripe telemetry remains on
   its separate owner boundary.

## Tasks

1. Obtain the smallest ReviewGPT-authored telemetry, test, and documentation
   patch from a privacy-safe implementation packet.
2. Inspect the returned patch for question agreement, privacy, security,
   cardinality, cost, database load, runtime overhead, behavior preservation,
   device-lane overlap, deployment compatibility, and ownership conflicts.
3. Apply only an accepted patch, then run focused tests, affected typechecks,
   privacy scans, and direct payload proof.
4. Publish a draft PR, start the coverage specialist and final ReviewGPT gate
   concurrently with CI on the exact pushed head, and resolve every finding.
5. If every telemetry-only autonomous-deployment gate remains satisfied, merge
   through the approved path, verify the deployed revision read-only, and
   preserve the later natural-traffic query.

## Verification

- Focused food-route and product-label query tests must prove both failure
  stages, original database-code preservation, unchanged response behavior,
  and absence of private or high-cardinality fields.
- Run the affected Web typecheck and the narrowest relevant lint/test commands,
  plus `git diff --check` and a manual privacy/cardinality review.
- Run preliminary `completion-specialists` with the coverage lens and the final
  cross-cutting `pr-review` gate on the exact candidate head; require all GitHub
  checks to pass before any merge decision.
- After deployment, use a bounded Vercel query for `foods_api_failed` from the
  deployment-ready time and aggregate only operation, database error code, and
  the new fixed stage. Do not generate synthetic production traffic.

## Progress

- Production evidence and recent-change analysis proved two current-window
  post-fix food-search statement timeouts; all other available route fields are
  privacy-safe but insufficient to distinguish the two query phases.
- GitHub and Codex-task deduplication found no active food-search owner and no
  telemetry already deployed or in flight on this boundary.
- The isolated worktree starts at current `origin/main` on
  `codex/food-search-timeout-phase-telemetry`.
- ReviewGPT returned an exact four-file telemetry patch from the privacy-safe
  implementation packet. Parent inspection accepted it without modification:
  it adds no work or success event, preserves the original database error as
  the safe formatter input, and leaves the schema-missing path unchanged.
- Focused local proof passed: the food library and route suites passed 61 tests,
  changed executable files passed ESLint, Web typecheck passed, and
  `git diff --check` is clean.
- Preliminary ReviewGPT found three coverage gaps, all accepted: exact-ID and
  bare-GTIN `q` dispatch bypassed attribution; the privacy assertion was not an
  exact payload check; and schema-missing passthrough lacked composed proof.
  Product UX, prompt, and frontend lenses were not applicable. Its test-only
  artifact was inspected but left unapplied because the complete remediation
  needed production-code ownership.
- ReviewGPT returned one self-contained remediation patch on the original
  implementation thread. It extends the same closed stage boundary to private
  food ID/UPC lookup, replaces the payload assertion with an exact one, and adds
  composed `42P01` passthrough proof. The patch was applied unchanged after
  parent inspection.
- Corrected-head proof passed: 66 focused tests, changed executable-file ESLint,
  Web typecheck, and `git diff --check`.
- Final ReviewGPT round one on the immutable first candidate returned
  `ROUND_OUTCOME: PASS` with no finding. Because preliminary remediation changes
  executable behavior, the corrected head still requires final round two.
- Final ReviewGPT round two audited the corrected sensitive full snapshot and
  returned `ROUND_OUTCOME: PASS` with no finding. Exact-turn capture, elapsed
  time, compatible response-model metadata, and the completion marker satisfy
  the repository's documented `UNKNOWN` prose-confirmation fallback.
- Required GitHub Actions on the corrected code head are green, including Web
  verification, release build/typecheck, package coverage, privacy/build
  artifact checks, and Temporal compatibility. The Vercel preview was still
  converging when the final plan-close commit was prepared.
- Parent final review re-read the full base-to-head diff and changed call paths,
  verified the closed values and original-cause unwrapping, confirmed no
  success-path work or non-food behavior change, and found no remaining proof,
  privacy, architecture, or handoff gap.
Completed: 2026-08-27
