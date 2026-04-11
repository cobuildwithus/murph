# Data Model Seams

Last verified: 2026-04-09

## Implemented in this patch

### 1. Keep automation schedule/route/status ownership in contracts

**Seam:** `packages/contracts/src/automation.ts`, `packages/core/src/automation.ts`, `packages/query/src/automation.ts`, `packages/cli/src/commands/automation.ts`

The automation schedule, route, status, continuity-policy, schema-version, and doc-type shapes were being restated in four places.
That made one product concept look local to each layer even though the contract package already owns the canonical write shape.

This patch:

- reuses `AUTOMATION_SCHEMA_VERSION`, `AUTOMATION_DOC_TYPE`, `automationStatusValues`, `automationContinuityPolicyValues`, and `automationScheduleKindValues` from `packages/contracts/src/automation.ts`
- reuses the contract `AutomationSchedule`, `AutomationRoute`, `AutomationStatus`, `AutomationContinuityPolicy`, and `AutomationScaffoldPayload` types in `packages/core/src/automation.ts`
- reuses the same contract types/constants in `packages/query/src/automation.ts`
- reuses `automationRouteSchema`, `automationScheduleSchema`, `automationScaffoldPayloadSchema`, and the shared status/continuity enums in `packages/cli/src/commands/automation.ts`

**Why this is simpler:** the contract layer is again the single owner of the automation model, while core/query/CLI keep only the layer-local normalization and presentation concerns.

**Main refactor risk:** if future changes move layer-specific semantics into the shared contract types without care, core/query could lose their friendlier error handling and normalized read-model behavior.
The model owner should stay shared; the parsing UX can stay local.

### 2. Keep hosted email send request parsing with the request shape owner

**Seam:** `packages/assistant-runtime/src/hosted-email.ts`, `apps/cloudflare/src/runner-outbound/results.ts`

`HostedEmailSendRequest` lived in `packages/assistant-runtime/src/hosted-email.ts`, but the Cloudflare runner carried a second hand-written parser for the same request shape.
That split ownership of one transport record across two packages.

This patch adds `parseHostedEmailSendRequest` and `hostedEmailSendTargetKindValues` to `packages/assistant-runtime/src/hosted-email.ts` and removes the duplicate parser from `apps/cloudflare/src/runner-outbound/results.ts`.

**Why this is simpler:** the sender-facing package now owns both the request type and its boundary parser, so one more request field does not require copy/paste validation logic downstream.

**Main refactor risk:** do not let this helper start absorbing Cloudflare-specific auth or route policy; it should stay a pure payload parser.

### 3. Keep assessment response record ownership in contracts

**Seam:** `packages/contracts/src/zod.ts`, `packages/core/src/assessment/types.ts`

`packages/core/src/assessment/types.ts` restated `AssessmentResponseRecord` even though the contracts package already exports the canonical record type.

This patch aliases the core type to the contract type instead of keeping a second copy.

**Why this is simpler:** the write model no longer has two nominal owners for the same persisted record shape.

**Main refactor risk:** `packages/core/src/assessment/storage.ts` still partially reconstructs the record around `assessmentResponseSchema` instead of letting the contract parser own the full persisted object.
If that cleanup is attempted later, do it after confirming there is no persisted data depending on the looser `relatedIds` handling there.


### 4. Keep assistant CLI contract ownership in operator-config

**Seam:** `packages/operator-config/src/assistant-cli-contracts.ts`, `packages/assistant-engine/src/assistant-cli-contracts.ts`, `packages/assistant-engine/src/assistant/channels/{types,helpers,registry}.ts`

`packages/assistant-engine/src/assistant-cli-contracts.ts` had drifted into a full second copy of the assistant CLI contract surface even though `packages/operator-config/src/assistant-cli-contracts.ts` already owned that model.
The assistant channel layer also repeated delivery-kind unions locally instead of using the contract-owned types.

This patch:

- turns `packages/assistant-engine/src/assistant-cli-contracts.ts` into a pure compatibility re-export of `@murphai/operator-config/assistant-cli-contracts`
- switches assistant channel types/helpers/registry to `AssistantChannelDeliveryTargetKind` and `AssistantBindingDeliveryKind` instead of restating string unions locally

