# Linq Remediations Plan

## Goal

Validate the five reported Linq local/hosted issues against the live tree and land only the confirmed, behavior-preserving fixes with focused regression coverage.

## Scope

- `packages/inboxd`: local Linq webhook verification, connector startup/watch behavior, normalization, and direct regression tests.
- `packages/cli`: Linq connector/runtime boundary typing and doctor/runtime wiring needed to keep the local contract honest.
- `apps/web`: hosted Linq webhook validation, control-plane binding lookups, Linq HTTP/signal plumbing, and targeted hosted regression tests if the issue is confirmed safe to fix in this lane.

## Constraints

- Work only inside the current Linq remediation lane on top of the dirty tree.
- Keep behavior-preserving scope; do not widen into a generic webhook or transport framework.
- Do not silently tighten the sparse hosted routing boundary unless the current behavior is first characterized and the change is explicitly safe.
- Preserve existing hosted error codes/messages where tests already assert them.
- Do not delete duplicate hosted binding rows unless webhook-history preservation is explicitly handled.

## Verification

- `pnpm exec vitest run --config packages/inboxd/vitest.config.ts packages/inboxd/test/linq-webhook.test.ts packages/inboxd/test/linq-connector.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run packages/cli/test/inbox-service-boundaries.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/prisma-store-linq-binding.test.ts apps/web/test/linq-control-plane.test.ts apps/web/test/hosted-onboarding-linq-webhook-auth.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/inboxd typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Completed the original fail-open webhook, binding ownership/canonicalization, hosted ingress validation, reply anchoring, local webhook verification, and hosted state-drift fixes.
- Follow-up review findings also closed in this lane:
  - local inboxd webhook acknowledgement no longer waits on remote attachment latency beyond a zero-budget best-effort race
  - hosted control-plane now maps malformed signed `message.received` payloads onto `LINQ_PAYLOAD_INVALID` using canonical inboxd validation
- Focused verification completed:
  - inboxd Linq tests passed
  - hosted web Linq tests passed
  - `packages/inboxd` typecheck passed
- Repo-wide verification remains required before handoff; existing unrelated red lanes are expected in `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` based on earlier runs.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
