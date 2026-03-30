# Murph architecture review — 2026-03-30

This review is grounded in the code in:

- `packages/contracts`
- `packages/core`
- `packages/query`
- `packages/cli`
- `packages/web`
- `apps/web`
- `apps/cloudflare`

It focuses on current data-model ownership, package boundaries, internal APIs, and code structure rather than style-only cleanup.

## Changes included in this patch

### 1. Shared registry helper extraction

The same registry helper logic was implemented independently in both:

- `packages/contracts/src/health-entities.ts`
- `packages/contracts/src/bank-entities.ts`

The duplicated logic covered relation-target extraction and projected supplement ingredient normalization. This patch extracts that shared behavior into:

- `packages/contracts/src/registry-helpers.ts`

and rewires both callers to consume the same implementation.

### 2. Shared health-history invariant source

The set of health-history event kinds was represented independently in:

- `packages/contracts/src/health-entities.ts`
- `packages/core/src/history/types.ts`
- `packages/query/src/canonical-entities.ts`
- `packages/query/src/health/projections.ts`

This patch introduces a single shared source of truth in:

- `packages/contracts/src/constants.ts` via `HEALTH_HISTORY_EVENT_KINDS`

and updates core/query/contracts consumers to derive from that shared contract.

Those two changes are intentionally small, low-risk simplifications that reduce drift without changing Murph's file-native or canonical-write boundaries.

## Recommendations

### 1. Split canonical entity definitions from query and CLI wiring

**Seam**

- `packages/contracts/src/health-entities.ts`
  - `HealthEntityRegistryMetadata.command`
  - `HealthEntityRegistryMetadata.transform`
  - `healthEntityDefinitions`
- `packages/query/src/health/registries.ts`
  - `createBankEntityRegistryDefinition`
- `packages/cli/src/health-cli-descriptors.ts`
  - `buildSharedStatusFilteredRegistryDescriptorExtension`
  - `checkedHealthEntityDescriptorExtensions`

**Current complexity cost**

`packages/contracts` is carrying more than canonical contracts. It currently owns:

- canonical filesystem/schema facts (`directory`, `idField`, `frontmatterSchema`, `upsertPayloadSchema`)
- query projection behavior (`transform`, `sortBehavior`)
- CLI method-name wiring (`runtimeMethod`, `runtimeShowMethod`, `listServiceMethod`, etc.)

That centralizes metadata, but it also widens the blast radius of change. Adding or renaming one entity capability can force edits in the contracts package even when the change is read-model- or CLI-specific. The type casts in `health-cli-descriptors.ts` are a sign that the ownership boundary is stretched: the CLI is consuming contract metadata that is already partially shaped for a different layer.

**Simpler target shape**

Keep `packages/contracts` authoritative for canonical facts only:

- ids
- directories
- frontmatter/payload schemas
- relation keys
- stable scaffold examples if you want them public

Move read-model projection behavior into query-owned adapters, and move command/runtime method wiring into CLI-owned adapters. The shared join key should just be `kind`.

**Incremental refactor path**

1. Introduce a new query-owned map such as `packages/query/src/health/registry-projectors.ts` keyed by `HealthEntityKind | BankEntityKind`.
2. Introduce a new CLI-owned map such as `packages/cli/src/health-command-definitions.ts` keyed by `HealthEntityKind`.
3. Switch `health-cli-descriptors.ts` and `health/registries.ts` to compose shared canonical definitions plus layer-local adapters.
4. Remove `command` and `transform` from contract definitions only after all consumers are off them.

**Main risk if done poorly**

If the split is rushed, Murph could end up with the same field list duplicated in contracts, query, and CLI with no guardrail against drift. The migration should preserve one shared canonical definition and layer-local overlays, not three disconnected copies.

### 2. Replace health-backed bank casts with a generic registry primitive

**Seam**

- `packages/contracts/src/bank-entities.ts`
  - `checkedBankEntityDefinitions`
  - `HEALTH_BANK_ENTITY_KINDS`
  - `requireHealthEntityRegistryDefinition(kind) as unknown as BankEntityDefinition`
- `packages/contracts/src/health-entities.ts`
  - `HealthEntityDefinition`
  - `HealthEntityDefinitionWithRegistry`

**Current complexity cost**

The bank layer currently absorbs health-backed entities through an `as unknown as BankEntityDefinition` cast. That works today because the structures are similar, but it hides an important ownership fact: Murph does not really have two independent registry-definition systems here. It has one underlying registry concept represented by two nominal types.