**Why this is simpler:** operator-config is again the only real owner of the assistant delivery contract model, while assistant-engine keeps the old import path as a thin legacy shim.

**Main refactor risk:** do not add new engine-only contract fields back onto the shim file.
If the legacy path still needs to exist, it should stay a re-export, not a fork.

### 5. Keep gateway delivery target kinds owned by gateway-core where the same route semantics are reused

**Seam:** `packages/gateway-core/src/contracts.ts`, `packages/gateway-core/src/local-runtime.ts`, `packages/gateway-core/src/routes.ts`, `packages/assistant-runtime/src/hosted-email.ts`

The same outbound delivery-target semantics (`explicit`, `participant`, `thread`) and binding kinds (`participant`, `thread`) were being restated in gateway-local runtime records, gateway route helpers, and assistant-runtime hosted email parsing.
Those are all the same routing concept, but not all of them were pointing back at the gateway owner types.

This patch:

- reuses `GatewayDeliveryTargetKind` in `packages/gateway-core/src/local-runtime.ts`
- reuses `GatewayReplyRouteKind` for the internal route helper inputs in `packages/gateway-core/src/routes.ts`
- reuses `gatewayDeliveryTargetKindValues` / `GatewayDeliveryTargetKind` in `packages/assistant-runtime/src/hosted-email.ts`

**Why this is simpler:** one more outbound target kind can now flow through gateway-local runtime and hosted email request parsing without hand-updating multiple literal unions.

**Main refactor risk:** gateway-core should stay the owner only for the shared route-kind vocabulary.
Do not pull hosted-execution side-effect policy or channel-specific send rules into that package just to chase total dedupe.

### 6. Keep workout unit preferences owned by the canonical preferences document

**Seam:** `packages/contracts/src/preferences.ts`, `packages/core/src/preferences.ts`, `packages/vault-usecases/src/usecases/workout-measurement.ts`

The hard cut removed the old profile snapshot surface. Machine-facing defaults now live in one narrow canonical preferences document, while workout flows consume that document through a thin usecase adapter instead of inventing a second owner.

**Why this is simpler:** contracts own the persisted shape, core owns canonical reads and writes, and workout/usecase code only translates that data into operator-facing measurement behavior.

**Main refactor risk:** keep this surface narrow. If future user-facing narrative context needs to be stored, put it in memory or the wiki instead of widening the preferences document into a new profile substitute.

### 7. Keep workout as a workflow façade over explicit primitive record families

**Seam:** `packages/core/src/domains/events.ts`, `packages/assistant-engine/src/usecases/workout.ts`, `packages/assistant-engine/src/usecases/workout-measurement.ts`, `packages/assistant-engine/src/usecases/workout-import.ts`, `packages/cli/src/commands/workout.ts`

`workout` is a useful operator-facing namespace, but it was acting as though it owned one persistence model even though the durable records were already split across `activity_session`, `body_measurement`, and saved `workout_format` documents.
That showed up most clearly in the write path: meals already had a dedicated core mutation seam, while workout sessions and measurements were assembled in assistant-engine and then pushed through the generic event upsert surface.

This patch keeps `workout` as the user-facing workflow surface while moving session and measurement persistence down into explicit core-owned primitive mutations:

- `packages/core/src/domains/events.ts` now owns `addActivitySession()` and `addBodyMeasurement()`
- those primitive seams stage workout/measurement attachments and manifests inside the same canonical write that appends the event ledger entry
- `packages/assistant-engine/src/usecases/workout.ts`, `workout-measurement.ts`, and `workout-import.ts` now build typed drafts and delegate to those primitive seams instead of staging attachments or calling generic event upsert directly
- the CLI `workout` namespace stays intact, but it is now clearly a façade over the primitive record families instead of a hidden persistence owner

**Why this is simpler:** the durable models stay small and composable, while the operator surface still gets one coherent `workout` namespace. Session writes, measurement writes, and raw attachment staging now each have one canonical owner.

**Main refactor risk:** do not respond to this cleanup by inventing one larger `Workout` record family. That would collapse a useful boundary: templates/defaults, session events, and body measurements have different storage semantics even when they belong to the same workflow surface.

