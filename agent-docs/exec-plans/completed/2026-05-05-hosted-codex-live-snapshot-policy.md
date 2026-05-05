# Hosted Codex Live Snapshot Policy

## Goal

Change hosted live/hot state snapshots so `.codex-hosted` is treated as opaque provider continuity state: when `operatorHomeRoot/.codex-hosted` exists, include the safe filtered tree in `liveStateSnapshot` / hot-state snapshots.

## Scope

- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `packages/runtime-state/README.md`
- Hosted runtime docs if the behavior wording needs adjustment.

## Constraints

- Keep the shared Codex-home safety denylist for auth, OAuth, token, credential, cookie, env-like, cache, tmp, log, history, lock, pid, socket, cert, and private-key material.
- Do not depend on assistant session file shape to decide whether `.codex-hosted` belongs in hot/live snapshots.
- Preserve the invariant that provider resume state must not be snapshotted without matching Codex provider continuity.
- Preserve unrelated dirty work in the checkout.

## Status

- Current implementation found in `packages/runtime-state/src/hosted-bundles.ts`: `snapshotHostedAssistantRuntimeHotState` only includes `.codex-hosted` after scanning assistant session files for provider resume state.
- Updating the policy to include safe filtered `.codex-hosted` whenever the hosted Codex home exists.

## Verification Plan

- Focused runtime-state hosted bundle tests.
- `pnpm typecheck` unless blocked by unrelated dirty work.
- Security/privacy review for denylist and diagnostics behavior.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
