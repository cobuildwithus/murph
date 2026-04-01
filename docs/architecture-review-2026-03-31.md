# Architecture Review — 2026-03-31

Last verified: 2026-03-31

This review stays grounded in the current Murph codebase and prefers incremental simplification that preserves Murph's file-native and canonical-write boundaries.

## High leverage now

### 1. Keep contract-owned data-model primitives contract-owned all the way down

**Architectural seam:** `packages/contracts/src/constants.ts`, `packages/contracts/src/frontmatter.ts`, `packages/contracts/src/zod.ts`, `packages/core/src/bank/types.ts`, `packages/core/src/assessment/types.ts`, `packages/core/src/profile/types.ts`, `packages/core/src/history/types.ts`, `packages/core/src/types.ts`, `packages/query/src/health/shared.ts`, `packages/assistant-core/src/health-cli-method-types.ts`, `packages/assistant-core/src/usecases/record-mutations.ts`.

**Current complexity cost:** Murph currently restates the same schema ids, doc types, status lists, frontmatter shapes, and JSON helper types in multiple packages. That makes the contracts package look like only one source among several peers instead of the source of truth. The maintenance cost is not style noise; it is drift risk whenever a shared status or frontmatter field changes.

**Simpler target shape:** `@murph/contracts` owns shared domain enums, schema ids, doc-type ids, frontmatter primitives, and generic JSON types. `core`, `query`, and assistant helper layers import or type-alias those definitions instead of restating them.

**Incremental refactor path:** This patch lands the first safe slice by switching the duplicated core/query helper definitions and `packages/assistant-core/src/usecases/record-mutations.ts` onto contract-owned values and types, while explicitly deferring the broader assistant CLI service-surface JSON type tightening until a follow-up can update those call paths cleanly. Keep deleting duplicate literals in neighboring files only when the dependency still flows downward from contracts into adapters.

**Main risk if done poorly:** Pulling shared definitions from a higher-level package instead of `@murph/contracts` would create cycles and widen blast radius. The simplification only works when ownership stays low in the dependency graph.

### 2. Give hosted bundle refs one equality rule

**Architectural seam:** `packages/runtime-state/src/hosted-bundle.ts`, `apps/cloudflare/src/user-runner/types.ts`, `apps/cloudflare/src/execution-journal.ts`, `apps/cloudflare/src/bundle-gc.ts`, `packages/hosted-execution/src/contracts.ts`.

**Current complexity cost:** `HostedExecutionBundleRef` is the same hosted-state concept across runtime state, execution journaling, runner CAS, and bundle GC, but equality was implemented in three places. Two compared `hash + key + size`; one also compared `updatedAt`. That means the same invariant already had two meanings inside the hosted layer.

**Simpler target shape:** shared hosted bundle identity is `hash + key + size`; `updatedAt` is observational metadata. Call sites depend on one helper instead of open-coding the rule.

**Incremental refactor path:** This patch adds `sameHostedExecutionBundleRef` in `@murph/runtime-state` and switches the Cloudflare hosted call sites to it without changing package boundaries.

**Main risk if done poorly:** If another subsystem were secretly relying on timestamp equality for correctness, collapsing the rule would hide a real versioning problem. Keep writes keyed by content identity and use timestamps only for diagnostics, retention, or display.

## Worth planning

### 1. Split `RunnerQueueStore` by responsibility, not by ownership

**Architectural seam:** `apps/cloudflare/src/user-runner/runner-queue-store.ts`, `apps/cloudflare/src/user-runner/runner-bundle-sync.ts`, `apps/cloudflare/src/user-runner/runner-scheduler.ts`, `apps/cloudflare/src/user-runner.ts`.

**Current complexity cost:** `RunnerQueueStore` owns Durable Object schema bootstrapping, pending-event queueing, poison handling, bundle-ref compare-and-swap, run-trace normalization, state projection, and wake scheduling inputs. The problem is not that it is stateful; the problem is that too many unrelated policies change in the same file.