### 8. Keep bank registry projection ownership in contracts

**Seam:** `packages/contracts/src/bank-entities.ts`, `packages/query/src/health/bank-registry-query-metadata.ts`, `packages/query/src/health/registries.ts`

Bank registry projection metadata was still split by family.
Health-backed families already kept projection ownership in contracts, but `food`, `recipe`, `provider`, and `workout_format` still carried query-local projection definitions in `packages/query/src/health/bank-registry-query-metadata.ts`.
That made one bank-registry concept have two owners depending on entity kind.

This patch:

- adds explicit `projection` metadata for `food`, `recipe`, `provider`, and `workout_format` in `packages/contracts/src/bank-entities.ts`
- exports `BankEntityRegistryProjection*` aliases plus `getBankEntityRegistryProjectionMetadata(...)` from the contracts owner layer
- reduces `packages/query/src/health/bank-registry-query-metadata.ts` to a thin compatibility adapter over the contracts getter instead of a second metadata table
- extends `packages/query/test/health-registry-definitions.test.ts` to lock the shared-owner seam in place and adds `packages/assistant-engine/test/assistant-cli-contracts-compat.test.ts` to prove the assistant compatibility shim still forwards the exact owner exports

**Why this is simpler:** all bank registry families now follow one ownership rule.
Adding or reshaping a bank projection no longer requires remembering whether that family lives in contracts or query.
The query package goes back to owning projection application rather than projection definition.

**Main refactor risk:** do not let the contracts projection metadata start absorbing query-only presentation concerns.
The shared owner should describe stable read-model extraction from frontmatter, not package-specific sorting or presentation behavior beyond what multiple consumers genuinely share.

### 9. Keep hosted member identity, routing, and billing slices nested at the onboarding composition seam

**Seam:** `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`, `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`, `apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts`, `apps/web/src/lib/hosted-onboarding/stripe-revnet-issuance.ts`, `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`, `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`

The hosted-member privacy split introduced separate identity, routing, and billing-reference tables, but `HostedMemberAggregate` in `hosted-member-store.ts` immediately flattened those slices back into one wide object.
That recreated the old coupling shape in memory: adding or changing one field on any slice widened the read model used by Stripe, RevNet, and webhook orchestration even when those callers only needed one slice.

This patch:

- replaces the flattened `HostedMemberAggregate` with a nested `HostedMemberSnapshot` made of `{ core, identity, routing, billingRef }`
- updates Stripe billing, RevNet issuance, and webhook orchestration to read through the owning slice instead of through a re-widened helper
- adds one focused activation-dispatch helper in `stripe-billing-policy.ts` so the only real cross-slice composition stays explicit
- adds a hosted-web test that locks in the non-flattening snapshot shape

**Why this is simpler:** the privacy split now stays visible at the main onboarding composition seam.
Identity changes no longer imply a billing-shaped type update, routing changes no longer widen RevNet callers, and orchestration code has to name which slice it depends on.

**Main refactor risk:** do not respond by adding a second layer of generic selectors that hides the slice ownership again.
Small task-specific composition helpers are fine, but the shared store surface should keep returning nested slice owners rather than another compatibility aggregate.

### 10. Keep `vault-usecases` query runtime as a thin compatibility adapter over `@murphai/query`

**Seam:** `packages/vault-usecases/src/query-runtime.ts`, `packages/vault-usecases/src/runtime.ts`, `packages/query/src/index.ts`

`packages/vault-usecases/src/query-runtime.ts` was still restating the query read model even though `@murphai/query` already owned the canonical entity, read-model, search, projection-status, timeline, export-pack, and wearable-summary shapes.
That made one query concept look local to the CLI/usecase layer again even though the package already loads the shared query runtime dynamically.

This patch:

- exports the shared search result/filter types from `packages/query/src/index.ts`
- aliases `QueryCanonicalEntity`, `QueryVaultReadModel`, `QuerySearch*`, `QueryProjection*`, `QueryTimeline*`, and `QueryExportPack*` in `packages/vault-usecases/src/query-runtime.ts` back to the shared `@murphai/query` owner types
- reduces `QueryRuntimeModule` to a `Pick<typeof import("@murphai/query"), ...>` view over the shared runtime surface instead of a second hand-written function contract
- adds `packages/vault-usecases/test/query-runtime.test.ts` to prove the compatibility layer forwards the shared owner exports directly

