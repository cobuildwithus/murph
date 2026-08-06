# Linq capability egress and fallback diagnostics

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Restore native iMessage nutrition-card eligibility in the hosted runtime by
  admitting the exact Linq capability operation through the existing
  Cloudflare provider-egress owner.
- Preserve deterministic text recovery while making every caught capability
  or definitive app-card failure visible through privacy-safe diagnostics.

## Root-cause evidence

- The response-card sender calls Linq's documented
  `POST /capability/check_imessage` operation before an eligible native send.
- The deployed Cloudflare Linq egress matrix omitted that exact operation and
  returned `403` before provider authorization or upstream fetch.
- The channel runtime intentionally recovered with the existing text-only
  outbox transition, but its catch emitted no diagnostic, so hosted delivery
  appeared successful without recording why the card path was skipped.
- Existing hosted card tests stub provider fetch below the production
  interception boundary and therefore did not exercise the missing route.
- Review of the recovered provider path exposed a second owner-boundary bug:
  a card send marked as possibly accepted was classified as an ordinary retry.
  A later drain could re-enter capability selection and attempt a changed text
  effect under the original card delivery key.
- Final ReviewGPT correction review exposed a third owner-boundary bug: the
  local outbox promoted a rejected card to its fallback key, but the Web
  provider-entry boundary memoized the original card claim for the send. A
  focused runtime test first observed one engagement assertion instead of two,
  and a focused Web test first observed a fallback claim without predecessor
  terminalization. The original `provider_dispatch_started` row could therefore
  remain unresolved indefinitely and block later group routing for that chat.
- Final ReviewGPT round 4 proved that terminally abandoning that ambiguous card
  locally did not resolve the already-claimed Web dispatch fence. The focused
  state and outbox regressions first observed `abandoned` with no retry. Exact
  provider-idempotent replay is therefore required: it retains the card and
  key, skips capability re-selection, and lets provider acceptance close the
  original fence without changing the effect.

## Success criteria

- The Worker admits only `POST /capability/check_imessage` for the new Linq
  capability operation and retains the existing write-fence/provider-token,
  credential-injection, and header-stripping requirements.
- Other methods and non-allowlisted Linq paths remain denied before upstream
  fetch.
- A policy-denied known Linq request emits a metadata-only warning without
  paths, request bodies, recipient data, credentials, or provider response
  text.
- A capability-check exception or definitive app-card rejection emits one
  sanitized hosted warning before the existing persisted text fallback.
- A normal `available: false` result remains an expected fallback and is not
  mislabeled as an error.
- A card-bearing attempt that may already have succeeded enters
  delivery-confirmation-pending and replays only the identical card and key
  without another capability check. It cannot reuse the card delivery key for
  text; only a definitive rejection may promote the stable fallback.
- Before promoted fallback text enters Linq, Web terminalizes the exact card
  dispatch and claims the fallback in one transaction. A retry from the
  already-persisted fallback repeats that exact transition, and completing the
  fallback leaves no unresolved dispatch fence for the chat.

## Scope

- Cloudflare Linq egress operation classification and focused tests.
- Assistant channel fallback diagnostics and hosted provider-effect coverage.
- Hosted runtime-to-Web provider-fence transition and delivery-store coverage.
- Current provider-egress and response-card reliability documentation.

## Constraints

- No new row, queue, retry owner, external provider call, credential, or
  dependency; reuse the existing delivery rows and engagement transaction.
- Keep provider request and response bodies, phone numbers, chat ids, member
  ids, idempotency keys, and raw error text out of durable diagnostics.
- Preserve the current single-effect outbox transition and use its existing
  confirmation-pending state for exact provider-idempotent card replay.
- Deploy Web first because it accepts the optional predecessor transition while
  remaining compatible with the old runner. Then ship the Cloudflare Worker
  and runner bundle together with immediate rollout; the new runner must not
  precede the Web endpoint that understands the transition.

## Tasks

