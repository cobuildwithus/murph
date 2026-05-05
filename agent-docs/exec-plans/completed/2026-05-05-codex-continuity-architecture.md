# Codex Continuity Architecture Plan

Date: 2026-05-05
Status: completed

## Summary

Hosted Murph should be a thin runner over Codex App Server. Murph stores the Codex thread id, restores the Codex home, and asks Codex to resume. Murph should not reconstruct Codex history, repair Codex rollout files, or translate Codex tool outputs.

The architectural bug is best described as a live-state completeness bug:

> If the live state snapshot stores a provider resume pointer, it must also store the provider local state required to resume that pointer.

For Codex native resume, that means assistant live state cannot persist `providerSessionId` without also preserving the matching `.codex-hosted` state.

## Naming

Use these terms in implementation discussions:

- `baseSnapshot`: an occasional full workspace backup.
- `liveStateSnapshot`: the small correctness bundle needed for the next hosted run to continue safely.
- `restore`: restore `baseSnapshot`, then overlay `liveStateSnapshot`.
- `compaction`: fold the current live state back into a new base snapshot later.

Avoid introducing a separate "Codex checkpoint" subsystem. Codex state is part of live assistant state when Codex native resume is enabled.

## Current Problem

Today, the live state snapshot can include Murph assistant runtime state such as sessions, transcripts, outbox state, active-turn input, and `providerSessionId`.

But `.codex-hosted` lives under the hosted operator home and is captured by full/base snapshots, not by the live assistant-state snapshot.

That can produce this bad restore shape:

1. Codex runs and advances its local thread state in `.codex-hosted`.
2. Murph persists assistant session state that points at the Codex thread id.
3. The hosted runtime writes a live state snapshot that preserves Murph's session state.
4. The matching updated `.codex-hosted` is not included.
5. A later restore combines newer Murph session state with older Codex local state.
6. Codex receives a valid-looking thread id against a stale or mismatched local store.

This explains the `input.N.output: Invalid input` failure class without treating Codex history as something Murph should own. Codex supports structured tool outputs in its persisted history; Murph's likely failure is resuming that history under an inconsistent local/provider context.

Full/base snapshots already include filtered `.codex-hosted` state and metadata-only diagnostics. The immediate architectural gap is live state parity, not a new Codex snapshot subsystem. Ordinary resume-param thinning is a separate compatibility phase after the durability bug is fixed and tested.

## Target Invariants

1. **Live state is complete.**
   If live state includes assistant runtime state with `providerSessionId`, it also includes the Codex local state needed to resume that id.

2. **Codex owns Codex history.**
   Murph does not parse, rebuild, repair, or normalize Codex rollout history as part of normal operation.

3. **Restore is replace-then-overlay for live-owned roots.**
   If live state includes `.codex-hosted`, restore clears the corresponding restored `.codex-hosted` root before overlaying live state. Stale base files must not survive beside newer live files.

4. **Route identity remains the config-change gate.**
   Reuse `resumeRouteId`; do not add a duplicate persisted config fingerprint yet. The route id already fingerprints provider, execution driver, resume kind, model, model provider, reasoning effort, sandbox, approval policy, profile, Codex home option, and Codex command.

5. **Ordinary resume thinning is a separate compatibility change.**
   A normal `thread/resume` should pass the Codex thread id and only the runtime fields Codex actually requires. Model/provider overrides should not be sent by default. Sandbox, approval, reasoning, and instruction refresh should also be reviewed as possible resume-context override leaks.

6. **Fallback cannot split continuity.**
   If invalid-resume recovery starts a fresh Codex thread, the fresh `providerSessionId` cannot become durable without the matching `.codex-hosted` state in the same live state snapshot.

7. **Budget fallback preserves completeness.**
   If live state with Codex home exceeds live-state budgets, fallback to a full/base snapshot or refuse to publish the layered checkpoint. Full/base fallback must satisfy the same provider-continuity invariant. Never fit the budget by dropping `.codex-hosted` while keeping assistant session state with a Codex resume pointer.