**Why this is simpler:** `vault-usecases` keeps the optional-runtime loader seam it actually needs, but stops owning a second nominal copy of the query model.
Adding one more query field now flows from the real query owner through the CLI/usecase layer without a parallel type-edit pass.

**Main refactor risk:** keep the adapter limited to runtime loading and narrow naming compatibility.
Do not let `vault-usecases` start reaching into query internals or reintroducing narrower local copies just to preserve older field subsets.

### 11. Keep knowledge result contracts owned by `@murphai/query`, with assistant/CLI as thin adapters

**Seam:** `packages/query/src/knowledge-contracts.ts`, `packages/query/src/index.ts`, `packages/assistant-engine/src/knowledge/{documents.ts,service.ts}`, `packages/assistant-engine/src/knowledge.ts`, `packages/cli/src/knowledge-cli-contracts.ts`

The query package already owned the stable knowledge read model, but result contracts were still split across assistant-engine and CLI-local schemas.
That made one shared product contract drift across multiple packages even though the assistant and CLI layers already depend on the query runtime.

This patch:

- keeps one shared `Knowledge*` contract owner in `packages/query/src/knowledge-contracts.ts` and exports it from the public query entrypoint
- removes the old `packages/operator-config/src/knowledge-contracts.ts` compatibility shim and its public export so operator-config no longer surfaces query-owned knowledge result contracts
- removes the old `packages/assistant-engine/src/knowledge/contracts.ts` compatibility shim and has assistant-engine import query-owned result types directly
- keeps assistant-engine's knowledge service, document helpers, and public barrel on the query-owned result contracts
- keeps `packages/cli/src/knowledge-cli-contracts.ts` as a thin compatibility schema surface that re-exports the query-owned schemas and aliases `KnowledgeShowResult` to the shared `KnowledgeGetResult`

**Why this is simpler:** query is now the only real owner of the knowledge result model, while assistant-engine and CLI keep only thin boundary seams.
Adding or renaming a knowledge result field now has one type owner instead of multiple parallel copies.

**Main refactor risk:** do not move CLI-only help text or command ergonomics into query just because the schemas are now shared there.
The shared owner should stay on the reusable product record shape; presentation concerns can stay local.

### 12. Keep Linq chat binding writes with the routing owner

**Seam:** `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`, `apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts`, `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`

`persistHostedMemberLinqChatBinding(...)` lived in `member-identity-service.ts` even though the mutation was a straight pass-through to `upsertHostedMemberLinqChatBinding(...)` in the routing store.
That made the identity slice look like it owned a messaging-routing write path again after the hosted-member privacy split.

This patch removes the identity-service wrapper and has the Linq webhook planner call the routing-store owner directly.

**Why this is simpler:** Linq chat binding writes now sit with the routing owner, so identity changes no longer widen the import surface for routing flows.

**Main refactor risk:** if future Linq binding writes need workflow-specific validation or retries, add that seam under a routing-owned service instead of drifting the mutation back into identity.

### 13. Narrow hosted assistant-delivery journal APIs to the only effect they serve today

**Seam:** `packages/hosted-execution/src/side-effects.ts`, `packages/assistant-runtime/src/hosted-runtime/{platform,callbacks}.ts`, `apps/cloudflare/src/{runtime-platform.ts,runner-outbound/results.ts,side-effect-journal.ts}`

The hosted runner's read/delete journal path still carried a generic `kind` query parameter and a generically named Cloudflare journal store even though the only supported effect kind is `assistant.delivery`.
The assistant runtime and Cloudflare worker were already specialized to assistant delivery in practice, but the internal API still looked multi-kind.

This patch adds assistant-delivery-specific parser/type aliases at the shared owner, narrows the assistant-runtime effects port to assistant-delivery records, removes the redundant `kind` query parameter from the internal read/delete route, and renames the Cloudflare journal store/error surface to assistant-delivery-specific names.

