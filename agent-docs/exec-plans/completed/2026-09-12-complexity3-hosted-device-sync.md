# Simplify hosted device-sync connection updates with Pro

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

Have GPT-6 Pro implement a bounded behavior-preserving reduction of duplicated
connection-update projection in the hosted device-sync runtime, then audit and
verify the returned patch locally.

## Scope and architecture

- Source owner: packages/assistant-runtime/src/hosted-device-sync-runtime.ts,
  centered on buildHostedDeviceSyncRuntimeConnectionUpdate.
- Test owner: packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts.
- Reuse the typed update contract, credential/error/cadence/timestamp helpers,
  and composed service/port test harness. Web remains the control-plane owner.
- Collapse duplicated disconnected/active connection-field projection and
  repeated object reconstruction; do not introduce a generic patch framework.
- Hydration, source lifecycle/replay, dirty admission, checkpoint protocol,
  provider scheduling, auth, persistence, exports, and dependencies stay outside
  this focused implementation.

## Protected behavior

- Preserve explicit null observed fences, sparse field omission, disconnected
  field exclusions, token clear/export rules, and redacted credential handling.
- Preserve credential derivation and error/cadence/timestamp assignment order,
  including clearError versus lastSyncErrorAt precedence.
- Preserve checkpoint-derived metadata publication and connection/source epochs.
- No new I/O, persisted state, provider calls, or runtime policy.

## Tasks

1. Inspect source, composed tests, architecture, security, and reliability owners.
2. Prepare an ignored Pro implementation prompt and hand it to the parent.
3. Parent sends the source context and retrieves the relative-path patch.
4. Audit and apply the returned patch only after parent handoff; reject scope or
   behavior drift and verify focused tests, typecheck, and complexity guard.
5. Record actual evidence and complete the parent-owned candidate/PR handoff.

## Verification

- Full hosted-device-sync-runtime.test.ts suite with one worker.
- Assistant-runtime typecheck with one package checker.
- pnpm complexity:diff against base 486a6595e51bff2a6cfa64beb4ee1a953854a8b6.
- Full diff, private-data boundary, and exact source ownership inspection.
- Baseline source analysis confirms file debt 143, maximum 75; connection update 75 and
  hydration 54. Record measured final numbers without claiming moved debt gone.

## Delegation boundary

Pro must implement the primary source/test patch and return an applyable
attachment. No source or test edits precede that artifact. The parent owns
ReviewGPT sending, downloading, final audit, and completion gates.

## Preparation evidence

- Exact base and clean source/test ownership verified.
- Frozen dependency install completed; Frog inventory inspected successfully.
- Ignored implementation prompt prepared with exact model and attachment markers,
  two-file scope, preservation traps, and composed verification commands.
- No source or test changes; awaiting the parent-owned Pro implementation artifact.

## Implementation and local proof

- Applied the exact GPT-6 Pro source/test patch without local redesign; artifact
  SHA-256: 468ed13e32c0dfc5dd205dcbe567ee63f246abb49f05fa6770d1d54372f996a9.
- One typed sparse connection delta replaces duplicated disconnected/active
  status/setup projection and repeated object reconstruction. No helper added.
- Existing composed tests now cover independent setup clearing on disconnect,
  exclusion of active-only fields, exact active deltas, and empty-update no-op.
- Full hosted-device-sync runtime suite: 133 tests passed with one worker.
- Assistant-runtime typecheck: passed with one package checker.
- Complexity guard against the recorded base: passed; debt 143 to 128 and
  maximum 75 to 60. Hydration remains 54; no decisions moved to new functions.
- Source change: 34 added / 66 deleted lines; tests: 103 added / 32 deleted.
- Patch and diff privacy inspection passed; no new repository-actionable friction.
- Implementation and local proof are complete. Parent owns final candidate
  review, Ready, final ReviewGPT, exact-head CI, and PR completion.
Completed: 2026-09-12
