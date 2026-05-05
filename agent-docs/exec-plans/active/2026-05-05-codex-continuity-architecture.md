# Codex Continuity Architecture Plan

Date: 2026-05-05
Status: Draft for review before implementation

## Problem

Hosted Murph should behave like a thin runner over Codex App Server: restore the same Codex home, pass Codex the stored thread id, and let Codex resume its own thread.

The current production failure shape was a resumed Codex turn failing before provider work with an `input.N.output: Invalid input` error. Local reproduction showed the same failure class when Codex replayed a thread containing structured tool output content. Codex itself supports structured function-call outputs in persisted rollout history, so the likely Murph-owned failure is not the content shape by itself. The likely failure is that Murph can resume Codex with an inconsistent continuity bundle or with route overrides that change the provider replay context.

## Current Architecture

- Murph stores the Codex App Server resume handle as `providerSessionId` in assistant session runtime state.
- Murph passes that handle to Codex App Server as `threadId` in `thread/resume`.
- The app-server runner restores `CODEX_HOME` from `.codex-hosted` under the hosted operator home.
- Assistant runtime hot checkpoints include assistant session state, including `providerSessionId`.
- Hosted full/base snapshots include operator-home state, including `.codex-hosted`.
- Most hosted checkpoints are hot checkpoints, not full snapshots.
- Route identity already fingerprints model/provider/runtime details, and native resume is gated by the stored route id matching the current route id.

## Likely Invariant Violation

The Codex resume handle and Codex home can currently move independently:

- A hot checkpoint can persist a new `providerSessionId`.
- That same hot checkpoint does not persist the matching updated `.codex-hosted`.
- A later restore can combine newer assistant session state with an older Codex home.
- Codex then receives a valid-looking thread id against the wrong local thread store.

That violates the intended Codex contract: the resume id is only meaningful with the Codex home that minted and last advanced it.

There is a second deviation from the thin-runner model: ordinary `thread/resume` currently sends current model/provider context. Codex App Server has persisted thread metadata, and normal resume should prefer that metadata instead of letting Murph reinterpret the thread under current route settings.

## Target Invariants

1. Codex continuity is one atomic unit:
   - `.codex-hosted`
   - `providerSessionId`
   - config fingerprint that minted the thread

2. Murph does not reconstruct Codex history:
   - no transcript-to-Codex-history conversion for native resume
   - no repair of Codex rollout entries
   - no schema translation for Codex tool outputs

3. Native resume is allowed only when the stored config fingerprint matches the current route:
   - model changes start a new Codex thread
   - model provider changes start a new Codex thread
   - execution driver or resume kind changes start a new Codex thread
   - Codex home changes start a new Codex thread

4. Ordinary app-server resume does not override persisted Codex thread metadata:
   - pass the thread id
   - pass only required runtime context such as cwd/sandbox/instructions when intentionally refreshing instructions
   - do not pass model/provider overrides unless this is an explicit migration path

5. Recovery fallback can start a fresh thread, but the fresh thread id must not be checkpointed without the matching `.codex-hosted`.

## Proposed Shape

### 1. Make Codex Continuity Atomic

Represent Codex continuity as a named bundle, not two incidental fields in separate snapshot layers.

Minimum implementation options:

- Option A: include `.codex-hosted` in hot checkpoints whenever assistant session state can include or update `providerSessionId`.
- Option B: force a full checkpoint after any assistant phase that persists a provider turn result with a new or updated `providerSessionId`.
- Option C: create a small Codex continuity sidecar snapshot that stores `.codex-hosted` plus the resume state together, then layer it separately from generic hot assistant runtime state.

Preferred long-term shape: Option C. It keeps hot assistant runtime checkpoints small while making the Codex-specific atomicity explicit.

Pragmatic first patch: Option A or B, whichever is smaller and safer after tests measure bundle size and checkpoint behavior.

### 2. Store an Explicit Resume Config Fingerprint

The existing `resumeRouteId` already captures the important model/provider/runtime dimensions indirectly. Make this intent explicit by either:

- adding `resumeConfigFingerprint` to resume state, or
- documenting and renaming the route binding concept so tests and logs treat route id as the resume config fingerprint.

The fingerprint must cover:

- provider
- execution driver
- resume kind
- model
- model provider
- reasoning effort
- sandbox
- approval policy
- profile
- Codex home identity
- Codex command, if configured

Native resume should be refused on mismatch. Refusal means start a new Codex thread; it does not mean replay old Codex history.

### 3. Thin App-Server Resume Request

Change ordinary `thread/resume` construction so it does not pass model/provider overrides when resuming an existing Codex thread under a matching fingerprint.

The resume request should primarily identify:

- `threadId`
- working directory
- optional refreshed instructions when the thread-instruction fingerprint changed
- sandbox/approval context only if Codex requires those outside persisted metadata

If a route migration is later needed, make it an explicit migration mode with separate tests and observability.

### 4. Observability

Add metadata-only diagnostics for resume decisions:

- whether native resume was attempted
- whether native resume was refused because config fingerprint changed
- whether Codex continuity was checkpointed atomically
- whether restored `.codex-hosted` could resolve the stored thread id
- whether app-server resume sent model/provider overrides

Do not log raw prompts, raw message text, raw thread ids, secrets, home paths, or provider headers.

### 5. Proof Tests

Add focused tests before relying on the fix:

1. Resume gating:
   - same model/provider keeps native resume enabled
   - model change disables native resume
   - model provider change disables native resume
   - Codex home change disables native resume

2. Snapshot atomicity:
   - after a provider turn updates `providerSessionId`, the matching `.codex-hosted` state is included in the same persisted continuity layer or the checkpoint is full
   - a layered restore cannot produce newer resume state with older Codex home

3. Real Codex home round trip:
   - create a real Codex App Server thread in an isolated Codex home
   - include a structured tool output in the persisted thread
   - snapshot and restore the Codex continuity bundle
   - resume by stored thread id
   - verify no `input.N.output: Invalid input` failure

4. App-server resume params:
   - ordinary resume omits model/provider overrides
   - new thread still receives intended model/provider config
   - explicit migration, if introduced, is the only path that overrides provider metadata on resume

## Rollout Plan

1. Add read-only diagnostics around current resume decisions and checkpoint mode.
2. Add tests that demonstrate the current atomicity gap.
3. Patch checkpointing so Codex continuity moves atomically.
4. Patch app-server resume params to stop overriding model/provider on ordinary resume.
5. Keep the invalid-resume fresh-thread fallback as a guarded recovery path.
6. Deploy and watch metadata-only logs for:
   - native resume attempts
   - resume refusals due to fingerprint mismatch
   - atomic Codex continuity checkpoint confirmation
   - absence of `input.N.output` failures on resumed turns

## Non-Goals

- Do not fork or patch Codex.
- Do not duplicate Codex history management in Murph.
- Do not store user-facing memory in assistant runtime state.
- Do not log raw Codex ids, prompts, message bodies, secrets, or local machine paths.

## Open Questions

- Is hot-checkpoint bundle size acceptable if `.codex-hosted` is included directly?
- Does Codex App Server require sandbox/approval fields on resume, or can those also be treated as persisted thread metadata?
- Should the durable name be `resumeConfigFingerprint`, `codexContinuityFingerprint`, or a clarified `resumeRouteId` contract?
- Should recovery from an invalid native resume clear resume state immediately, or only after a fresh thread succeeds and its Codex continuity has been atomically checkpointed?
