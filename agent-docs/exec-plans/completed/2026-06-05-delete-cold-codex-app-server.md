# Delete Cold Codex App Server Path

Created: 2026-06-05

## Goal

Delete the per-turn cold Codex app-server lifecycle from assistant-engine.

Murph should treat Codex as a reusable app-server process for the stable
assistant process identity. Assistant turns should be RPCs into that process,
not one-shot subprocess invocations that start and stop Codex per turn.

Success criteria:

- `executeCodexAppServerTurn` uses one warm process slot for hosted and
  non-hosted runtime turns.
- Two sequential turns with the same stable identity reuse one app-server
  process.
- Stable identity or config changes stop the old process and start a new one.
- Abort, malformed output, late/unknown RPC output, stale turn output, process
  exit, or failed turn cleanup poisons the warm process so the next turn starts
  fresh.
- Clean successful turns leave the process idle instead of shutting it down.
- Explicit shutdown stops the process only when the warm slot is idle; active
  turns use the turn abort/interrupt path.
- Hosted env projection and hosted runtime config remain hosted-specific.
- No new persisted state, daemon, process registry, or compatibility layer is
  introduced.

## Constraints

- Preserve the current single-slot lifecycle. Do not add a map/cache keyed by
  vault/session unless existing code proves a real multi-identity process needs
  concurrent resident Codex servers.
- Keep Codex privileged as the local app-server adapter; do not add sandbox or
  approval-policy complexity.
- Keep hosted write-fence/provider credentials scoped through existing runtime
  env/request paths. Do not broaden what is snapshotted, logged, or persisted.
- Preserve off-turn output fail-closed behavior.
- Preserve process group shutdown and parent-exit cleanup.

## Design

Use the existing `CodexAppServerProcess` as the primitive and remove the
one-shot wrapper around it.

Planned shape:

- Rename the hosted slot to a neutral warm slot:
  - `hostedWarmCodexProcess` -> `warmCodexProcess`
  - `hostedWarmCodexSlotLock` -> `warmCodexSlotLock`
  - `withHostedWarmCodexSlotLock` -> `withWarmCodexSlotLock`
  - `getOrStartHostedWarmCodexProcess` -> `getOrStartWarmCodexProcess`
  - `clearHostedWarmCodexProcessIfUnusable` -> `clearWarmCodexProcessIfUnusable`
  - `stopHostedWarmCodexAppServer` -> `stopWarmCodexAppServer`
- Rename the private assistant-engine lifecycle export subpath from
  `./hosted-codex-lifecycle` to `./codex-lifecycle`; update repo-local call
  sites instead of adding a compatibility shim.
- Build `identityDigest` for all turns, not only hosted turns. Hosted identity
  keeps the projected hosted env digest; non-hosted identity uses the resolved
  child env, command, args, Codex home config digest, and working directory.
  Delete the old unused `commandDigest` state.
- Keep prompt text, assistant session ids, and assistant turn ids out of the
  Codex child process env; they are turn request data and otherwise force
  ordinary local turns to look like process identity mismatches.
- Replace `runCodexAppServerTurn(preparedInput)` with
  `getOrStartWarmCodexProcess(preparedInput)` plus
  `runCodexAppServerTurnOnProcess(..., { keepProcessWarm: true })`, then
  collapse that boolean because warmth is no longer optional.
- On successful completion:
  - abort/interrupt means poison and stop before returning/failing
  - otherwise release the turn and leave the process idle
- On failure:
  - poison and stop the process
  - clear the slot only when the stopped/poisoned process is the current slot
- On explicit stop:
  - fail busy when the selected process is reserved or running
  - stop the current idle process and clear the slot only after stop succeeds or
    the process is known stopped, preserving current fail-closed behavior when
    shutdown cannot prove exit.
- Reserve the selected warm process while handing it to a turn, so a concurrent
  caller cannot replace or stop a just-selected process before the active turn
  binds. Overlapping direct calls fail with the existing retryable busy error
  instead of killing the in-flight turn.
- Keep provider raw events scoped to accepted/current-turn messages. Rejected
  stale warm-process messages, including stale usage events before the current
  `turn/start` response, still poison the process, but must not feed usage
  extraction or failed-turn usage recording.

## Tests

Focused assistant-engine coverage:

- Update the existing "executes Codex app-server turns" test so a successful
  non-hosted turn does not expect process shutdown.
- Add or retarget a non-hosted sequential-turn test proving the same process
  serves two turns with stable identity.
- Add a provider-path sequential-turn test proving different ordinary local
  prompts reuse one process when process identity is stable.
- Keep a direct overlap regression proving a concurrent local call receives a
  retryable busy error and does not replace/stop the active warm process.
- Add an explicit-stop regression proving direct shutdown during a running turn
  receives a retryable busy error and leaves the original turn to complete.
- Add a provider-boundary regression proving stale usage-bearing completion
  events and untagged token-usage events rejected during the next warm turn do
  not surface as failed-turn usage.
- Add reused-process event-correlation coverage for alternate current-turn id
  shapes such as `turn_id` and `data.turn_id`.
- Add reused-process dynamic-tool request tests proving untagged unsupported
  and invalid tool calls reject/poison before Murph writes an RPC response.
- Keep existing hosted warm tests and rename them where appropriate from
  "hosted warm" to "warm".
- Keep/adjust regressions for:
  - noisy hosted env changes do not restart
  - stable identity changes restart
  - config authority changes restart
  - stop hook prevents reuse
  - off-turn output stops/poisons
  - malformed output poisons
  - aborted turn later completion poisons
  - unknown RPC response poisons

Package/app boundary coverage:

- Update assistant-runtime and Cloudflare tests for the neutral lifecycle hook
  names where they cross package boundaries.
- Preserve boundary tests that keep assistant-engine lifecycle hooks off
  assistant-runtime entrypoints.

Verification target:

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff` with the full merge-base changed
  file list, including the assistant-engine files, Cloudflare call sites,
  assistant-runtime boundary tests, hosted-local-harness stub, repo boundary
  rule files, docs, and active plan/ledger files.
- `pnpm --dir packages/assistant-engine test`
- `pnpm --dir packages/hosted-local-harness test`
- `pnpm test:repo-tools`
- Add narrower direct Vitest commands during iteration as needed.

## Completion

This is a high-risk runtime lifecycle change. Required completion passes:

- security-privacy-review
- coverage-write
- deep-review
- task-finish-review

Use `scripts/finish-task` for the final scoped commit so this plan is archived
and the matching ledger row is removed.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