**Why this is simpler:** the current hosted journal no longer pretends to compose arbitrary side-effect families. One effect kind is represented once in the payload itself instead of also being repeated in the internal route contract and journal query surface.

**Main refactor risk:** if a second durable side-effect family appears later, reintroduce a real multi-kind route contract intentionally instead of copy-pasting `kind` parameters back across the stack.

### 14. Finish collapsing assistant delivery target vocabulary to the gateway route owner

**Seam:** `packages/gateway-core/src/contracts.ts` (`gatewayDeliveryTargetKindValues`, `gatewayReplyRouteKindValues`), `packages/operator-config/src/assistant-cli-contracts.ts` (`assistantChannelDeliveryTargetKindValues`, `assistantBindingDeliveryKindValues`), `packages/hosted-execution/src/side-effects.ts` (`hostedAssistantDeliveryTargetKindValues`, `HostedAssistantDeliveryReceipt.targetKind`)

The same delivery-target vocabulary was still being owned in three places even after the earlier gateway cleanup: gateway-core, operator-config, and hosted-execution all carried their own copy of `explicit | participant | thread` or `participant | thread`.
That meant one more delivery target or reply-route variant would still need coordinated literal-union edits across assistant contracts, gateway routing, and hosted delivery receipts.

This landing makes `packages/gateway-core/src/contracts.ts` the single owner of that vocabulary and turns the other layers into thin aliases:

- `packages/operator-config/src/assistant-cli-contracts.ts` now reuses `gatewayDeliveryTargetKindValues`, `gatewayReplyRouteKindValues`, `GatewayDeliveryTargetKind`, and `GatewayReplyRouteKind` instead of restating the same unions
- `packages/hosted-execution/src/side-effects.ts` now reuses the same gateway-owned target-kind values and type for assistant-delivery receipts
- focused tests in `packages/operator-config/test/assistant-cli-contracts.test.ts` and `packages/hosted-execution/test/side-effects.test.ts` lock in the shared-owner seam

**Why this is simpler:** gateway-core already owns the concrete route semantics, so the rest of the stack can now consume one stable vocabulary instead of carrying parallel unions that drift independently.

**Main refactor risk:** keep the sharing limited to the route-kind vocabulary.

### 15. Keep hosted webhook receipt side-effect persistence centered on a common retry shell plus kind-owned JSON detail

**Seam:** `apps/web/prisma/schema.prisma`, `apps/web/prisma/migrations/2026040801_hosted_webhook_side_effect_json_normalization/migration.sql`, `apps/web/src/lib/hosted-onboarding/webhook-receipt-codec.ts`

`HostedWebhookReceiptSideEffect` had drifted into a wide sparse row that carried dispatch, Linq, and RevNet payload/result columns side-by-side.
That widened the Prisma model and forced the codec to reconstruct a per-kind shape from many nullable columns even though the shared retry/error shell was the only real common owner.

This patch:

- replaces the sparse per-kind columns with `payloadJson` and `resultJson` on `HostedWebhookReceiptSideEffect`
- adds an additive migration that backfills the JSON detail from the old sparse columns before dropping them
- rewrites `webhook-receipt-codec.ts` so it serializes one common retry/error shell plus kind-owned payload/result JSON detail

**Why this is simpler:** adding one more hosted webhook side effect no longer requires widening the relational row with another batch of nullable columns.
The common owner stays the retry/idempotency shell, while each effect kind owns only its detail payload/result shape.

**Main refactor risk:** do not let `payloadJson` or `resultJson` turn into a dumping ground for raw webhook bodies or cross-kind lookup fields.
Keep only the effect-specific remainder there and preserve the indexed common retry shell on the row itself.
Do not pull assistant policy, hosted callback rules, or CLI-only behavior into gateway-core just to centralize more strings.

### 15. Collapse active hosted side-effect paths to the assistant-delivery-specific surface they already use

**Seam:** `packages/hosted-execution/src/side-effects.ts`, `packages/assistant-runtime/src/hosted-runtime/{models,parsers,platform,callbacks}.ts`, `apps/cloudflare/src/{execution-journal.ts,runtime-platform.ts,runner-outbound/results.ts,side-effect-journal.ts}`