That cast weakens compiler help exactly where you want it most: on the boundary that decides which entities participate in generic bank readers.

**Simpler target shape**

Define a single generic registry primitive in contracts, then build:

- `HealthEntityDefinition` from it
- `BankEntityDefinition` from it

without casts. The difference should be the allowed `kind` set, not an alternate structural model.

**Incremental refactor path**

1. Introduce a generic base such as `RegistryEntityDefinition<TKind>` in contracts.
2. Re-express `HealthEntityDefinition` and `BankEntityDefinition` as narrow aliases over that base.
3. Replace the `as unknown as BankEntityDefinition` cast with a helper that narrows known health-backed bank kinds.
4. Only then simplify the health/bank definition arrays.

**Main risk if done poorly**

A broad generic rewrite can easily fan out into dozens of incidental type changes. Keep the first step narrow: remove the cast and preserve existing runtime behavior.

### 3. Break the assistant turn runner into explicit phases

**Seam**

- `packages/cli/src/assistant/service.ts`
  - `sendAssistantMessageLocal`
  - `resolveAssistantTurnRoutes`
  - `resolveAssistantRouteTurnPlan`
  - `persistUserTurn`
- adjacent collaborators:
  - `packages/cli/src/assistant/delivery-service.ts`
  - `packages/cli/src/assistant/turn-finalizer.ts`
  - `packages/cli/src/assistant/provider-turn-recovery.ts`
  - `packages/cli/src/assistant/status.ts`

**Current complexity cost**

`sendAssistantMessageLocal` owns too many responsibilities in one control path:

- turn locking
- session resolution
- shared-plan construction
- route selection and failover
- receipt creation
- diagnostics
- user-turn persistence
- provider execution and recovery
- usage persistence
- artifact finalization
- outbound delivery
- failure cleanup
- status refresh

That makes the assistant surface harder to test and harder to extend safely. Small behavior changes can ripple across unrelated steps because the orchestration function is the real unit of behavior.

**Simpler target shape**

Keep `service.ts` as the external facade, but have it call an explicit turn pipeline with phase-owned modules:

- `resolveAssistantTurn`
- `executeAssistantTurn`
- `persistAssistantTurn`
- `deliverAssistantTurn`
- `finalizeAssistantTurn`

Each phase should accept and return one durable state object rather than reaching into ambient session/input state ad hoc.

**Incremental refactor path**

1. Extract pure planning and normalization helpers first, without changing public APIs.
2. Introduce a single `AssistantTurnContext` object passed across phases.
3. Move receipt/diagnostic writes behind phase helpers so success/failure semantics stay centralized.
4. Keep `sendAssistantMessageLocal` as a thin coordinator until tests are stable, then shrink it further.

**Main risk if done poorly**

The assistant path is full of idempotency-sensitive side effects. A sloppy extraction could double-write receipts, lose failure diagnostics, or break provider failover recovery. Preserve the existing write ordering as an explicit invariant during the refactor.

### 4. Make the query read model single-sourced instead of parallel-shaped

**Seam**

- `packages/query/src/model.ts`
  - `VaultReadModel`
  - `ALL_VAULT_RECORD_TYPES`
  - `readVaultWithHealthMode`
- downstream consumers:
  - `packages/query/src/overview.ts`
  - `packages/query/src/export-pack.ts`
  - `packages/web/app/page.tsx`

**Current complexity cost**

`VaultReadModel` represents the same underlying records multiple ways at once:

- `entities`
- `records`
- `byFamily`
- per-family arrays like `goals`, `conditions`, `protocols`, `history`, `foods`, `recipes`, `providers`, `workoutFormats`, `profileSnapshots`, and `currentProfile`

That shape is convenient for callers, but it means every new record family or field evolution can ripple through:

- the `VaultReadModel` interface
- `ALL_VAULT_RECORD_TYPES`
- read-model construction
- overview/export helpers
- tests that assert both family maps and per-family arrays

**Simpler target shape**

Make one representation authoritative:

- `recordsByFamily` (or `byFamily`) for grouped access
- `records` for ordered access

Then layer convenience selectors on top instead of storing duplicate arrays inside the model object itself.

**Incremental refactor path**

1. Add selector helpers such as `selectVaultRecords(vault, "goal")` and `selectCurrentProfile(vault)`.
2. Move internal query/web callers to those selectors.
3. Deprecate the parallel arrays from `VaultReadModel` once call sites are migrated.
4. Keep `records` and `byFamily` as the canonical query surface.

