# Port native voice to Codex 0.155.1

Status: active
Created: 2026-09-22
Updated: 2026-09-22

## Outcome and invariants

Ship authenticated voice on the currently deployed Codex release. Preserve native
handoff admission, ordinary text/model behavior, durable Murph input acceptance,
provider-confirmed call closure, and trusted usage settlement. Do not downgrade
the runtime or introduce a second call/process owner.

## Evidence and owners

The reviewed 0.153.4 patch does not apply to 0.155.1: native client code moved,
realtime handoff admission gained a retirement guard and fallible routing, and
protocol fixtures changed. The existing native patch, source-image recipe,
engine adapter and hosted test harness remain the owners. The PR has three
completed review rounds; continuation through a fourth review is authorized.

## Scope and design

Reconcile current main, port the existing native delta, regenerate its schema
fixture and patch, and update the exact source checksum/image identity. Keep the
new upstream handoff guard for native inputs while hosted inputs remain emitted
for durable client admission. Retain existing bounded close-only cleanup.
No new persisted state, lifecycle service, dependency, or deployment path.

## Product UX

Outcome: A signed-in member can start, speak, receive a tool-backed reply, mute,
and end a call on the current runtime.
Reaches: Normal calls, microphone denial/cancel, transport loss, native callers
without hosted input mode, and existing text conversations.
Proof: Native protocol/lifecycle tests, exact built-image engine and confinement
checks, synthetic hosted browser call, and post-deploy health/version checks.
No private recordings, identities, transcripts, or production rows in artifacts.

## Tasks

1. Reconcile current main and port source, preserving both owners' behavior.
2. Build and test the pinned CLI; regenerate protocol fixtures and route evidence.
3. Run focused Murph tests/typechecks and synthetic hosted voice proof.
4. Review the candidate, push, run authorized ReviewGPT round 4 with exact-head CI.
5. Merge and deploy only after review, CI, compatibility, and test-usage requirements
   are resolved; validate production readiness through canonical hosted paths.

## Usage and deployment

Local proof uses synthetic accounts and does not consume a member's allowance.
Production test usage must not reduce the requesting member's allowance. Confirm
an existing supported operator/funding path before production testing; do not
silently exempt voice for all members or disable trusted usage receipts.
Deploy compatible readers/runtime before admitting voice. Preserve old-channel
readers for any admitted work and follow the existing protected deploy workflow.

## Verification and progress

- Reproduced patch failure against the exact 0.155.1 tag.
- Remote PR head matches the clean task checkout; candidate marked draft.
- Reconciled main and ported the native patch to the pinned 0.155.1 commit.
- Preserved the new upstream admission semaphore and retired-state check in
  both native and client-managed handoffs; retained fallible routing and closure.
- Regenerated the experimental schema fixture. Exact upstream tag/commit/tree
  and patch applicability verification passes.
- Native proof: 75 realtime integration tests and 171 API unit tests pass.
  The new regression covers both native and client-managed late handoffs.
- Replaced the removed Terra launch constant with the canonical current default;
  synthetic hosted browser proof now selects GPT-6 Sol.
- Focused runtime/control/engine/browser tests: 197 passing. Cloudflare,
  assistant-runtime, assistant-engine, and Web typechecks pass. Web lint passes
  with existing warnings. Complexity guard against current main passes.
- All 53 native app-server realtime tests pass serially; protocol unit/schema
  tests also pass. The exact Linux source-image build is running.
- Live GPT-6 Sol subscription proof passes after the frozen CLI install was
  refreshed to 0.155.1: one reminder save, one successful tool action, and a
  truthful connected-messaging destination. Reply review: Ready. Earlier
  blocked attempts took no provider actions; no auth material was copied.
- Existing talk-with-murph release note covers the unchanged member capability.
  Production test-usage scope is awaiting clarification.