8. **Runtime config is not provider continuity.**
   Generated `.codex-hosted/config.toml` may be snapshotted for runtime setup, but config-only Codex home state must not count as resumable provider-local continuity or trigger ownership clearing on restore.

## Implementation Plan

### 1. Treat `.codex-hosted` as Live Assistant State

Update the live state snapshot contract so it can include the hosted operator-home root in addition to vault assistant runtime paths. The live snapshot API should accept `operatorHomeRoot` and include filtered `.codex-hosted` from the `operator-home` root whenever hosted Codex is active and the directory exists.

This is not a new checkpoint type. It is making the existing live state snapshot complete for the assistant runtime state it already preserves.

Keep the Cloudflare bridge thin: it should pass the operator home to the live-state snapshot primitive, not interpret assistant session schema itself. The lower-level snapshot primitive decides whether live assistant state contains provider resume state; only then should it include filtered Codex provider-local continuity.

Reuse one shared `.codex-hosted` snapshot filter for full/base and live snapshots. Treat Codex home as opaque provider-owned files plus privacy and process-local exclusions. If the filter needs to become more allowlist-shaped for size or privacy, change it once for both full and live paths and prove it with fixtures rather than creating a separate live-only interpretation of Codex storage.

Config-only Codex home state is not enough to satisfy continuity, and stale Codex session files should not be snapshotted merely because an operator home exists. The enforceable minimum is filtered provider session/rollout state under Codex's session continuity tree when assistant live state has a provider resume handle. If that shape changes across Codex versions, Murph should fail closed or fall back to a complete full/base snapshot rather than infer or repair Codex history.

### 2. Add Clear-Before-Overlay Restore

Before applying a live state snapshot that contains provider-continuity Codex home state, clear only the restored `.codex-hosted` root from the base snapshot. Then overlay the live copy.

This matters because Codex may scan local state. A base snapshot's old files must not remain after live state replaces the Codex home.

Do not clear all operator-home state. The restore primitive should clear exactly the live-owned root before applying the live bundle. A legacy or malformed live bundle that contains a provider resume pointer without provider-local Codex continuity must not be overlaid onto an older base Codex home.

### 3. Keep Base Snapshots Off The Response Path

Do not force full/base snapshots after every assistant reply as the default long-term fix. The response-path checkpoint should remain a small live state snapshot.

Full/base snapshots remain for:

- initial full backups
- maintenance and compaction
- fallback if live state exceeds budget or cannot be written safely

Budget accounting must include Codex-home files and bytes separately enough to diagnose growth, ideally before bundle construction as well as after bundle measurement. If the live snapshot exceeds budget, the fallback path must preserve the completeness invariant by publishing a complete full/base snapshot or no new ref.

### 4. Keep Murph Thin Over Codex

Do not add Murph-owned parsing of Codex local storage for normal diagnostics. Let Codex App Server `thread/resume` be the authoritative probe.

Allowed diagnostics are metadata-only:

- native resume attempted
- native resume refused
- route fingerprint match or mismatch
- live state included Codex state
- Codex-home file and byte contribution to live state
- resume override keys present
- invalid-resume fallback used
- checkpoint mode and bundle class

Never log raw prompts, message bodies, raw thread ids, secrets, local paths, provider headers, or Codex home contents.

### 5. Thin App-Server Resume Params Later

Do not make resume-param thinning block or obscure the `.codex-hosted` live-state fix. Ship live-state completeness first, then change ordinary app-server resume params only after focused Codex app-server compatibility tests.

Change ordinary app-server resume construction so it does not reinterpret the persisted Codex thread under current model/provider settings.

Review and test these fields:

- `model`
- `modelProvider`
- `sandbox`
- `approvalPolicy`
- `reasoningEffort`
- refreshed instructions
- `cwd`
- `excludeTurns`

