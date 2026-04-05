# Architecture review — 2026-04-05

This review focuses on the current data model, package boundaries, internal APIs, and code structure in the hosted web layer plus the shared health registry seam.

## Landed in this patch

### 1. Split generic hosted agent-session lifecycle from device-sync token orchestration

**Seam:**
- `apps/web/src/lib/device-sync/agent-session-service.ts#HostedDeviceSyncAgentSessionService`
- `apps/web/src/lib/device-sync/control-plane.ts#HostedDeviceSyncControlPlane`
- `apps/web/src/lib/linq/control-plane.ts#HostedLinqControlPlane`
- `apps/web/src/lib/hosted-agent-sessions.ts#HostedAgentSessionService`

**Current complexity cost:**
`HostedDeviceSyncAgentSessionService` previously owned two different concerns at once:
1. generic bearer session lifecycle (`requireAgentSession`, `createAgentSession`, `revokeAgentSession`, session rotation)
2. device-sync-specific runtime/token behavior (`exportTokenBundle`, `refreshTokenBundle`, `recordLocalHeartbeat`, signal pagination)

That forced Linq to depend on a device-sync-named service and a device-sync provider registry just to pair an agent and validate its bearer. It also hard-coded the device-sync pair route into generic auth failures, so the same agent-session invariant was represented with device-sync wording even on `/api/linq/*` routes.

**Target shape:**
Keep a small neutral hosted session seam for bearer lifecycle and let device-sync compose it for token/runtime work. This patch introduces `HostedAgentSessionService` as the shared owner of:
- bearer parsing and validation
- session creation
- revocation
- rotation

`HostedDeviceSyncAgentSessionService` now composes that service and keeps only device-sync-specific behavior around connection state, token refresh, token export, and local heartbeat updates.

**Main risk if done poorly:**
If the split drifts the auth error codes, session TTL, or rotation semantics, existing agents can get stranded or start rotating against inconsistent invariants. The shared session service has to stay byte-for-byte compatible on token hashing, expiry, and revoke/replace flow.

### 2. Promote webhook receipts to a neutral hosted-web API boundary

**Seam:**
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-*`
- `apps/web/src/lib/hosted-execution/hydration.ts#hydrateHostedExecutionDispatchFromWebhookReceipt`
- `apps/web/src/lib/linq/control-plane.ts#runWebhookWithReceipt`
- `apps/web/src/lib/hosted-webhook-receipts.ts`

**Current complexity cost:**
Webhook receipts already carry work for more than onboarding: Linq control-plane ingress and hosted execution hydration both depend on them. But those callers previously reached directly into `hosted-onboarding/webhook-receipt-*`, which makes onboarding look like the owner of a broader hosted runtime primitive.

That widens blast radius: changing receipt internals for onboarding could silently break Linq ingress or hosted execution rehydration, and the import graph hides that these are now shared hosted-runtime semantics rather than onboarding-only helpers.

**Target shape:**
Expose a neutral `hosted-webhook-receipts` boundary and make non-onboarding callers import that shared seam instead of onboarding internals. This patch does that without rewriting receipt storage or behavior.

**Main risk if done poorly:**
A superficial re-export seam can become misleading if the real ownership never moves and the API keeps leaking onboarding-only concepts. The next step should keep the new neutral entrypoint stable while pulling implementation details toward a true shared hosted runtime area.

## Deferred but high leverage

### 3. Pull hosted request auth/origin/bootstrap out of device-sync context

**Seam:**
- `apps/web/src/lib/device-sync/auth.ts`
- `apps/web/src/lib/device-sync/control-plane-context.ts#createHostedDeviceSyncControlPlaneContext`
- `apps/web/src/lib/linq/control-plane.ts#requireAuthenticatedUser`
- `apps/web/src/lib/linq/control-plane.ts#assertBrowserMutationOrigin`

**Current complexity cost:**
Linq still boots its authenticated request handling through the device-sync control-plane context for env, nonce-backed auth, and allowed return origins. The earlier agent-session split reduces one dependency, but Linq still conceptually enters the system through a device-sync-named bootstrap path.

**Target shape:**
Introduce a neutral hosted request context that owns authenticated member resolution, browser origin assertions, nonce storage, and shared environment reads. Device-sync and Linq should both depend on that neutral context instead of one feature borrowing the other’s setup layer.

**Main risk if done poorly:**
This seam is security-sensitive. A sloppy extraction could weaken origin validation, break browser assertion nonce consumption, or accidentally merge feature-specific env knobs that should stay isolated.

### 4. Push more registry projection metadata upstream from query, but stop before contracts become a read-model dump

**Seam:**
- `packages/contracts/src/health-entities.ts`
- `packages/query/src/health/bank-registry-query-metadata.ts#bankRegistryQueryMetadataByKind`
- `packages/query/src/health/registries.ts#createBankEntityRegistryDefinition`
- `packages/assistant-core/src/health-registry-command-metadata.ts#buildHealthRegistryCommandMetadata`

**Current complexity cost:**
Murph already correctly centralizes directory/id/title/status metadata in contracts, and CLI command metadata now derives a lot from that shared taxonomy. But query still keeps a parallel per-kind projection table for read-model transforms and sort behavior. That means the same registry families are still described in multiple places even after contracts became the canonical taxonomy owner.

**Target shape:**
Keep contracts as the owner of cross-layer registry shape and move only the truly shared projection metadata upstream:
- shared relation aliases
- sort behavior when it is intrinsic to the entity family
- simple attribute passthrough lists that do not encode query-only policy

Leave query-specific denormalization and search behavior in query.

**Main risk if done poorly:**
Pushing too much into contracts would invert the dependency and turn contracts into a read-model kitchen sink. The right move is to upstream only metadata that is already mechanically shared across core/query/CLI, not query-only output shaping.

### 5. Move contact privacy and phone normalization behind a shared hosted identity/privacy seam

**Seam:**
- `apps/web/src/lib/hosted-onboarding/contact-privacy.ts`
- `apps/web/src/lib/hosted-onboarding/phone.ts`
- `apps/web/src/lib/linq/control-plane.ts`
- `apps/web/src/lib/linq/prisma-store.ts`
- `apps/web/src/lib/hosted-share/*`

**Current complexity cost:**
Phone normalization, opaque identifiers, and storage-safe contact minimization are not just onboarding concerns anymore, but the current module names still imply they are. Linq and hosted share both reach into onboarding for privacy and identity primitives.

**Target shape:**
Extract a shared hosted identity/privacy module that owns phone normalization, lookup-key derivation, opaque identifier generation, and storage-safe contact/event minimization. Keep onboarding-specific membership and invite policy on its current side of the boundary.

**Main risk if done poorly:**
This seam protects privacy and key-derivation behavior. Any move has to preserve exact key material, deterministic lookup behavior, and existing redaction/minimization rules, or previously stored records can become unreadable or inconsistent.
