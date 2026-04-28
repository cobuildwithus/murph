# `@murphai/runtime-state`

Workspace-private shared runtime-state helpers for Murph packages that need explicit local state
next to a vault without turning that state into canonical product truth.

## Scope

- root `@murphai/runtime-state` exports the worker-safe hosted email/env/loopback helpers plus pure hosted bundle identity types/equality used by shared contracts
- `@murphai/runtime-state/assistant-ids` exports shared assistant opaque-id normalization/validation for contract schemas and assistant runtime file-path guards
- `@murphai/runtime-state/node` exports hosted bundle codec/materialization helpers plus the local filesystem, process, assistant runtime state, `.runtime` path, JSON-state versioning, and SQLite migration helpers used by Node-backed callers
- narrow `@murphai/runtime-state/node/*` subpaths expose hosted-safe Node helpers such as assistant-usage parsing, hosted bundle codecs, loopback bearer auth, runtime path constants, SQLite warning filters, and ULID helpers without forcing callers through the broad `./node` barrel
- runtime-state aggregates small per-subsystem descriptor manifests for operational path classification and non-assistant hosted-snapshot portability instead of relying on one central hard-coded allowlist, including assistant, inbox, device-sync, parser, query, gateway-local, and write-operation owners
- keep inbox, query, CLI, assistant-runtime, and other local runtime packages aligned on one explicit Node-only owner surface instead of letting each package invent its own local-state layout

## Local-state taxonomy

Inside the vault, `.runtime/**` is now split by durability/rebuildability and by portability:

- `.runtime/operations/**`: durable local operational state. Paths in this bucket default to `machine_local` and must be classified explicitly before they can travel in hosted snapshots. Current portable examples include canonical write-operation receipts and inbox promotion ledgers; current machine-local examples include device-sync runtime state, daemon state/logs, inbox daemon config/state, and parser toolchain overrides.
- `.runtime/projections/**`: rebuildable local projections and indexes such as inbox capture indexes, the query-owned canonical read/search projection, and the gateway source-backed projection store. These are `machine_local`.
- `.runtime/cache/**` and `.runtime/tmp/**`: ephemeral scratch state that may be deleted freely. These are `machine_local`.

`vault/.runtime/operations/assistant/**` is the assistant runtime residue root. Hosted execution treats this root as runtime continuity by default so Cloudflare can stay a thin runner over the local assistant runtime. Assistant descriptors still document/audit known files, but new assistant continuity files do not need a descriptor to survive hosted checkpoint/restore. The hosted denylist stays small and safety-oriented: assistant secrets, quarantine/repair payloads, locks, pid/socket files, temp lock files, global `.runtime/cache/**`, `.runtime/tmp/**`, and rebuildable `.runtime/projections/**` stay out of hosted workspace snapshots. Assistant diagnostics, journals, status snapshots, cron run logs, outbox state, receipts, sessions, transcripts, usage rows, failover state, and mailbox/runtime continuity files move with the encrypted hosted workspace.

That assistant runtime root is intentionally not a product-state incubator. If a datum is user-facing, queryable, or something future product features will build on, it belongs in canonical `vault/**` or explicit `derived/**` materializations, not under assistant runtime.

## Contract

- canonical user truth stays in `vault/**`; local runtime state must never become the canonical store of health facts
- assistant runtime under `vault/.runtime/operations/assistant/**` is execution residue only and must not silently grow user-facing product state
- every durable local JSON store should carry an explicit schema/schemaVersion envelope
- every durable local SQLite store should carry an explicit `PRAGMA user_version` migration seam
- hosted execution snapshots canonical `vault/**`, assistant runtime continuity under `vault/.runtime/operations/assistant/**` except explicit unsafe/process-local exclusions, non-assistant runtime-state paths explicitly marked `portable`, and the minimal operator-home hosted config needed for bootstrap; they do **not** snapshot device-sync control/token stores, inbox daemon config/state, parser toolchain overrides, rebuildable projections, caches, tmp state, assistant secrets, quarantine/repair payloads, locks, pid files, or sockets
- hosted execution also treats incur CLI config autodiscovery as local-only convenience: `~/.config/murph/config.json` is not part of the hosted bundle contract, and hosted assistant/provider turns explicitly opt out of reading it
- non-assistant operational portability lives in subsystem descriptor manifests aggregated by `@murphai/runtime-state`; unknown non-assistant operational paths still fail closed to `machine_local`
- large raw artifacts under `vault/raw/**` may be externalized into separate encrypted content-addressed objects and restored back onto disk during hosted execution
- hosted per-user env overrides live in a separate encrypted object and are not folded into the workspace snapshot
- downstream packages should consume these helpers instead of inventing their own per-package runtime path conventions or versioning schemes