The only real hosted side effect in the live tree is still `assistant.delivery`, but assistant-runtime and Cloudflare were continuing to read and write it through generic `HostedExecutionSideEffect*` names.
That made the active path look more composable than it really is and forced maintainers to reason about a generic framework even when the product behavior was simply “track assistant delivery confirmation.”

This landing keeps the wire field names and compatibility aliases stable, but makes the assistant-delivery-specific model the primary owner again:

- `packages/hosted-execution/src/side-effects.ts` now treats assistant-delivery-specific types, comparators, and target-kind aliases as the main owner surface while leaving the generic `HostedExecutionSideEffect*` exports in place as compatibility aliases
- `packages/assistant-runtime/src/hosted-runtime/{models,parsers}.ts` now type committed side effects and resume parsing as `HostedAssistantDeliverySideEffect[]`
- `packages/assistant-runtime/src/hosted-runtime/{platform,callbacks}.ts` now prefer assistant-delivery-specific journal method names while retaining compatibility with the older generic method names
- `apps/cloudflare/src/{execution-journal.ts,runner-outbound/results.ts}` now parse committed journal payloads through `parseHostedAssistantDeliverySideEffects(...)`
- `apps/cloudflare/src/side-effect-journal.ts` now uses the assistant-delivery-specific receipt comparator

**Why this is simpler:** the active runtime path now names the one side-effect family it actually handles, while the shared hosted-execution package still keeps compatibility aliases so the refactor does not widen into a trust-boundary or transport rewrite.

**Main refactor risk:** if a second durable side-effect family appears later, re-generalize intentionally from two real cases instead of copy-pasting generic names back into one-effect code paths.

### 16. Return hosted-member lookup results from the slice that actually matched

**Seam:** `apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts`, `apps/web/src/lib/hosted-onboarding/hosted-member-billing-store.ts`, `apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts`, `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`, `apps/web/src/lib/hosted-onboarding/billing-service.ts`, `apps/web/src/lib/hosted-onboarding/stripe-billing-lookup.ts`, `apps/web/src/lib/hosted-onboarding/request-auth.ts`

The hosted-member slice stores already knew which identity, billing, or routing binding matched, but callers were discarding that slice state and immediately fanning back out into follow-up reads.
That made auth, billing, and routing flows pay an avoidable lookup-then-read tax even though the lookup owner already had the data.

This patch:

- makes identity lookups return `{ core, identity, matchedBy }` without exposing blind-index-only fields such as `phoneLookupKey`
- makes Stripe billing lookups return `{ core, billingRef, matchedBy }` and updates the bind path to return the winning billing slice instead of a bare boolean
- makes Telegram routing lookups return `{ core, routing, matchedBy }` with a narrow routing snapshot rather than a second naked member read
- teaches the composed Privy identity resolver to preserve multiple match reasons for the same member
- updates request-auth, Stripe lookup, and webhook callers to consume the nested lookup result directly instead of rereading the same slice

**Why this is simpler:** slice owners now return the matched slice and the core member together in one read, so billing, auth, and routing callers no longer need ad hoc partial snapshots or immediate follow-up reads.

**Main refactor risk:** do not answer future caller needs by reviving a wide `HostedMemberAggregate` or by leaking encrypted/blind-index columns through the lookup surface.
The seam stays healthy only if the lookup result remains nested and privacy-minimized.

### 17. Normalize hosted execution dispatch lifecycle around one cross-boundary outcome owner

**Seam:** `apps/web/prisma/schema.prisma`, `apps/web/src/lib/hosted-execution/outbox.ts`, `apps/web/src/lib/hosted-onboarding/activation-progress.ts`, `packages/hosted-execution/src/contracts.ts`, `apps/cloudflare/src/user-runner/{runner-queue-store.ts,types.ts}`, `apps/cloudflare/src/user-runner.ts`

Hosted dispatch had been translated across three overlapping models: transport-local web outbox status, Cloudflare queue presence booleans, and the shared hosted-execution outcome union.
That made web activation state and event outcome reads reason across multiple models even though only one of them should have been product-facing.

This patch:

