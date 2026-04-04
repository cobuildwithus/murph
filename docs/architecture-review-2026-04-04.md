# Architecture review - 2026-04-04

This pass focused on the current hosted runner seam, shared health-registry command metadata, and the hosted device-sync web control plane.
The goal was to reduce ownership drift and blast radius without weakening Murph's file-native or canonical-write constraints.

## 1. Split hosted runner bundle sync from hosted user env and verified-sender routing (landed)

- **Files / symbols:** `apps/cloudflare/src/user-runner/runner-bundle-sync.ts` (`RunnerBundleSync.readUserEnv`, `RunnerBundleSync.updateUserEnv` before this patch), `apps/cloudflare/src/user-runner.ts` (`HostedUserRunner.ensureRunnerStores`, `HostedUserRunner.getUserEnvStatus`, `HostedUserRunner.updateUserEnv`, `HostedUserRunner.invokeRunner`, `readUserEnvSource`), `apps/cloudflare/src/hosted-email/routes.ts` (`ensureHostedEmailVerifiedSenderRouteAvailable`, `reconcileHostedEmailVerifiedSenderRoute`).
- **Current cost / risk:** one class named `RunnerBundleSync` owned three different concepts: bundle-ref compare-and-swap, hosted user-env persistence, and hosted verified-sender route invariants. Its `userEnvSource` constructor input also stood in for two unrelated sources of truth: the allowed user-env key policy and the operator-owned hosted email config. That widened the blast radius for bundle changes and made hosted email upkeep look like a bundle concern.
- **Simpler target shape:** keep bundle bytes, bundle refs, and artifact cleanup in `RunnerBundleSync`; move hosted user-env reads/writes plus verified-sender route upkeep into a dedicated `RunnerUserEnvService` with explicit `allowedUserEnvSource` and `hostedEmailConfig` inputs.
- **Incremental refactor path:** this patch lands the first slice: `runner-user-env.ts` now owns hosted user-env persistence and verified-sender route upkeep, `RunnerBundleSync` is bundle-only again, and `HostedUserRunner` wires the two services from explicit sources.
- **Main risk if done poorly:** user-env writes and verified-sender route reconciliation can drift apart. The safe shape is one service that owns both the stored env write and the route-side effect with the same bucket and key material.

## 2. Stop restating health registry method stems where contracts already own the nouns (landed)

- **Files / symbols:** `packages/contracts/src/health-entities.ts` (registry `noun` / `plural` ownership), `packages/assistant-core/src/health-registry-command-metadata.ts` (`healthRegistryCommandDerivationByKind`, `buildHealthRegistryCommandMetadata`), `packages/assistant-core/src/health-cli-descriptors.ts` (`getHealthRegistryCommandMetadata` consumer), `packages/cli/src/commands/health-entity-command-registry.ts` (descriptor consumer).
- **Current cost / risk:** `healthRegistryCommandDerivationByKind` restated the singular method stem, plural method stem, and status label for each registry kind even though contracts already own the singular and plural nouns. Adding or renaming a registry kind forces touching contracts plus assistant-core's parallel method-stem table.
- **Simpler target shape:** let contracts continue owning the registry nouns and plurals, then derive the CLI/query/runtime method stems and status labels mechanically from those shared nouns. Keep only the genuinely irregular override surface local, such as `protocol`'s `upsertProtocolItem` runtime method.
- **Incremental refactor path:** this patch removes the duplicated method-stem and status-label entries from `healthRegistryCommandDerivationByKind` and derives them from the shared contract nouns/plurals inside `buildHealthRegistryCommandMetadata`.
- **Main risk if done poorly:** generated method names can drift from the stable runtime/query method surface. Any follow-up should preserve the existing method-name contract and add focused tests before deleting the last override table.

## 3. Shrink `HostedUserRunner` into a thinner Durable Object shell over a focused dispatch processor (not landed)

- **Files / symbols:** `apps/cloudflare/src/user-runner.ts` (`HostedUserRunner.runQueuedEvents`, `HostedUserRunner.invokeRunner`, `HostedUserRunner.recoverCommittedPendingDispatchAndCleanup`, `HostedUserRunner.applyHostedTransition`, `HostedUserRunner.deleteTransientDispatchDataBestEffort`), `apps/cloudflare/src/user-runner/runner-queue-store.ts`, `apps/cloudflare/src/user-runner/runner-commit-recovery.ts`.
- **Current cost / risk:** `HostedUserRunner` is both the Durable Object API surface and the full event-processing engine. One class owns queue claiming, retry policy, commit recovery, scheduler updates, gateway projection snapshots, runtime invocation, and transient cleanup. That makes boundary tests expensive and turns many hosted execution changes into edits inside one very large orchestration seam.
- **Simpler target shape:** keep `HostedUserRunner` as the request and Durable Object boundary, but move one-pending-dispatch execution into a focused processor that receives explicit dependencies (`queueStore`, `scheduler`, `commitRecovery`, `gatewayStore`, `bundleSync`, `userEnv`, runtime invocation). That would make the ordered state machine easier to test without booting the whole Durable Object facade.
- **Main risk if done poorly:** commit ordering, retry scheduling, or cleanup sequencing could drift and break Murph's hosted durability guarantees. Any split must preserve the current "commit before final bundle swap / side-effect resume" ordering.

## 4. Replace the hosted device-sync control-plane "manager" facade with a smaller request-scoped surface (not landed)

- **Files / symbols:** `apps/web/src/lib/device-sync/control-plane.ts` (`HostedDeviceSyncControlPlane`), `apps/web/src/lib/device-sync/agent-session-service.ts`, `apps/web/src/lib/device-sync/public-ingress-service.ts`, `apps/web/src/lib/device-sync/webhook-admin-service.ts`, and the route handlers under `apps/web/app/api/device-sync/**`.
- **Current cost / risk:** `HostedDeviceSyncControlPlane` mostly forwards to three concrete services while also owning auth/origin helpers and request-scoped memoization. The facade hides ownership and makes route modules depend on a broad manager surface even when they only need one narrow service.
- **Simpler target shape:** create a small request-scoped factory that returns explicit surfaces such as `{ auth, agentSessions, publicIngress, webhookAdmin }`, with memoized request auth/context creation but without the extra proxy layer. Routes would then import the seam they actually use.
- **Main risk if done poorly:** browser-origin checks, request auth caching, or request-bound context creation could fragment across routes. The split is only worth doing if the auth and context invariants stay centralized.