Default posture:

- new threads receive the configured model/provider/runtime options
- ordinary resume passes only the thread id plus fields Codex truly requires
- instruction refresh and route migration are explicit modes, not the ordinary resume path
- explicit migration, if ever needed, is a separate mode with separate tests and observability

`config.toml` rewriting is part of hosted runtime preparation, not assistant continuity. The implementation must either prove that rewriting runtime config does not reinterpret a matching persisted thread on ordinary resume, or refuse native resume before invoking Codex when route/config fingerprints differ.

### 6. Keep `resumeRouteId`

Do not add `resumeConfigFingerprint` now. Instead:

- clarify in comments/docs that `resumeRouteId` is the resume config gate
- strengthen tests that model/provider/runtime changes refuse native resume
- add metadata-only logs that say "resume route fingerprint matched" or "resume route fingerprint mismatched"

The hosted `.codex-hosted` consistency problem is not solved by adding another config fingerprint; it is solved by live state completeness.

`resumeRouteId` is not a complete proof of provider-home compatibility. It does not cover Codex binary changes, Codex storage-schema changes, or future snapshot-filter mistakes. Those risks should be surfaced through metadata-only diagnostics and covered by snapshot/restore tests and app-server resume refusal/fallback behavior.

### 7. Add A Publish-Time Completeness Guard

Before publishing any checkpoint that can advance assistant resume state, validate the checkpoint shape:

- if assistant state includes Codex resumable session state, the same checkpoint must include filtered provider-local Codex session continuity, or
- a hot checkpoint must fall back to a complete full/base snapshot, or
- the publish must fail without advancing the durable workspace ref.

Do not publish a checkpoint that combines newer Murph session state with old or missing Codex home state.

Define "Codex resumable session state" with a typed assistant-session check where possible: parse assistant session JSON, look for `resumeState.providerSessionId` or legacy top-level `providerSessionId`, and treat malformed candidate session JSON as fail-closed. Do not use a broad text search as the long-term guard.

Define "Codex home continuity present" as filtered provider session/rollout state, not any `.codex-hosted` file. A bundle containing only generated config is incomplete for native resume.

## Proof Tests

Add deterministic tests for the core invariants:

1. Live state completeness:
   - create assistant session live state containing a Codex `providerSessionId`
   - create matching `.codex-hosted` state
   - snapshot live state
   - read the produced live bundle bytes, not just the checkpoint ref
   - assert the live bundle includes filtered operator-home Codex state

2. Opaque provider home advances:
   - base snapshot has an old opaque `.codex-hosted` file set
   - a successful resumed provider run changes `.codex-hosted` while `providerSessionId` remains unchanged
   - live state snapshot and production restore preserve the changed provider home

3. Clear-before-overlay:
   - base snapshot has old `.codex-hosted` files
   - live state has newer `.codex-hosted` files
   - restore through the production `restoreHostedWorkspaceRuntimeJobWorkspace` path
   - assert old base-only Codex files are gone, not merely overwritten

4. Incomplete hot restore:
   - base snapshot has old `.codex-hosted` files
   - legacy live state has assistant `providerSessionId` but no Codex provider session continuity
   - production restore rejects the live overlay instead of mixing newer Murph resume state with older base Codex home

5. Full/base completeness:
   - full/base snapshot containing assistant resume state but no provider-local Codex session continuity refuses to publish
   - config-only `.codex-hosted` does not satisfy the guard

6. Route resume gate:
   - same model/provider/runtime config keeps native resume enabled
   - model change disables native resume
   - model provider change disables native resume
   - execution driver, resume kind, sandbox, approval policy, profile, Codex home option, or command changes disable native resume
   - hosted config rewriting does not silently reinterpret a mismatched existing thread

7. Thin resume params:
   - ordinary resume omits model/provider overrides
   - ordinary resume omits sandbox/approval/reasoning/instruction overrides unless Codex requires them or an explicit refresh path is active
   - new thread still receives configured runtime options
   - update existing tests that currently assert override fields on ordinary resume

