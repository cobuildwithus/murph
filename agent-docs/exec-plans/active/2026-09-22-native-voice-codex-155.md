# Port native voice to the current stable Codex release

Status: active
Created: 2026-09-22
Updated: 2026-09-23

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
4. Review the candidate, push, run authorized ReviewGPT round 5 with exact-head CI.
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

## Authorized review remediation

Round 4 found that an initial sideband attachment failure can abandon a created
Public Live call after SDP has reached the browser. Parent disposition: accepted;
the native error branch bypasses the existing close-only cleanup. The user
resumed the fix and another review on 2026-09-23.

Reuse one native same-call attachment/close operation for both initial failure
and established transport loss. Cancellation during the failed initial join
uses that same operation within the existing five-second shutdown deadline.
Do not replay speech, admit delegation, create a replacement call, or invent a
confirmed usage receipt. Regression proof controls the first handshake until
startup completes, then tests confirmed cleanup, EOF, timeout, and cancellation.
No new runtime state, dependency, persistence, or host lifecycle owner.

The previous Linux image built successfully. Its CI route inventory needs an
explicit disposition for one new concatenated binary string; classify only
after tracing the pinned source. The temporary Blacksmith testbox expired;
rebuild and composed hosted proof require a fresh task-owned testbox.

## Latest stable upgrade and deletion audit

The user additionally requested the latest stable CLI and removal of obsolete
compatibility code. npm's latest tag and the official release identify 0.156.1
at `b412ff32c417f855c2b2d1581b77058eed87c84b`. Its native Sol/Luna model
entries are identical as parsed objects to the former supplement.
Delete that 345-line catalog, its staging/copy/fingerprint path and obsolete
fixture setup; retain product filtering, Astra authority, mixed Code Mode,
Flex support and context-window validation against the bundled catalog.

Upstream 0.156.1 improves private V3 transcript reconciliation but still lacks
public Live wire support and host-managed input admission. Retain those narrow
native deltas and the now-shared bounded cleanup operation. Preserve upstream
provider routing, transcript tests and schemas while porting; do not introduce
new lifetime owners. The four initial-attachment regressions reproduce against
the prior candidate and pass after remediation on 0.155.1. Repeat relevant proof
on 0.156.1 before the authorized fifth review.

- 0.156.1 source tag/commit/tree and regenerated patch applicability pass.
- The native API suite passes all 179 tests. Native app-server voice proof
  passes 65/66 cases; the one failure is initialization timeout before the
  existing-call test begins. All four new cleanup cases pass on 0.156.1.
- Packaging/deployment tests pass 87 cases after supplement deletion; Cloudflare
  and assistant-engine typechecks pass. Focused GPT-6 Sol reminder proof passes
  on the installed 0.156.1 CLI with one save and the correct Telegram destination.
- Complexity passes against the reconciled task baseline. Current main advanced
  separately; reconcile it before final readiness instead of attributing its
  unrelated simplifications to this candidate.
- The exact 0.156.1 Linux source image is building on a fresh owned testbox.

- Reconciled current main at `b7c6748810f49fec7723cb5ac7b13300cdcfeb65`.
  Removed the remaining supplement merge from hosted-local startup and the
  real-Codex test helper; both now consume the native bundled catalog.
- Complete provider request parity on 0.156.1: individual 31,952 tokens and
  149,112 bytes; group 28,943 tokens and 132,972 bytes. Stock and patched
  normalized requests are byte-identical (zero tokens/bytes/percent delta).
- Post-reconciliation Cloudflare voice controls pass 22 cases. Runtime/config
  proof passes 71 cases with eight opt-in skips; the five invocation lifecycle
  cases pass on Linux. Local timing failures under heavy load remain recorded,
  with no production timeout changes. Engine/runtime/Cloudflare typechecks pass.
- The app-server suite still has one ten-second initialization timeout before
  the legacy existing-call case starts; 65 voice cases, including all new
  cleanup and upstream transcript cases, pass. A direct isolated app-server
  startup responds in 8.95 seconds. Exact Linux compatibility and composed
  call proof remain completion gates.
- Hosted-local startup proof passes 84 tests and its typecheck after removing
  the launch merge. Post-reconciliation complexity guard passes.

## Final candidate proof and review

- Final ReviewGPT round 5 passes at
  `39960f678edefb1f12f59036868d780e40e8b87a` with GPT-6 Pro. The full
  snapshot retained the first and previous review anchors. Committed user-turn
  identity, preceding-turn signature, model identity and response SHA-256
  `0800d36a2c2e09f774ce67cc89bbd3284bd2b975436129be4cd2492d0bd30698`
  are verified; the owned review tab is closed. No serious bug or material
  simplification finding remains.
- The exact pinned Linux source image builds successfully. Its source fingerprint
  is `6c0b8cb850851674f8d1e9ee279c80aab4d8235b355a4489188d49e12ae7e0fe`.
  All four native voice cases, all 29 provider route/authority cases and the
  final-image permission confinement proof pass against the extracted CLI.
- Stock Linux provider proof passes 27 cases with two native-only skips. Four
  source-traced concatenated binary strings receive explicit false-positive
  dispositions in the existing test inventory. No provider allowlist or unknown
  route rejection changes. These explain both failed CI route-inventory jobs.
  Cloudflare typecheck passes after generating the runner's Prisma client.
- The legacy macOS existing-call test passes alone with only its test startup
  grace extended, completing in 1.08 seconds. The temporary diagnostic edit is
  restored; no production timeout or committed patch changes. The original
  65/66 suite result remains recorded without claiming a full green rerun.
- The reviewed private build-cache companion PR #166 is merged at
  `8cdaa121ed2e31a9514366b85331e30e09111efb`. This does not deploy voice.