**Main risk if done poorly**

If selector semantics do not exactly match today's stored arrays, consumers can see subtle ordering or nullability changes. Preserve current sort and fallback behavior in the new selectors before removing fields.

### 5. Thin `canonical-entities.ts` to an envelope module plus family projectors

**Seam**

- `packages/query/src/canonical-entities.ts`
  - `CanonicalEntity`
  - `resolveCanonicalRecordClass`
  - `collapseEventLedgerEntities`
  - `projectAssessmentEntity`
  - `projectProfileSnapshotEntity`
  - `fallbackCurrentProfileEntity`
  - `projectCurrentProfileEntity`
  - `projectHistoryEntity`
  - `projectRegistryEntity`
- companion readers:
  - `packages/query/src/health/entity-slices.ts`
  - `packages/query/src/health/current-profile-resolution.ts`
  - `packages/query/src/model.ts`

**Current complexity cost**

`canonical-entities.ts` is carrying four distinct jobs:

- the canonical envelope type
- family classification and comparators
- ledger-collapse semantics for history events
- family-specific projectors, including synthetic current-profile projection

That is a classic "useful shared module" becoming the default home for unrelated behavior. Because so many downstream paths import it, any change in one projector increases the retest surface for search, overview, timeline, export, and health readers.

**Simpler target shape**

Keep one thin module for shared entity envelope utilities:

- `CanonicalEntity`
- link helpers
- comparators
- record-class resolution

Move projector logic beside the family that owns it, for example:

- `health/projectors/assessment.ts`
- `health/projectors/history.ts`
- `health/projectors/profile.ts`
- `health/projectors/registry.ts`

**Incremental refactor path**

1. Move one projector at a time while keeping re-exports from `canonical-entities.ts`.
2. Move history ledger collapse next to history projection.
3. Move current-profile fallback/projection next to `current-profile-resolution.ts`.
4. Once imports are stable, reduce `canonical-entities.ts` to a true shared-kernel module.

**Main risk if done poorly**

Splitting by file without preserving shared comparators can change ordering or dedupe behavior. Keep comparison and collapse helpers centralized until projector moves are finished.

### 6. Keep hosted execution payload semantics fully inside `@murph/hosted-execution`

**Seam**

- `packages/hosted-execution/src/outbox-payload.ts`
- `packages/hosted-execution/src/dispatch-ref.ts`
- `apps/web/src/lib/hosted-execution/outbox-payload.ts`
- `apps/web/src/lib/hosted-execution/hydration.ts`
- `apps/cloudflare/src/runner-outbound.ts`

**Current complexity cost**

The hosted execution package already owns the payload and dispatch-ref contracts, which is good. But the fallback semantics and storage decisions are still spread across app/web and cloudflare call sites. Even where wrappers are thin, the operational meaning of a payload is not completely encapsulated in one place.

That makes the hosted lane more fragile than it needs to be: adding a new event kind or storage mode can ripple through contract parsing, hydration logic, and worker execution.

**Simpler target shape**

`@murph/hosted-execution` should own:

- payload/ref schema versions
- storage selection
- parse/build helpers
- the minimal fallback object shape needed to recover a reference payload

`apps/web` should mostly adapt Prisma JSON types, and the worker should mostly consume already-normalized payloads.

**Incremental refactor path**

1. Move the fallback/ref normalization shape into `@murph/hosted-execution`.
2. Collapse `apps/web/src/lib/hosted-execution/outbox-payload.ts` to casts plus package calls.
3. Introduce one shared hydration-normalization helper before changing worker call sites.

**Main risk if done poorly**

Any mismatch in payload fallback behavior can strand queued hosted events that were already persisted under the old format. Compatibility with existing rows matters more than elegance here.

## Overall assessment

Murph's core architectural invariants are mostly intact:

- canonical writes still flow through core
- the vault remains file-native
- hosted state is still operational rather than canonical
- query remains read-only over canonical material

The main risk is not a broken macro-architecture. It is concept spread inside otherwise-good boundaries:

- contracts knowing too much about query and CLI wiring
- query returning too many parallel shapes for the same records
- assistant orchestration concentrating too much behavior in one facade
- small duplicated invariants surviving across packages because they are "close enough"

The best next wave is therefore not a rewrite. It is a sequence of ownership-tightening refactors that reduce duplicated concepts and narrow the blast radius of change.
