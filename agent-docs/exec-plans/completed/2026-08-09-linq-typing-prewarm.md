# Linq typing-start container prewarm

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Use an authenticated Linq typing-start webhook as a best-effort signal to
  begin warming the already-owned hosted user container before the member's
  eventual message is durably accepted, reducing avoidable cold-start latency
  without treating typing as work, turn authority, or a member-facing effect.

## Success criteria

- The exact supported Linq typing-start event shape is verified against current
  provider documentation, repository fixtures, and the authenticated webhook
  boundary.
- Eligible typing signals resolve only an already-authorized hosted private
  runtime and invoke the existing container/shell prewarm owner.
- Unknown, group, disabled, unauthenticated, duplicated, or failed signals stay
  best-effort: they create no durable conversational work, no assistant turn,
  no outbound message, and do not delay webhook acknowledgement.
- Focused tests prove admission, rejection, idempotent/coalesced lifecycle
  behavior, and failure isolation at the narrowest truthful boundaries.
- Required specialist and final ReviewGPT gates, exact-head CI, and parent final
  review complete with no unresolved accepted finding.

## Scope

- In scope: Linq webhook parsing/routing, existing hosted execution prewarm
  boundary reuse, focused Web/Cloudflare tests, and durable owner docs where
  the external signal or deploy contract changes.
- Out of scope: persisting typing activity, starting an assistant turn, changing
  message acceptance/delivery, adding a queue or scheduler, group-runtime
  speculation, or weakening hosted access and route authorization.

## Constraints

- Preserve the foreground reply critical path and existing accepted-message
  authority; typing is an optional latency hint only.
- Reuse the existing container lifecycle owner and its coalescing/failure
  semantics instead of adding a second warm-state owner.
- Authenticate the provider webhook before any prewarm attempt and minimize
  private data in logs, tests, ReviewGPT packets, and PR artifacts.
- Preserve unrelated edits in the primary checkout and all other worktrees.

## Risks and mitigations

1. Risk: a spoofed or stale signal spends hosted resources or crosses member
   boundaries.
   Mitigation: stay behind the existing webhook authentication and derive the
   target through the canonical Linq route/member owner; never accept a runtime
   id from provider payload text.
2. Risk: repeated typing events cause launch amplification.
   Mitigation: drop optional hints while the consent-mutation lock is occupied,
   then rely on the existing idempotent/coalesced lifecycle for the one admitted
   hint; add focused repeated-event proof instead of durable dedupe state.
3. Risk: waiting for prewarm makes webhook delivery less reliable.
   Mitigation: use the existing bounded best-effort latency-hint pattern and
   prove failures do not change webhook acknowledgement or message handling.
4. Risk: Web, Worker, and warm runner versions disagree during rollout.
   Mitigation: keep the new signal backward compatible and document expected
   no-op behavior plus post-deploy telemetry proof across the skew window.

## Tasks

1. [completed] Trace provider event shape, webhook ingress, route/member
   resolution, and current container prewarm lifecycle.
2. [completed] Choose and document the smallest safe owner-boundary extension.
3. [completed] Implement focused code and tests.
4. [completed] Run focused verification, direct scenario proof, and candidate
   diff review.
5. [completed] Commit, push, open the PR, then run preliminary specialist and
   final ReviewGPT concurrently with exact-head CI.
6. [completed] Resolve findings, close this plan with `scripts/finish-task`, and
   push the final head.

## Decisions

- Linq documents `chat.typing_indicator.started` as a one-to-one-chat-only
  event whose data contains `chat_id`; the shared parser now accepts only that
  minimal shape after ordinary signature and freshness verification.
- Typing resolves only the existing private home-chat blind index. It does not
  use phone/email identity inference, pending-contact enrollment, or group
  routing because the event has no participant or group authority.
- The webhook response keeps the existing `typing-ignored` contract and
  schedules lookup plus shell prewarm after acknowledgement. The established
  Cloudflare prewarm owner repeats live admission, consent serialization,
  exact stop-target binding, and lifecycle coalescing.
