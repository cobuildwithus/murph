# `@murphai/runtime-state`

Shared runtime-state helpers for Murph packages that need rebuildable
machine-local storage next to a vault.

## Scope

- root `@murphai/runtime-state` exports the worker-safe hosted email/env/loopback/id helpers plus pure hosted bundle identity types/equality used by shared contracts
- `@murphai/runtime-state/node` exports the hosted bundle codec/materialization helpers plus the local-runtime filesystem, process, assistant-state, `.runtime` path, and SQLite helpers used by Node-backed callers
- keep inbox, query, CLI, assistant-runtime, and other local runtime packages aligned on one explicit Node-only owner surface
- reserve `.runtime/device-syncd/` for CLI-owned daemon launcher state and local logs

## Contract

- runtime state under vault `.runtime/**` is local-only and rebuildable
- callers must import Node-local helpers from `@murphai/runtime-state/node` instead of the root package
- hosted execution now snapshots one encrypted workspace bundle in the `vault` slot: canonical `vault/**`, durable `vault/.runtime/**`, sibling `assistant-state/**`, and the minimal operator-home hosted config needed for explicit `member.activated` bootstrap
- large raw artifacts under `vault/raw/**` may be externalized into separate encrypted content-addressed objects and restored back onto disk during hosted execution
- hosted per-user env overrides live in a separate encrypted object and are not folded into the workspace snapshot
- canonical health truth never moves into `.runtime`
- downstream packages should consume these helpers instead of inventing their
  own per-package runtime path conventions
