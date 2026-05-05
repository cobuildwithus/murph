# Codex Continuity Architecture Plan

Date: 2026-05-05
Status: Final implementation plan

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

## Target Invariants

1. **Live state is complete.**
   If live state includes assistant runtime state with `providerSessionId`, it also includes the Codex local state needed to resume that id.

2. **Codex owns Codex history.**
   Murph does not parse, rebuild, repair, or normalize Codex rollout history as part of normal operation.

3. **Restore is replace-then-overlay for live-owned roots.**
   If live state includes `.codex-hosted`, restore clears the corresponding restored `.codex-hosted` root before overlaying live state. Stale base files must not survive beside newer live files.

4. **Route identity remains the config-change gate.**
   Reuse `resumeRouteId`; do not add a duplicate persisted config fingerprint yet. The route id already fingerprints provider, execution driver, resume kind, model, model provider, reasoning effort, sandbox, approval policy, profile, Codex home option, and Codex command.

5. **Ordinary resume is thin.**
   A normal `thread/resume` should pass the Codex thread id and only the runtime fields Codex actually requires. Model/provider overrides should not be sent by default. Sandbox, approval, reasoning, and instruction refresh should also be reviewed as possible resume-context override leaks.

6. **Fallback cannot split continuity.**
   If invalid-resume recovery starts a fresh Codex thread, the fresh `providerSessionId` cannot become durable without the matching `.codex-hosted` state in the same live state snapshot.

## Implementation Plan

### 1. Treat `.codex-hosted` as Live Assistant State

Update the live state snapshot contract so it includes filtered `.codex-hosted` whenever Codex native resume is enabled or assistant session state can contain a Codex `providerSessionId`.

This is not a new checkpoint type. It is making the existing live state snapshot complete for the assistant runtime state it already preserves.

### 2. Add Clear-Before-Overlay Restore

Before applying a live state snapshot that contains `.codex-hosted`, clear the restored `.codex-hosted` root from the base snapshot. Then overlay the live copy.

This matters because Codex may scan local state. A base snapshot's old files must not remain after live state replaces the Codex home.

### 3. Keep Base Snapshots Off The Response Path

Do not force full/base snapshots after every assistant reply as the default long-term fix. The response-path checkpoint should remain a small live state snapshot.

Full/base snapshots remain for:

- initial full backups
- maintenance and compaction
- fallback if live state exceeds budget or cannot be written safely

### 4. Keep Murph Thin Over Codex

Do not add Murph-owned parsing of Codex local storage for normal diagnostics. Let Codex App Server `thread/resume` be the authoritative probe.

Allowed diagnostics are metadata-only:

- native resume attempted
- native resume refused
- route fingerprint match or mismatch
- live state included Codex state
- resume override keys present
- invalid-resume fallback used
- checkpoint mode and bundle class

Never log raw prompts, message bodies, raw thread ids, secrets, local paths, provider headers, or Codex home contents.

### 5. Thin App-Server Resume Params

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
- explicit migration, if ever needed, is a separate mode with separate tests and observability

### 6. Keep `resumeRouteId`

Do not add `resumeConfigFingerprint` now. Instead:

- clarify in comments/docs that `resumeRouteId` is the resume config gate
- strengthen tests that model/provider/runtime changes refuse native resume
- add metadata-only logs that say "resume route fingerprint matched" or "resume route fingerprint mismatched"

The hosted `.codex-hosted` consistency problem is not solved by adding another config fingerprint; it is solved by live state completeness.

## Proof Tests

Add deterministic tests for the core invariants:

1. Live state completeness:
   - create assistant session live state containing a Codex `providerSessionId`
   - create matching `.codex-hosted` state
   - snapshot live state
   - assert the live bundle includes the filtered Codex home state

2. Same thread id advances:
   - base snapshot has `.codex-hosted` state for thread `T` at version 1
   - a successful resumed turn advances `.codex-hosted` to version 2 while `providerSessionId` remains `T`
   - live state snapshot and restore preserve version 2

3. Clear-before-overlay:
   - base snapshot has old `.codex-hosted` files
   - live state has newer `.codex-hosted` files
   - restore must not leave old base-only Codex files behind

4. Route resume gate:
   - same model/provider/runtime config keeps native resume enabled
   - model change disables native resume
   - model provider change disables native resume
   - execution driver, resume kind, sandbox, approval policy, profile, Codex home option, or command changes disable native resume

5. Thin resume params:
   - ordinary resume omits model/provider overrides
   - ordinary resume omits sandbox/approval/reasoning/instruction overrides unless Codex requires them or an explicit refresh path is active
   - new thread still receives configured runtime options

6. Invalid-resume fallback:
   - force `input.N.output: Invalid input` on native resume
   - fallback creates a fresh thread
   - the fresh id is not durably checkpointed without matching `.codex-hosted`
   - layered restore can resume the fresh thread

7. Optional real Codex round trip:
   - create a real Codex App Server thread in an isolated Codex home
   - include structured tool output in the persisted thread
   - live snapshot and restore the Codex home plus stored thread id
   - resume by stored id
   - verify no `input.N.output: Invalid input` failure

Keep the real Codex round trip opt-in if it depends on local Codex binaries or provider credentials.

## Rollout Plan

1. Add metadata-only diagnostics around resume decisions, resume override keys, and live-state Codex inclusion.
2. Add failing tests for live state missing `.codex-hosted` and for stale base files surviving overlay.
3. Include filtered `.codex-hosted` in live state when Codex native resume is enabled.
4. Add clear-before-overlay restore semantics for `.codex-hosted`.
5. Thin ordinary app-server resume params.
6. Keep invalid-resume fresh-thread fallback as a guarded temporary recovery path.
7. Deploy and watch for:
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
- Does hosted `config.toml` rewriting affect persisted Codex thread metadata on resume, even after RPC model/provider overrides are removed?
- What is the live state size impact once filtered `.codex-hosted` is included?
- Should live state inclusion of `.codex-hosted` be unconditional for hosted Codex, or conditional on a session containing resumable Codex state?
