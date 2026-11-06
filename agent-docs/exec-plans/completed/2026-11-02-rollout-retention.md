# Retire idle Codex resume state before checkpoints

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Goal

- Stop checkpointing native Codex rollouts for sessions idle longer than 30 days.

## Success criteria

- Idle sessions lose resume state and snapshot rollouts; active sessions retain exact bytes.
- Turn exclusion, restart convergence, old snapshot restore and fresh-thread restart pass.

## Scope

- In scope: session-store retention, idle maintenance invocation, continuity proof.
- Out of scope: query database, startup timing, native database persistence, JSONL truncation.

## Constraints

- Reuse turn lock, runtime write lock and atomic session writer. One fixed policy for all sessions.
- Local commit only through scripts/committer; no push, PR or deployment.

## Risks and mitigations

1. Retirement could race a turn or omit a still-referenced rollout.
   Mitigation: acquire the existing turn lock before the write lock; snapshot selection stays derived from saved session state.
2. A crash before checkpoint or mixed runner versions could restore old resume state.
   Mitigation: keep the existing nullable schema and replay idempotent retention after restore.

## Tasks

1. Add and run the composed idle-maintenance/snapshot regression before implementation.
2. Add the store-owned retirement operation and idle call; verify concurrency and fresh-thread behavior.
3. Run requested suites, builds/typechecks and complexity; review privacy and diff; close and commit locally.

## Decisions

- The assistant store owns policy. Snapshot selection remains unchanged and cannot invent dangling references.
- Product journeys: recent conversation preserves continuity; old conversation and one-shot session retire equally; reactivation starts fresh with canonical context still available.

## Verification

- Baseline HEAD and origin/main both `91b49c1dcd1cf087e75ed570f54621b43278d091`.
  The new composed regression failed before source edits: snapshot retained five resume threads instead of two.
- After: 506 distinct deterministic tests passed across hosted bundles (68), engine session/resume/turn-lock/transcript/recovery/thread instructions (321), instruction-only warm/cold continuity (4), and runtime idle/workspace restore (113).
- Both touched packages passed `build` and `typecheck`. `pnpm complexity:diff --base origin/main` passed with unchanged complexity debt; the existing store resolver and idle-maintenance hotspots gained no branches.
- Native App Server proof observes one thread/start, zero thread/resume calls and no resume-failure diagnostic after retirement. Active session files and rollouts stay byte-identical; repeated retention and old-checkpoint restoration converge.
- `pnpm test:assistant:live -- --test 'reports corrected canonical availability without reviving a superseded body measurement: retired idle session'` passed on gpt-6.1-sol using local subscription auth. One provider request, zero actions or canonical writes; the reply correctly distinguishes confirmed records from unavailable evidence. UX: Ready.
- Net production source: +37 lines (38 added, one removed). No new configuration, dependency, persisted field, snapshot policy or retention clock.
- Retirement runs after existing content cleanup so an optional retirement failure cannot suppress that cleanup. Failure retains the existing checkpoint/retry behavior.
- Reader skew: the unchanged base snapshot reader accepts new nullable resume records. A new runner restores old complete references and retires them on a subsequent idle pass. Rolling back cannot recover retired native conversation history; canonical memory and routing survive, and older runners stop applying retention until upgraded.
- Changelog: internal native-cache/checkpoint retention only; no public feature or measured end-to-end latency claim. No repository friction workaround was required.
- Parent review checked lock order, null-alias serialization, atomic writes, derived snapshot selection, privacy and recovery evidence. CI and PR ReviewGPT are outside the requested local-only boundary; nothing was pushed or deployed.
Completed: 2026-11-02
