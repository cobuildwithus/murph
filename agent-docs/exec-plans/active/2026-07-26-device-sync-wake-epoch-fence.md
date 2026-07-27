# Device-sync wake epoch fence

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Prevent a delayed connection-scoped device-sync wake from mutating a newer
  OAuth authorization that reused the same durable connection id.
- Preserve ordinary retry and lane ordering for wakes that still match the
  active connection epoch.

## Proven cause

- Disconnect commits a durable `device-sync.wake` carrying `connectionId` but
  no authorization epoch.
- Reconnection reuses the connection row and id while replacing `connectedAt`
  and the token version.
- Runtime snapshot hydration loads the newest authorization before applying
  the older wake, then resolves the wake by stable connection id alone.
- The resulting disconnect and token-clear update is built from the new
  snapshot, so current updated-at and token-version fences accept it.

## Constraints

- Use the already-authoritative `connectedAt` as the connection epoch; add no
  second generation column, table, queue, scheduler, or manager.
- Stamp every connection-scoped wake with the epoch it represents.
- A wake whose expected epoch differs from the hydrated account is a consumed
  superseded no-op.
- Runtime apply must independently compare its observed epoch with the current
  control-plane row so reconnect-after-hydration cannot mutate the replacement.
- Preserve provider-neutral contracts, retry semantics, and current wake lane
  ordering.
- Do not broaden this batch into stale provider-webhook job fencing.

## Approach

1. Add the expected connection epoch to the canonical device-sync wake contract
   and propagate it through builders, parsers, and runtime bridge projection.
2. Stamp connection-scoped web wake producers from the authoritative
   connection row.
3. Ignore epoch-mismatched wakes after current snapshot hydration.
4. Add `observedConnectedAt` to runtime apply updates and reject connection,
   credential, or source writes when it differs from the current row.
5. Add focused contract, web producer, runtime, and control-plane race tests.

## Verification

- Pre-fix focused runtime reproduction of disconnect-A after reconnect-B.
- Focused hosted-execution, assistant-runtime, device-syncd, and web wake/apply
  tests.
- `pnpm test:diff ...` for every changed path.
- `pnpm verify:acceptance`.
- Preliminary `completion-specialists`, parent final review, then final
  `pr-review` rounds concurrent with CI.

## Review evidence

- The focused runtime regression failed before implementation because the
  delayed disconnect wake did not become superseded after hydrating the
  replacement connection epoch.
- After implementation, the focused hosted-execution, assistant-runtime,
  device-syncd, and Web suites passed. The affected package and Web typechecks
  also passed.
- The implementation reuses `connectedAt` as the only epoch, adds no persisted
  state, and fences the wake both before local work and again before Web applies
  connection, credential, local-state, or source mutations.
- The first rollout uses a runner-first compatibility window. The new runner
  fails legacy connection-scoped hints closed after current snapshot hydration;
  Web begins emitting epoch-bearing wakes only after the exact new runner
  fingerprint is proved. This avoids inventing a mailbox-pause mechanism.

## Deployment

- This is a cross-version mailbox/runtime contract change. The implementation
  must document the compatibility window and safe Web/runner deployment order.
- No schema migration is expected because `connectedAt` already exists in both
  control-plane and local snapshots.