1. [x] Add the exact Linq capability operation and policy-denial diagnostic.
2. [x] Add caught-failure diagnostics without changing text recovery.
3. [x] Run focused tests, typechecks, documentation checks, and privacy review.
4. [ ] Push the exact candidate and complete ReviewGPT plus CI gates.

## Verification log

- From `apps/cloudflare`, `pnpm exec vitest run --config vitest.config.ts test/runner-egress-intercept.test.ts`
  — 231 passed.
- From `packages/assistant-engine`, `pnpm exec vitest run --config vitest.config.ts test/assistant-channels-runtime.test.ts`
  — 60 passed.
- From `packages/assistant-runtime`, `pnpm exec vitest run --config vitest.config.ts test/hosted-provider-effects.test.ts`
  — 21 passed after the specialist correction.
- From `packages/assistant-runtime`, `pnpm exec vitest run --config vitest.config.ts test/hosted-runtime-callbacks.test.ts`
  — 210 passed after updating the exact dependency assertions exposed by CI.
- Package typechecks passed for `apps/cloudflare`, `packages/assistant-engine`,
  and `packages/assistant-runtime`.
- `pnpm docs:gardening` and `pnpm docs:drift` passed.
- Diff whitespace and direct-identifier scans passed; the changed diagnostics
  contain no request body, provider response text, recipient or thread
  identifier, delivery key, or credential.
- Preliminary ReviewGPT found one truthful-state issue in the warning copy:
  the pre-transition event claimed completed recovery. The message now says
  text recovery was selected, and a focused persistence-failure regression
  proves the operation rejects without a text send.
- Final ReviewGPT round 1 passed the original candidate with no findings. The
  accepted specialist correction required a correction-delta round. Exact-head
  CI exposed four broader test assertions that did not include the new
  callback; those assertions are corrected and local proof passes.
- Final ReviewGPT round 2 verified the earlier correction and found the
  ambiguous card-attempt changed-effect retry path. The first correction used
  terminal abandonment to prevent capability re-selection and text promotion.
- From `packages/assistant-engine`, `pnpm exec vitest run --config vitest.config.ts test/outbox-dispatch-state.test.ts`
  — 28 passed after the ambiguity correction.
- From `packages/assistant-engine`, `pnpm exec vitest run --config vitest.config.ts test/assistant-outbox-runtime.test.ts`
  — 90 passed before the round 4 correction.
- `packages/assistant-engine` typecheck passed after the ambiguity correction.
- Final ReviewGPT round 3 found that the fallback used the original memoized
  Web provider claim. The two failing-first regressions proved the stale-fence
  mechanism before the correction. The runtime now re-enters Web with the
  predecessor identity after local fallback persistence, and Web atomically
  terminalizes that exact predecessor before claiming the fallback.
- From `packages/assistant-runtime`, `pnpm exec vitest run --config vitest.config.ts test/hosted-runtime-callbacks.test.ts`
  — 212 passed after the fence-transfer correction.
- From the repository root, `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts`
  — 47 passed, including exact predecessor, derivation, and intent-ownership
  validation.
- The opt-in local PostgreSQL fence lifecycle proof passed: the original row is
  terminalized, the fallback is the only unresolved row while active, and the
  chat has no unresolved dispatch after fallback acceptance.
- `packages/assistant-runtime` and prepared `apps/web` typechecks passed after
  the fence-transfer correction.
- Final ReviewGPT round 4 proved terminal local abandonment stranded the Web
  dispatch fence. Two focused regressions failed with `abandoned` before the
  correction. Ambiguous native-card delivery now uses the existing
  confirmation-pending state and replays the exact card/key without capability
  selection; definitive rejection still transfers the fence before text.
- Focused exact-replay proof passes in outbox state, outbox/channel integration,
  channel runtime, hosted provider effects, and hosted callbacks. The local
  PostgreSQL proof now also shows acceptance under the original replayed key
  clears the unresolved chat fence; both PostgreSQL cases pass.
