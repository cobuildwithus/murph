# Simplify hosted execution staged payload handoff to one opaque staged ref

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Simplify hosted execution delivery so private dispatch bodies are staged once in Cloudflare, referenced opaquely end to end, and never duplicated during web-to-Cloudflare handoff.

## Success criteria

- Reference-backed hosted execution events are staged once and the same opaque staged ref is reused by the web outbox and Cloudflare pending queue.
- Shared hosted-execution contracts stop exposing storage-path-shaped `payloadRef.key` as the public concept and instead use an opaque staged payload id/ref.
- `apps/web` continues to keep private dispatch bodies out of Postgres while still owning transactional enqueue and delivery status.
- `apps/cloudflare` continues to own the private payload body, queue retries, and pending dispatch hydration without writing a second transient payload blob for the same event.
- Focused hosted-web, shared-package, and Cloudflare verification covers the staged-ref handoff and queue replay path.

## Scope

- In scope:
- `packages/hosted-execution/**`
- `packages/cloudflare-hosted-control/**`
- `apps/web/src/lib/hosted-execution/**`
- `apps/web/src/lib/hosted-onboarding/webhook-dispatch-payload.ts`
- `apps/cloudflare/src/**`
- focused hosted-web and Cloudflare tests/docs touched by this seam
- Out of scope:
- broad redesign of which event kinds are inline vs staged beyond the existing tiny-safe exceptions
- removing `payloadJson` from the Postgres schema in this landing
- changing webhook receipt ownership or broader hosted onboarding storage beyond the staged-ref seam

## Constraints

- Technical constraints:
- Preserve the current privacy posture: full private dispatch bodies must not live durably in Postgres.
- Preserve current event idempotency and Cloudflare queue replay behavior while simplifying the handoff shape.
- Treat existing dirty hosted webhook receipt and memory-search worktree edits as unrelated; do not overwrite them.
- Product/process constraints:
- This is a high-risk hosted queue/persistence/trust-boundary change, so direct scenario-oriented proof is required in addition to scripted tests.

## Risks and mitigations

1. Risk: ref-shape changes break shared parsing between web and Cloudflare.
   Mitigation: land the shared contract seam first and update focused parity/unit tests in the same change.

2. Risk: Cloudflare queue adoption of staged refs could strand old transient payload cleanup paths.
   Mitigation: update queue cleanup paths and direct tests for pending payload deletion/replay behavior.

3. Risk: simplifying the handoff accidentally weakens privacy by reintroducing inline private bodies.
   Mitigation: preserve the current inline/reference event policy and keep privacy assertions in hosted-web tests.

## Tasks

1. Update the shared hosted-execution staged-ref contract to use one opaque staged payload ref/id shape.
2. Simplify `apps/web` outbox enqueue/dispatch paths to use that staged ref without treating storage keys as business identity.
3. Simplify `apps/cloudflare` stored-dispatch and Durable Object queue paths so they adopt the staged ref directly instead of restaging the full dispatch body.
4. Update focused tests and docs for the single-staged-ref handoff model.
5. Run required verification, collect one direct scenario-oriented proof, then complete audit passes and commit.

## Decisions

- Keep the existing inline-only event set (`assistant.cron.tick`, `vault.share.accepted`) and simplify only the reference-backed path in this landing.
- Do not redesign the Postgres `execution_outbox` table shape yet; first remove the extra Cloudflare restaging layer and make the staged ref opaque.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir packages/hosted-execution test -- outbox-payload.test.ts member-activated-outbox-payload.test.ts`
- `pnpm --dir apps/cloudflare test -- dispatch-payload-store.test.ts runner-queue-store.test.ts user-runner.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-outbox*.test.ts apps/web/test/hosted-onboarding/webhook-receipt-privacy.test.ts --no-coverage`
- Expected outcomes:
- Shared/web/cloudflare staged-ref tests pass and demonstrate one staged payload ref reused across handoff and queue replay.
Completed: 2026-04-07