- adds durable `dispatchState` persistence on `ExecutionOutbox` and stores the shared `HostedExecutionEventDispatchState` union there
- keeps `ExecutionOutbox.status` transport-local for queue claim/retry/handoff mechanics only
- updates web outbox finalization so payload cleanup depends on terminal shared outcomes or terminal local failures instead of `status === dispatched`
- updates activation progress to derive user-facing completion from `dispatchState` plus optional live Cloudflare status
- teaches the Cloudflare runner queue to return the shared event dispatch status directly on event-scoped reads instead of leaking raw presence booleans across the boundary

**Why this is simpler:** there is now one cross-boundary outcome vocabulary and one local transport lifecycle, so product state does not need to infer meaning from queue-local or Postgres-local mechanics.

**Main refactor risk:** keep queue-local observability and retry mechanics app-local.
If future edits collapse those back into the shared outcome union, the boundary will blur again and duplicate-pending versus duplicate-consumed semantics will get harder to preserve.

### 18. Keep device-sync wake hint subshapes with the device-sync runtime owner

**Seam:** `packages/device-syncd/src/hosted-runtime.ts`, `packages/hosted-execution/src/{contracts.ts,parsers.ts}`, `apps/web/src/lib/device-sync/hosted-dispatch.ts`

The `HostedExecutionDeviceSyncJobHint` / `HostedExecutionDeviceSyncWakeHint` record family was split across two owners.
`packages/device-syncd/src/hosted-runtime.ts` already owned the live runtime snapshot and wake-hint normalization logic, but `packages/hosted-execution/src/contracts.ts` restated the same hint records and `packages/hosted-execution/src/parsers.ts` carried a second hand-written parser.
The web signal bridge then had to cast `signalPayload` straight to `HostedExecutionDeviceSyncWakeEvent["hint"]` because there was no single boundary parser for that nested shape.

This patch:

- makes `packages/device-syncd/src/hosted-runtime.ts` the shared owner of `HostedExecutionDeviceSyncJobHint`, `HostedExecutionDeviceSyncWakeHint`, and `parseHostedExecutionDeviceSyncWakeHint(...)`
- turns the hosted-execution contract types into aliases of that device-sync owner instead of parallel interface copies
- has `packages/hosted-execution/src/parsers.ts` delegate nested wake-hint parsing to the device-sync runtime owner while keeping the outer hosted dispatch event parser in `@murphai/hosted-execution`
- replaces the raw cast in `apps/web/src/lib/device-sync/hosted-dispatch.ts` with the shared owner parser so signals, dispatch parsing, and runtime normalization now consume one hint shape

**Why this is simpler:** one more wake-hint field or job-hint attribute now lands in one device-sync owner instead of requiring coordinated edits across device-syncd, hosted-execution contracts, hosted-execution parsers, and the hosted web signal bridge.
The hosted-execution package still owns the outer dispatch event; it just stops pretending to own the device-sync-specific nested payload too.

**Main refactor risk:** keep the shared ownership limited to the nested wake-hint subshape.
Do not move hosted dispatch ids, event kinds, or transport policy into `device-syncd`, or the hosted execution boundary will blur in the other direction.

## Current targeted review findings

The notes below are the remaining review-only pass after the simplifications landed above.
They focus on the next data-model simplifications that still look highest-leverage without weakening canonical-write or trust-boundary rules.

### Worth planning

#### 1. Split hosted Stripe billing policy by responsibility before it becomes the next wide owner

**Seam:** `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts` (`activateHostedMemberFromConfirmedRevnetIssuance`, `activateHostedMemberForPositiveSource`, `updateHostedMemberStripeBillingIfFresh`, `suspendHostedMemberForBillingReversal`, `findMemberForStripeObject`, `resolveStripeCustomerContext`)

**Current cost:** one file currently owns entitlement transitions, Stripe ref lookup, canonical Stripe refresh, hosted activation dispatch building, managed-user crypto provisioning triggers, and suspension handling. That makes any change to Stripe reconciliation or activation semantics widen the blast radius across multiple responsibilities.

**Simpler target:** keep pure billing-status and freshness rules in `stripe-billing-policy.ts`, move activation/outbox orchestration beside `member-activation.ts`, and move Stripe object/member resolution into a smaller billing-ref lookup helper or store-owned seam. The current nested hosted-member snapshot shape is already good enough to support that split.

