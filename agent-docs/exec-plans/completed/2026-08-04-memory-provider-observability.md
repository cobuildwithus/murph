# Memory Provider Observability

## Goal

Make hosted Codex memory-model traffic reconstructable from Murph's existing
redacted runtime-log database, especially when Venice is selected, without
persisting prompts, responses, vault content, credentials, or raw Codex
session/thread/turn identifiers.

## Constraints

- Reuse `runner.provider_egress_diagnostic` and the existing signed runtime-log
  callback; do not add a database, queue, or second observability owner.
- Keep provider egress and assistant execution fail-open with respect to
  diagnostic capture.
- Record only bounded request shape, allowlisted provider/model metadata,
  response status/timing, and keyed identifier fingerprints.
- Preserve OpenAI diagnostic behavior and unrelated work.

## Plan

1. Generalize the existing Responses request diagnostic so Venice can use the
   same bounded request-shape and cache-prefix evidence as OpenAI.
2. Add Venice request routing and response-header metadata, including canonical
   and upstream model kinds, HTTP outcome, elapsed time, retry count, and a
   validated provider correlation id.
3. Add HMAC-only Codex session/thread/turn/window correlation fields when the
   hosted log fingerprint secret is configured.
4. Add focused Cloudflare tests for memory classification, repeated-turn
   correlation, provider routing, response metadata, and redaction.
5. Update the hosted runtime-log contract docs, run focused tests and
   typecheck, review the diff, then complete the PR verification workflow.

## Verification

- `pnpm --dir apps/cloudflare test:node apps/cloudflare/test/runner-egress-intercept.test.ts`
  passed (219 tests).
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm logs:guard` passed.
- `bash scripts/workspace-verify.sh test:diff ...` passed, including 2,190
  Cloudflare node tests and 3 Worker tests.
- `git diff --check` and the scoped identifier/privacy review passed.
- Exact-head CI and the required ReviewGPT gates remain part of the PR
  completion workflow after this plan is archived and committed.
Status: completed
Updated: 2026-08-04
Completed: 2026-08-04
