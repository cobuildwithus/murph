# `@murph/runtime-state`

Shared runtime-state helpers for Murph packages that need rebuildable
machine-local storage next to a vault.

## Scope

- resolve canonical `.runtime` paths relative to a vault root
- provide shared SQLite defaults for local runtime stores
- keep inbox, query, and CLI runtime paths aligned
- reserve `.runtime/device-syncd/` for CLI-owned daemon launcher state and local logs

## Contract

- runtime state under vault `.runtime/**` is local-only and rebuildable
- hosted execution now snapshots one encrypted workspace bundle in the `vault` slot: canonical `vault/**`, durable `vault/.runtime/**`, sibling `assistant-state/**`, and the minimal operator-home hosted config needed for explicit `member.activated` bootstrap
- large raw artifacts under `vault/raw/**` may be externalized into separate encrypted content-addressed objects and restored back onto disk during hosted execution
- hosted per-user env overrides live in a separate encrypted object and are not folded into the workspace snapshot
- canonical health truth never moves into `.runtime`
- downstream packages should consume these helpers instead of inventing their
  own per-package runtime path conventions