8. Invalid-resume fallback:
   - force `input.N.output: Invalid input` on native resume
   - fallback creates a fresh thread
   - the fresh id is not durably checkpointed without matching `.codex-hosted`
   - layered restore can resume the fresh thread

9. Budget fallback:
   - make live Codex-home state exceed live-state budget
   - assert checkpointing falls back to full/base snapshot or refuses to publish
   - assert it never publishes a layered ref that omits `.codex-hosted` while preserving Codex `providerSessionId`

10. Filter parity:
   - prove full/base and live snapshots use one shared `.codex-hosted` filter
   - cover representative Codex files plus sensitive, cache, log, and process-local exclusions
   - avoid asserting Codex rollout/session layout semantics outside the optional real Codex test

11. Optional real Codex round trip:
   - create a real Codex App Server thread in an isolated Codex home
   - include structured tool output in the persisted thread
   - live snapshot and restore the Codex home plus stored thread id
   - resume by stored id
   - verify no `input.N.output: Invalid input` failure

Keep the real Codex round trip opt-in if it depends on local Codex binaries or provider credentials.

## Rollout Plan

1. Add metadata-only diagnostics around resume decisions, resume override keys, live-state Codex inclusion, and Codex-home live-state size contribution.
2. Add failing tests for live state missing `.codex-hosted`, stale base files surviving overlay, and budget fallback dropping provider home state.
3. Add `operatorHomeRoot` support to live state snapshots and include filtered `.codex-hosted` whenever hosted Codex has a Codex home directory.
4. Reuse the same `.codex-hosted` filter and diagnostics for full/base and live snapshots.
5. Add clear-before-overlay restore semantics for `operator-home/.codex-hosted`.
6. Add a publish-time completeness guard so no checkpoint can advance Murph session state without matching Codex provider-local continuity.
7. Reject legacy incomplete hot overlays during restore instead of mixing them with base Codex home state.
8. Keep invalid-resume fresh-thread fallback as a guarded temporary recovery path.
9. After durability is proven, thin ordinary app-server resume params behind focused compatibility tests.
10. Deploy and watch for:
   - live state includes Codex state when native resume is active
   - no resume override keys on ordinary resume except allowed fields
   - route fingerprint mismatch starts a fresh thread
   - invalid-resume fallback drops toward zero
   - no resumed-turn `input.N.output` failures

## Non-Goals

- Do not fork or patch Codex.
- Do not duplicate Codex history in Murph.
- Do not add a separate Codex checkpoint taxonomy.
- Do not move assistant runtime semantics into hosted web DB tables as part of this fix.
- Do not store user-facing memory in assistant runtime state.
- Do not log raw Codex ids, prompts, message bodies, secrets, provider headers, local paths, or Codex home contents.

## Open Questions

- What exact `.codex-hosted` filter is needed for safe Codex resume while avoiding logs and other sensitive or bulky files?
- Which app-server resume params are truly required by Codex on resume?
- Does hosted `config.toml` rewriting affect persisted Codex thread metadata on resume? This is a required compatibility proof before resume-param thinning, not a blocker for live-state completeness.
- What is the live state size impact once filtered `.codex-hosted` is included?
- Can the current shared `.codex-hosted` filter be safely tightened without breaking Codex resume across versions?
- Should live bundles grow an explicit manifest (`ownsAssistantHotPaths`, `ownsCodexHome`, `providerContinuityIds`, `baseSnapshotHash`) so restore ownership is not inferred from bundle contents?
- Separate reliability issue: non-idempotent outbox sends can be suppressed if a crash lands after a pre-send `sending` checkpoint but before provider delivery. This should get its own focused plan so the Codex continuity fix does not hide a side-effect fencing bug.
Updated: 2026-05-05
Completed: 2026-05-05
