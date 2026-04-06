# `@murphai/runtime-state`

Shared runtime-state helpers for Murph packages that need explicit local state
next to a vault without turning that state into canonical product truth.

## Scope

- root `@murphai/runtime-state` exports the worker-safe hosted email/env/loopback/id helpers plus pure hosted bundle identity types/equality used by shared contracts
- `@murphai/runtime-state/node` exports hosted bundle codec/materialization helpers plus the local filesystem, process, assistant-state, `.runtime` path, JSON-state versioning, and SQLite migration helpers used by Node-backed callers
- keep inbox, query, CLI, assistant-runtime, and other local runtime packages aligned on one explicit Node-only owner surface instead of letting each package invent its own local-state layout

## Local-state taxonomy

Inside the vault, `.runtime/**` is now split by durability and rebuildability:

- `.runtime/operations/**`: durable local operational state such as inbox daemon config/state, parser toolchain config, and local device-sync tokens/cursors
- `.runtime/projections/**`: rebuildable local projections and indexes such as inbox capture indexes, lexical search, and the gateway serving store
- `.runtime/cache/**` and `.runtime/tmp/**`: ephemeral scratch state that may be deleted freely

Sibling `assistant-state/**` remains durable but non-canonical assistant/session state that intentionally stays outside `vault/**`.

Legacy flat paths such as `.runtime/search.sqlite`, `.runtime/gateway.sqlite`, `.runtime/inboxd.sqlite`, `.runtime/device-syncd.sqlite`, `.runtime/inboxd/**`, and `.runtime/parsers/**` are still read and are promoted forward automatically when the owning runtime next opens them.

## Contract

- canonical user truth stays in `vault/**`; local runtime state must never become the canonical store of health facts
- every durable local JSON store should carry an explicit schema/schemaVersion envelope
- every durable local SQLite store should carry an explicit `PRAGMA user_version` migration seam
- hosted execution snapshots canonical `vault/**`, hostable durable local operational state, sibling `assistant-state/**`, and the minimal operator-home hosted config needed for bootstrap; they do **not** snapshot rebuildable projections, caches, tmp state, or local-only device-sync control/token stores that already have a separate hosted control plane
- large raw artifacts under `vault/raw/**` may be externalized into separate encrypted content-addressed objects and restored back onto disk during hosted execution
- hosted per-user env overrides live in a separate encrypted object and are not folded into the workspace snapshot
- downstream packages should consume these helpers instead of inventing their own per-package runtime path conventions or versioning schemes