**Simpler target shape:** keep one Durable Object and one SQLite owner, but move queue persistence, meta-row state, run-trace storage, and bundle CAS into smaller collaborators or pure helper modules coordinated by a thin facade.

**Incremental refactor path:** first extract pure helpers and table-specific read/write functions without changing transaction shape. Once the tests are stable, move each concern behind a small store interface that still shares the same `storage.sql` owner.

**Main risk if done poorly:** over-splitting can make transaction boundaries and lifecycle ordering harder to follow than the current monolith. The Durable Object should stay the single owner even after the file gets smaller.

### 2. Narrow `gateway-local`'s dependency surface on `assistant-core`

**Architectural seam:** `packages/gateway-local/src/store.ts`, `packages/gateway-local/src/send.ts`, `packages/gateway-local/src/store/source-sync.ts`, `packages/gateway-core/README.md`, `packages/gateway-local/README.md`.

**Current complexity cost:** `gateway-local` is supposed to be the local adapter over `gateway-core`, but today it directly imports assistant session readers, outbox readers, assistant types, and the assistant delivery path. That means assistant-side model changes ripple into gateway-local even when the gateway contract itself did not change.

**Simpler target shape:** `gateway-local` depends on a tiny source-reader port for sessions/outbox and a tiny send port for outbound delivery. The default local implementation can still be backed by `assistant-core`, but the adapter surface becomes explicit.

**Incremental refactor path:** introduce small interfaces around `listAssistantSessions`, `listAssistantOutboxIntents`, and `deliverAssistantOutboxMessage`, keep the current assistant-backed defaults, and move the direct assistant imports behind those adapters one entry point at a time.

**Main risk if done poorly:** the local gateway send path could drift from assistant delivery semantics. Keep the behavior contract tested at the adapter edge.

### 3. Only dedupe assistant/query record metadata if the lazy runtime edge survives

**Architectural seam:** `packages/query/src/model.ts`, `packages/assistant-core/src/query-runtime.ts`, `packages/assistant-core/src/runtime-import.ts`.

**Current complexity cost:** record-type metadata such as `ALL_VAULT_RECORD_TYPES` appears in both query and assistant-core, which looks redundant.

**Simpler target shape:** shared static record metadata should either live in a tiny contract-only seam or remain duplicated where it preserves the lazy runtime boundary.

**Incremental refactor path:** extract only the truly static metadata if a contract-only home emerges. Do not replace assistant-core's lazy runtime loader with eager query imports just to remove one duplicated list.

**Main risk if done poorly:** importing too much of `@murph/query` directly into assistant-core would widen runtime blast radius for callers that currently rely on lazy loading.

## Keep as-is

### 1. Keep health taxonomy ownership in `@murph/contracts`

**Architectural seam:** `packages/contracts/src/health-entities.ts`, `packages/query/src/health/registries.ts`, `packages/assistant-core/src/health-cli-descriptors.ts`, `agent-docs/references/health-entity-taxonomy-seam.md`.

This seam is centralizing real shared ownership, not accidental abstraction. The current contracts-owned taxonomy keeps query and CLI-facing helpers aligned on one set of kinds, registry metadata, aliases, and scaffolds. The simplification opportunity here is to keep deleting downstream duplicate metadata, not to move taxonomy ownership out of contracts.

### 2. Keep the file-native canonical-write boundary

**Architectural seam:** `packages/core/src/public-mutations.ts`, `packages/importers/src/core-port.ts`, `packages/query/src/index.ts`.

Murph's file-native design depends on one package owning canonical writes and other packages reaching it through explicit ports or read-model layers. This boundary looks heavier than a shared in-memory domain model, but it is carrying a real trust and durability constraint and should stay.

### 3. Keep the `gateway-core` / `gateway-local` split

**Architectural seam:** `packages/gateway-core/README.md`, `packages/gateway-local/README.md`, `packages/gateway-local/src/store.ts`, `packages/gateway-local/src/send.ts`.

The package split itself is good: `gateway-core` stays transport-neutral and `gateway-local` stays the local adapter. The problem worth fixing is the width of the `gateway-local` to `assistant-core` dependency surface, not the existence of the adapter boundary.
