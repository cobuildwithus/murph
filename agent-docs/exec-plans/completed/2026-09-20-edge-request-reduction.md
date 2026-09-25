# Remove successful warm-wake log callbacks

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Goal

Remove the standalone log callback after a successful warm wake while retaining
fresh-start evidence, retries, thrown failures, and independent recovery events.
This is the telemetry PR in the separately owned edge-request reduction work.

## Scope and approach

The existing Postgres ensure-processing route constructs and uploads a summary
for every outcome. Gate construction and scheduling on the final accepted/woken
result. Keep the existing detached log owner for all other outcomes. No new
transport, cache, queue, schema, state owner, or dependency is needed.

## Risks and proof

Device cycling diagnostics consume accepted/started summaries, which remain.
A positive intermediate wake header does not suppress a final retry or failure.
Tests prove zero callback and zero scheduled telemetry for a warm wake, retained
nonblocking summaries for other outcomes, and owned telemetry rejections.

## Tasks

- [x] Obtain and inspect the bounded ReviewGPT implementation patch.
- [x] Apply the patch and verify the retained route and recovery boundaries.
- [x] Run focused tests, typecheck, complexity, docs, and privacy checks.
- [x] Update the diagnostic owner and prepare the scoped draft PR.

## Verification

- 42 tests passed across runtime-processing-summary, runtime-processing-postgres,
  and runtime-processing-responses. Eight summary scenarios cover the omission,
  accepted actions, retries, and thrown failures at three processing stages.
- Cloudflare typecheck passed after normal workspace dependency build and Prisma
  client generation in this isolated checkout.
- Complexity diff passed: no debt and maximum complexity remains 12.
- Docs drift and diff whitespace checks passed; authored content uses synthetic
  evidence. No new repository-actionable Frog issue was reproduced.
- Existing device cycling query selects accepted/started, and the independent
  accepted-attempt failure recovery event is unchanged.

## Completion boundary

The parent owns final ReviewGPT, exact-head CI, and mergeability checks for this
and the independent implementation PRs. These external gates remain pending
when preparing the candidate. This change does not authorize merge or deploy.
Completed: 2026-09-20