- Duplicate typing events need no new receipt or dedupe state. The optional
  Cloudflare owner returns before its FIFO whenever the consent-mutation lock
  is occupied, so repeated hints and hints during authoritative ensure,
  withdrawal, or deletion cannot queue ahead of user-critical work. The single
  admitted hint converges through the existing shell/container lifecycle.
- The preliminary specialist finding was accepted: focused mocks did not prove
  the complete signed typing-to-prewarm-to-later-reply journey. A hosted-local
  scenario now crosses the real Web and Worker boundaries and asserts typing
  creates no mailbox, provider, or outbound effect before the ordinary message.
- The final round-one finding was accepted after a pre-fix regression proved
  four repeated hints queued behind the first consent admission. The optional
  owner now checks the existing lock before joining it; the corrected regression
  proves duplicates settle immediately and at most one hint can precede an
  authoritative ensure.

## Verification

- `pnpm --filter @murphai/messaging-ingress test` — passed, 74 tests and one
  skipped test.
- Focused hosted Web Vitest run for Linq dispatch, prewarm target resolution,
  and shell-only wake — passed, 197 tests.
- `pnpm --filter @murphai/messaging-ingress typecheck` — passed.
- Typing-only hosted Web dispatch rerun — passed, four tests and 167 unrelated
  tests skipped.
- `pnpm --filter @murphai/hosted-web typecheck:prepared` — passed after the
  generated client/catalog preparation completed.
- Pre-fix focused UserRunner regression — failed as intended: none of four
  duplicate hints settled while the first admission was held, proving FIFO
  amplification before the correction.
- Corrected focused UserRunner concurrency and deletion tests — passed.
- Full `apps/cloudflare/test/user-runner-alarm.test.ts` — passed, 126 tests.
- `pnpm --filter @murphai/cloudflare typecheck` — passed.
- Hosted-local Linq scenario collection succeeded, but local execution was
  blocked before assertions: the normal lane hit the unchanged runner-bundle
  byte ratchet; the supported no-bundle lane then reached stack startup but the
  local Docker installation lacked `docker buildx`.
- One Crabbox Testbox `test:diff` run exercised affected package tests. Changed
  messaging-ingress tests passed; the run stopped on two hosted-local-harness
  failures specific to the Testbox Docker-bridge profile (MinIO readiness and a
  localhost/host.docker.internal expectation). No second remote run was used.
- Preliminary ReviewGPT — findings resolved; no rerun is required by policy.
- Final ReviewGPT round one — finding reproduced and resolved; full-snapshot
  round two is pending on the remediated exact head.
- Blacksmith Testbox `tbx_01kzkt04qeqv5ky4pkka81bz6p` (Actions run
  `31327187285`) completed the one allowed remote `test:diff` attempt. It stopped
  on the unrelated hosted-local Docker-bridge failures described above after
  changed messaging-ingress tests passed.
- Final ReviewGPT round two — `ROUND_OUTCOME: PASS` on
  `8e982fe567b3f73086377f280181e03ff4bada05`; it explicitly verified both
  accepted corrections and found no qualifying security, reliability,
  complexity, purpose, or material-experience issue. Requested model was
  `gpt-5.6-sol`; the captured response model slug was `gpt-5-6-pro`.
- Exact-head GitHub Actions on `8e982fe567b3f73086377f280181e03ff4bada05`
  — all required build/typecheck, app verification, package coverage, host
  matrix, fixture, billing, frontend proof, hygiene, and umbrella release checks
  passed. The optional live hosted-local Stripe browser matrix was skipped by
  its normal gate; a superseded duplicate frontend-proof run was cancelled while
  the current run passed.
- Parent final diff review — passed with no unresolved finding; the PR remained
  mergeable after incorporating current `main` through an ordinary merge.

## Result

- Authenticated Linq typing-start events now prewarm only established direct
  hosted members through the existing shell-prewarm owner, after immediate
  webhook acknowledgement and without creating conversational work.
- Optional hints cannot amplify the consent FIFO: at most one admitted hint can
  precede authoritative ensure, and hints during ensure, withdrawal, deletion,
  or another prewarm return immediately.
- The PR documents a Cloudflare Worker-first rollout followed by Web; no runner
  container image, persisted state, environment, or credential migration is
  required.
Completed: 2026-08-09