**Main refactor risk:** preserve the existing transaction boundaries, row locking, and monotonic Stripe freshness rules. A sloppy split here could accidentally reintroduce out-of-order reactivation or double-activation sends.

### Keep as-is

#### A. Keep health registry taxonomy, projection metadata, and command metadata owned by contracts

**Seam:** `packages/contracts/src/health-entities.ts`, `packages/query/src/health/registries.ts`, `packages/assistant-engine/src/health-registry-command-metadata.ts`, `packages/cli/src/commands/health-command-factory.ts`

This is one of the healthier cross-package model seams in the repo today.
Contracts own the health taxonomy and shared registry metadata; query and assistant-engine consume it through thin adapters instead of restating the same kinds and command names.

**Why keep it:** the current central owner removes drift across contracts/query/assistant/CLI without weakening trust boundaries.
It already does the thing the higher-leverage findings above still need to do.

**Main failure mode if changed poorly:** spreading these definitions back across query, assistant-engine, and CLI would recreate exactly the taxonomy drift and duplicate command metadata the repo has been paying down elsewhere.

#### B. Keep hosted execution outbox payload ownership in `@murphai/hosted-execution` with only a thin web Prisma adapter

**Seam:** `packages/hosted-execution/src/outbox-payload.ts`, `apps/web/src/lib/hosted-execution/outbox-payload.ts`

This seam is already simple and composable enough.
The hosted-execution package owns the real payload/storage model (`HostedExecutionOutboxPayload`, `buildHostedExecutionOutboxPayload`, `readHostedExecutionOutboxPayload`, canonical storage selection), while the web layer only wraps it to convert the payload into `Prisma.InputJsonObject`.

**Why keep it:** this split respects the trust boundary and avoids a second owner.
Web does not redefine inline-vs-reference payload semantics; it just adapts the shared owner to Prisma.

**Main failure mode if changed poorly:** moving the payload model back into web or letting Prisma types leak into the shared hosted-execution package would recreate a cross-layer contract fork and make Cloudflare/web rollouts harder to keep aligned.

#### C. Keep the canonical preferences document owned by contracts/core with thin workflow adapters

**Seam:** `packages/contracts/src/preferences.ts`, `packages/core/src/preferences.ts`, `packages/vault-usecases/src/usecases/workout-measurement.ts`

This seam stays intentionally narrow after the profile hard cut.
Contracts own the canonical `bank/preferences.json` document contract, core owns reading and updating that singleton, and workout-oriented usecases adapt those machine-facing defaults into unit-selection behavior.

**Why keep it:** the write boundary stays explicit and typed, while memory and wiki remain freeform human-facing surfaces instead of becoming machine-facing settings stores.

**Main failure mode if changed poorly:** widening preferences into a narrative profile replacement would blur the boundary between operator-readable context and programmatic defaults and re-create the same mixed-responsibility surface the hard cut removed.

#### D. Keep hosted execution event, builder, and parser ownership in `@murphai/hosted-execution`

**Seam:** `packages/hosted-execution/src/contracts.ts` (`HostedExecutionEvent`, `HostedExecutionDispatchRequest`), `packages/hosted-execution/src/builders.ts`, `packages/hosted-execution/src/parsers.ts`, `apps/web/src/lib/hosted-onboarding/member-activation.ts`, `apps/web/src/lib/hosted-share/shared.ts`, `apps/web/src/lib/device-sync/hosted-dispatch.ts`, `packages/assistant-runtime/src/hosted-runtime/events.ts`

This is another seam that is already simple enough.
The hosted-execution package owns the event kind vocabulary, the request shape, the shared builders, and the boundary parsers.
Web composes event ids or source-specific reason mapping around those builders, and assistant-runtime consumes the shared union in one place when it switches on dispatch kinds.

**Why keep it:** adding a new hosted dispatch event is already localized to the shared transport owner plus the layer-local handler that actually uses it.
The event model is not being restated independently in web, Cloudflare, and assistant-runtime.

**Main failure mode if changed poorly:** moving event construction or parsing back into web or assistant-runtime would recreate the exact parallel-representation drift that other review findings are trying to remove.
