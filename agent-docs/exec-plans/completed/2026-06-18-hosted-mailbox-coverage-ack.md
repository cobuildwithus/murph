# Hosted Mailbox Coverage Ack

## Goal

Fix hosted conversation mailbox consume acknowledgments so `consumed_seq` only
advances through the contiguous conversation rows actually covered by the
foreground pass, and only after the durable workspace checkpoint boundary.

## Scope

- Add a minimal ordered coverage fact to assistant-runtime mailbox import
  results.
- Compute conversation consume ack from that coverage instead of local
  watermark fallback or `assistantInputIds` alone.
- Use compacted existing pending-index state for hot-path wake/consume gates;
  keep full pending backfill out of those foreground paths.
- Defer the consume callback through the existing after-durable-checkpoint
  effect path.
- Add focused tests for completed pending input, replay/quarantine coverage,
  duplicate replay coverage, holes, entrypoint passthrough, abort behavior, and
  durable-checkpoint ordering.

## Out Of Scope

- Mixed-version fetch protocol markers. First rollout is a coordinated hard cut
  with no live users.
- Hosted mailbox retention tombstones or deleted-through ranges.
- New scheduler, queue, or broad compatibility layer.

## Verification

- Passed focused assistant-runtime Vitest coverage for mailbox import,
  pending-index wake behavior, workspace runner consume ack behavior, and
  entrypoint consume passthrough/abort behavior.
- Passed root `pnpm typecheck`.
- Passed scoped `pnpm test:diff` for assistant-runtime hosted-runtime changes,
  including assistant-runtime full tests and affected Cloudflare verify.
- Required completion audits ran: security/privacy found no medium-or-higher
  findings, coverage-write added skipped/imported ordered coverage proof, and
  deep-review findings were addressed.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
