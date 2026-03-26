# `@healthybob/runtime-state`

Shared runtime-state helpers for Healthy Bob packages that need rebuildable
machine-local storage next to a vault.

## Scope

- resolve canonical `.runtime` paths relative to a vault root
- resolve assistant-state queue/archive sidecar paths relative to a vault root
- provide shared SQLite defaults for local runtime stores
- keep inbox, query, device-sync, and CLI runtime paths aligned
- provide lock-safe assistant automation event queue helpers for later CLI/runtime consumers
- share pure device-sync control-plane transport helpers used by the CLI and web wrappers
- reserve `.runtime/device-syncd/` for CLI-owned daemon launcher state and local logs

## Contract

- runtime state is always local and rebuildable
- canonical health truth never moves into `.runtime`
- downstream packages should consume these helpers instead of inventing their
  own per-package runtime path conventions
