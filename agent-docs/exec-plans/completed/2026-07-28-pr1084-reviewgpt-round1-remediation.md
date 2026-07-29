# PR 1084 ReviewGPT round-one remediation

Status: completed
Created: 2026-07-28
Updated: 2026-07-29

## Goal

Resolve the four confirmed final ReviewGPT round-one findings without adding a
new migration owner, preserve the live OC-to-ENAM cutover outcome, and take the
exact correction head through required verification, CI, and ReviewGPT round
two.

## Confirmed mechanisms

1. Snapshot abort, validation-failure, orphan, and replaced-reference cleanup
   select one fixed-role bucket even after the create-only copier may have put
   the unique snapshot key in both buckets.
2. Browser-vault refresh preserves the logical `dataVersion` while changing
   `generatedAt` and encrypted bytes, but the R2 key currently derives from
   `dataVersion` alone.
3. The online copier and runbook recognize email and meal-photo lifecycle
   prefixes but omit the canonical private-media lifecycle prefix.
4. Name equality and distinctness checks cannot prove that the rendered source
   binding is physically OC and the destination binding is physically ENAM.

## Decisions

- Keep direct PUT, HEAD, GET, and completion verification bucket-affine, but
  send destructive unique-snapshot cleanup through both fixed-role stores while
  the bridge coexists. Hosted-local uses both role-specific S3 control paths.
- Preserve browser-vault logical `dataVersion` semantics. Derive the immutable
  object key from `dataVersion` plus `generatedAt`, so an age-only refresh
  creates a new object identity instead of overwriting randomized ciphertext.
- Classify private media as lifecycle-managed and excluded from copying, and
  require its 24-hour capability/lifecycle drain before OC retirement.
- Reuse one bucket-info parser, fixed-role location assertion, and child command
  runner. The existing async deploy preflight reads all four configured bucket
  metadata records through Wrangler before rendering.
- Add no dual writes, queue, journal, tombstone, migration Durable Object,
  reconciliation loop, or persistent migration state.

## Tasks

1. Add production-faithful regressions for dual-bucket snapshot cleanup,
   browser-vault age refresh identity, private-media lifecycle classification,
   and transposed production/preview bucket metadata.
2. Implement the four minimal corrections and update the live cutover runbook.
3. Run touched-package typechecks and focused tests, full Cloudflare parallel
   verification, canonical diff-aware verification, and acceptance verification
   according to the runtime guide.
4. Close this plan through `scripts/finish-task`, push the exact correction
   head, update the PR intent/evidence and retrospective, and run CI with final
   ReviewGPT correction round two.
5. Triage any correction-round finding by mechanism and finish only after a
   valid `PASS` and green exact-head CI.

## Constraints

- Do not access, mutate, deploy, or delete production data while remediating.
- Preserve first-reviewed head
  `37d7fe603e8a142c4d201755d5dcbe646bfb45db`.
- Keep the already-recorded anomaly-retrospective continuation decision.
- Preserve unrelated work and do not broaden the PR beyond the four confirmed
  mechanisms.

## Verification

- Focused Cloudflare snapshot, browser-vault, online-copy, deploy-preflight, and
  deployment-automation tests.
- Query browser-replica identity tests.
- Cloudflare, hosted-execution, and affected package typechecks.
- `pnpm --dir apps/cloudflare verify:parallel`.
- Canonical `pnpm test:diff ...` and `pnpm verify:acceptance`, with only
  documented unrelated failures eligible for scoped fallback.
- Exact-head PR CI plus final ReviewGPT correction round two.
Completed: 2026-07-29
