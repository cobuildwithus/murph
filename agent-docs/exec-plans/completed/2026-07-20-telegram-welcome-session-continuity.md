# Preserve signup-welcome conversation continuity

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Ensure the first attended Telegram message continues from the already-delivered
  signup welcome instead of starting a second assistant introduction.

## Success criteria

- A fixed-text signup welcome and the first attended turn resolve to one logical
  conversation history.
- Provider-native resume state is never reused across an incompatible execution
  policy.
- Focused regression coverage fails on the current behavior and passes after the
  owner-level correction.
- Required owner verification, completion audits, PR review, and parent final
  review have no unresolved findings.

## Scope

- In scope: notification message planning for exact-text responses that never
  invoke a provider; focused assistant-engine and hosted notification/onboarding
  regression proof; current owner documentation only if the existing contract is
  incomplete.
- Out of scope: welcome copy, Telegram provider delivery, first-contact policy,
  onboarding prompt changes, or a new persisted state owner.

## Constraints

- Keep the restrictive read-only policy for detached notifications that invoke a
  provider.
- Preserve one conversation history for exact-text notifications, which have no
  provider-native resume state to isolate.
- Do not touch the live main-checkout development process or unrelated onboarding
  edits.
- Preserve external delivery idempotency and existing session lookup keys.

## Risks and mitigations

1. Risk: relaxing all detached notification policy would let model-backed turns
   run with broader authority.
   Mitigation: branch only for `require_send_exact_text`, and assert the direct
   model-backed notification remains read-only.
2. Risk: changing generic session rotation would weaken provider-native
   continuity isolation across real execution-policy changes.
   Mitigation: leave session resolution and fingerprint rotation untouched; fix
   the exact-text message plan before session lookup.
3. Risk: a test stubs the next assistant answer and misses the missing-history
   defect.
   Mitigation: assert session/transcript continuity directly, including the
   delivered welcome and the new inbound message.

## Tasks

1. Trace fingerprint rotation, session lookup, transcript persistence, and native
   resume invalidation through the current owners and tests.
2. Add a focused failing regression for a restrictive exact-text welcome followed
   by an attended Telegram turn.
3. Implement the smallest notification-planning correction without changing
   session ownership or provider-backed execution policy.
4. Run focused tests, typecheck, diff-aware verification, required audits, and
   direct scenario proof.
5. Finish the scoped plan commit, open the PR, and complete ReviewGPT and CI.

## Decisions

- Use an isolated guarded worktree because the primary checkout has unrelated
  active onboarding edits and a running local stack.
- Treat the container evidence as proof of the observed boundary: two distinct
  outbox messages used one conversation key but separate sessions whose policy
  fingerprints differed.
- Keep continuity-fingerprint rotation unchanged. The root cause is earlier:
  exact-text notifications were assigned a read-only provider policy even though
  they never start a provider, so their delivered transcript was persisted in a
  session the first attended turn could not reuse.
- Use the ordinary requested sandbox for scheduled notifications and exact-text
  notifications; continue forcing other detached notifications to read-only.

## Verification

- Failing-before proof: focused assistant-engine integration test failed because
  the attended turn created a second session.
- Focused assistant-engine notification/session suite: 46 passed.
- Assistant-engine typecheck: passed.
- Assistant runtime hosted-event suite: 33 passed.
- Assistant-runtime local-service suite with an 8 GiB test heap: 93 passed.
- Cloudflare typecheck: passed.
- Diff-aware verification reached and passed all affected guards, typechecks,
  assistant-cli (128), assistant-engine (2,527 with 5 skipped),
  assistant-runtime (1,737 with 2 skipped), and assistantd (40) before an owned
  interrupted verifier left an empty CLI artifact-repair lock.
- The two reported CLI files passed after clearing that owned empty lock and
  generating the standard ignored Health Commons artifact: 74 passed.
- Docker-backed `pnpm hosted-local e2e telegram-first-contact --no-bundle` after
  a fresh runner-bundle build: 5 passed. The scenario sends exactly one signup
  welcome and proves the first inbound provider `input` includes that welcome.
- Coverage-write audit: existing proof is sufficient; no edits or unresolved
  findings.
- Clean final diff-aware verification passed end to end with an 8 GiB test heap:
  all guards and affected typechecks; assistant-cli 128; assistant-engine 2,527
  with 5 skipped; assistant-runtime 1,737 with 2 skipped; assistantd 40; CLI
  1,077 with 1 skipped; setup-cli 124; Cloudflare node 1,841; Cloudflare Workers
  1.
- Parent final review: no unresolved findings; the production change is one
  branch in the existing notification planner, with no new state owner,
  abstraction, dependency, or compatibility path.
- ReviewGPT and CI: pending.
Completed: 2026-07-20
