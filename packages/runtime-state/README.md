# `@murph/runtime-state`

Shared runtime-state helpers for Murph packages that need rebuildable
machine-local storage next to a vault.

## Scope

- resolve canonical `.runtime` paths relative to a vault root
- provide shared SQLite defaults for local runtime stores
- keep inbox, query, device-sync, and CLI runtime paths aligned
- share pure device-sync control-plane transport helpers used by the CLI and web wrappers
- reserve `.runtime/device-syncd/` for CLI-owned daemon launcher state and local logs

## Contract

- runtime state under vault `.runtime/**` is local-only and rebuildable
- hosted `agent-state` snapshots do not bundle vault `.runtime/**`; they keep only sibling `assistant-state` data plus the minimal operator-home hosted config needed for explicit `member.activated` bootstrap, while hosted per-user env overrides live in a separate encrypted object
- canonical health truth never moves into `.runtime`
- downstream packages should consume these helpers instead of inventing their
  own per-package runtime path conventions
