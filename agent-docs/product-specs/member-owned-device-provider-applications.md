# Member-owned device provider applications

Status: proposed
Last verified: 2026-08-09

## Decision

Support Strava and the narrow class of similar providers with one Web-owned
durable primitive: a **member-owned device provider application**.

The application is the OAuth client that a provider account lets one member
create for personal use. Murph creates or recovers it inside the member's
existing authenticated Kernel browser profile, seals the client configuration
through the existing per-member SecureBox, and supplies that configuration only
to the existing device-sync boundaries that need it.

The ordinary Strava journey is:

1. The member selects **Connect Strava**.
2. The member signs into Strava and completes provider-owned MFA or CAPTCHA.
3. Murph creates or recovers the private Strava application, completes read-only
   OAuth in the same authenticated browser, and starts the existing backfill and
   polling path.
4. The member returns to the ordinary connected-source view.

The member never copies a client ID, client secret, callback domain, webhook
setting, authorization code, access token, or refresh token.

This is not a generic credential vault, browser-workflow engine, new device-sync
transport, new Cloudflare state owner, or replacement for platform OAuth,
Junction, native SDK, Apple Health, Health Connect, or archive imports.

## Existing owners and the actual gap

| Concern | Existing owner |
| --- | --- |
| Provider descriptors, routes, scopes, jobs, and config schemas | `packages/device-syncd/src/config/**` |
| Typed provider construction | `packages/device-syncd/src/config/provider-factory.ts` |
| OAuth state, callback replay, cleanup, connection commit, and initial jobs | `packages/device-syncd/src/public-ingress.ts` |
| Hosted OAuth and encrypted token persistence | `apps/web/src/lib/device-sync/prisma-store/**` |
| Same-browser hosted callback proof | `apps/web/src/lib/device-sync/hosted-connect-start.ts` and callback routes |
| Owner-bound first-party connection claims | `DeviceConnectIntent` and `apps/web/src/lib/device-sync/connect-intents.ts` |
| Browser/profile lifecycle, Managed Auth, takeover, and cleanup | `apps/web/src/lib/computer-use/**` |
| Per-member authenticated encryption | `apps/web/src/lib/hosted-crypto/secure-box.ts` |
| Per-member runtime credential transport | the signed device-sync runtime snapshot |
| Provider fetch, token refresh, reconcile, and import | `packages/device-syncd` and `packages/assistant-runtime` |
| Source cards, assistant links, and reconnect links | existing hosted connect surfaces |

The only missing durable fact is:

> Which member-owned OAuth client application, at which revision, authorizes
> this connection?

A provider application exists before an athlete connection, survives ordinary
disconnect/reconnect, may own webhook identity, and may need repair when no
active connection exists. It therefore does not belong in
`DeviceConnection.metadataJson`, a short-lived connect intent, container disk,
or ambient environment variables.

## Protected invariants

- Web remains the canonical hosted control plane for member ownership, OAuth
  state, encrypted provider-application configuration, connection tokens,
  callback admission, optional webhook admission, and deletion.
- The member's container remains the data plane that runs the existing provider,
  scheduler, token rotation, importer, and vault writes.
- Kernel remains the sole owner of provider login credentials and persistent
  browser-profile state.
- Provider-application secrets never enter model context, assistant tool output,
  member-facing URLs, ordinary metadata JSON, analytics, operational logs,
  workspace snapshots, checkpoints, or the vault.
- A group or synthetic-room runtime never receives a participant's provider
  application.
- Every OAuth callback, connection, refresh, revoke, runtime pass, and optional
  webhook is bound to one exact application ID and revision.
- Missing or stale member-owned configuration never falls back to a platform
  application or another member's configuration.
- Existing static providers, Junction routes, native SDK routes, local
  self-hosted configuration, and active legacy Strava connections keep their
  current behavior until explicitly migrated.
- V1 permits at most one nonterminal member-provisionable connection per
  `(memberId, provider)`, so a runtime never chooses between two client configs
  for the same provider.

## Scope

### In scope

- One encrypted provider-application row per personal member and provider.
- Exact application references on hosted OAuth sessions and device connections.
- One finite, checked-in Web adapter per member-provisionable provider.
- One narrowly typed product-journey field on the existing ComputerRun row.
- Reuse of `DeviceConnectIntent`, Kernel Managed Auth, the provider factory,
  shared public ingress, signed runtime snapshot, importer, and wake paths.
- Browser-captured OAuth when a provider permits a loopback redirect.
- Polling-first operation through the existing reconcile scheduler.
- Optional application-scoped webhooks only when Murph can verify provider
  authenticity.
- One contextual hosted connection resolver shared by every product surface.
- Strava v1 plus a strict future-provider admission checklist.

### Out of scope

- Arbitrary user-supplied provider credentials.
- Multiple provider applications per member/provider.
- Multiple active same-provider connections with different app credentials.
- Group-owned provider applications.
- A browser automation DSL, selector database, workflow queue, Temporal
  workflow, or setup-status machine.
- Model-authored Playwright for secret extraction.
- Provider dashboard HTML, screenshots, cookies, or browser storage persisted by
  Murph.
- Automatically converting every unavailable device into browser automation.
- Weakening webhook verification because a callback URL contains an opaque ID.
- A generic dynamic-credential refactor across every device-sync provider.

## Durable model

Add one Web-owned row:

```prisma
model DeviceProviderApplication {
  id                    String    @id
  memberId              String    @map("member_id")
  provider              String
  revision              Int       @default(1)
  configEncrypted       String    @map("config_encrypted")
  webhookSubscriptionId String?   @map("webhook_subscription_id")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  member      HostedMember        @relation(fields: [memberId], references: [id], onDelete: Cascade)
  connections DeviceConnection[]
  oauthStates DeviceOauthSession[]

  @@unique([memberId, provider])
  @@map("device_provider_application")
}
```

Add nullable exact references to the existing hosted facts:

```prisma
model DeviceConnection {
  // existing fields
  providerApplicationId       String? @map("provider_application_id")
  providerApplicationRevision Int?    @map("provider_application_revision")
  providerApplication DeviceProviderApplication?
    @relation(fields: [providerApplicationId], references: [id], onDelete: Restrict)
}

model DeviceOauthSession {
  // existing fields
  providerApplicationId       String? @map("provider_application_id")
  providerApplicationRevision Int?    @map("provider_application_revision")
  providerApplication DeviceProviderApplication?
    @relation(fields: [providerApplicationId], references: [id], onDelete: Cascade)
}
```

Add one nullable field to the existing browser-run owner:

```prisma
model HostedComputerRun {
  // existing fields
  productJourneyJson Json? @map("product_journey_json")
}
```

The existing `HostedComputerRun.metadataJson` is **not** available for this
purpose. It currently owns pause/checkpoint context and is replaced or cleared
by the existing pause, resume, expiry, and finish transitions. Overloading it
would either destroy the setup binding during Managed Auth or require every
current checkpoint transition to preserve unrelated state. The dedicated
nullable field is the smaller and safer correction: no new table, no second run
lifecycle, and no change to current checkpoint semantics.

The implementation also adds the reverse relation on `HostedMember` and the
required Prisma relation names. The application primary key already serves the
app-scoped route lookup; do not add a redundant `(provider, id)` index.

Do not persist setup status, verification timestamps, provisioner versions,
callback URLs, scope lists, API base URLs, or reconcile policy:

- setup state is derived from the real owners;
- code version is code-owned;
- insertion means the captured client identity passed strict parsing and a
  benign provider verification operation;
- callback, scopes, endpoints, and sync windows remain code-owned policy.

`webhookSubscriptionId` is nullable because secure polling is a complete v1
mode. It is persisted only after a signed-webhook path is proven and enabled.

Application IDs are random opaque IDs. A remote dashboard marker is derived
separately from a versioned, stable, server-keyed member/provider digest.
Ambiguous remote creation can therefore be recovered without exposing or
reusing the local application ID. Marker-key rotation must retain prior read
keys until existing markers have been recovered or rewritten.

### Application revision and replacement

- Revision begins at 1.
- Re-provisioning the same client ID and client secret is idempotent and keeps
  the revision.
- Client identity replacement is rejected while any linked connection is
  nonterminal. The member disconnects or explicitly abandons that connection
  before repair.
- Terminal linked rows have their application reference cleared before client
  identity is replaced.
- Replacement increments revision, clears `webhookSubscriptionId`, and expires
  unconsumed OAuth states bound to the old revision.
- Webhook-only signing material may be refreshed under the same OAuth revision;
  it clears and re-establishes subscription identity without forcing athlete
  reauthorization.
- No historical client-secret version is stored.
- An OAuth exchange already in flight may race replacement. Its provider
  instance retains old config in memory; the final locked revision check rejects
  the connection write and the existing cleanup path revokes the new token.
- Application deletion is blocked while any connection still references it.

This is simpler and safer than retargeting live tokens to new client credentials
or retaining a secret-history table.

### Product-journey contract

The server-authored `productJourneyJson` contains only:

```ts
type DeviceProviderApplicationComputerJourney = {
  schema: "murph.computer-run.product-journey.v1";
  kind: "device_provider_application_setup";
  provider: "strava";
  intentClaimHash: string;
};
```

Rules:

- Assistant-facing computer APIs cannot set or patch the field.
- One trusted Web service method creates or resumes the exact journey.
- Managed Auth pause/resume leaves the field unchanged.
- An unrelated active run is never navigated, repurposed, or destroyed.
- Finish, expiry, cancellation, and account deletion clear or delete the field
  through the existing run lifecycle.
- The fixed same-origin continuation derives its route from `kind`; the field
  never stores an arbitrary URL or path.

## Encrypted configuration

Reuse the existing per-member SecureBox with a fixed lane, scope, and strict
provider-specific parser. V1 persists only:

```ts
type StravaProviderApplicationSecret = {
  schema: "murph.device-provider-application.strava.v1";
  clientId: string;
  clientSecret: string;
  webhookSigningSecret?: string;
};
```

Authenticated encryption binds member ID, application ID, provider, table,
field, lane, scope, and purpose. Unknown fields or schema versions fail closed.

Do not persist the webhook verification token. Derive it from a Web-only HMAC
key plus application ID, provider, and revision. Neither key nor token is
serialized to the runtime.

Use purpose-specific projections:

- OAuth, refresh, revoke, and runtime provider config receive client ID and
  client secret plus code-owned provider policy.
- Webhook verification may additionally receive signing secret and stored
  subscription ID.
- Browser and assistant surfaces receive safe status fields only.

A safe read model exposes only provider, application presence, revision, webhook
mode, and timestamps. Do not add a generic Settings credential editor. Setup,
repair, disconnect, and removal belong to the existing source card and
first-party setup route.

The account-data download must omit the application row and all client metadata.
Existing connection and vault exports remain the member-facing data export;
OAuth client configuration is operational authority, not a portable health
record.

## Finite provider adapter

Browser provisioning belongs in Web, not in `packages/device-syncd`.

Keep one finite registry whose initial set is exactly `strava`. The entry owns:

- provider and connect-source identity;
- Managed Auth domain and developer-settings URL;
- fixed application marker, description, category, icon, website, and callback
  policy;
- strict checked-in Playwright for create/recover and bounded secret extraction;
- strict secret parsing;
- provider-config construction for OAuth, runtime, revoke, and optional webhook
  use;
- optional webhook setup and cleanup;
- safe provider-specific blocked-state mapping.

Do not persist selectors, scripts, or workflow definitions. Do not add a
provider-independent browser DSL before a second implementation proves a shared
piece is necessary.

Polar is evidence that the durable seam may generalize, not a v1 TypeScript
member. Polar must first land as an ordinary typed device-sync provider and
importer; only then may a provider-scoped adapter reuse this primitive.

## Resumable setup without a workflow engine

Use the existing `DeviceConnectIntent` for every app-backed start, including
starts from `/connect`. It already binds member, provider, source, target,
expiry, and one-time start. Use its bounded TTL option to align an app-backed
intent with the one-hour `HostedComputerRun` instead of adding another lease.

Add only narrow owner-bound reads after `startedAt` so the same claimed intent
can continue multi-request setup. A setup abandoned past the run/intent window
requires a new intent. Do not add a provider-setup session table.

Each setup request advances at most one bounded, idempotent external effect and
re-reads durable owners first:

1. **Intent:** validate the claimed `DeviceConnectIntent` belongs to the current
   personal member and the contextual target remains allowed.
2. **Run:** create or resume the exact `productJourneyJson` run; reject an
   unrelated active run as retryable busy.
3. **Login:** use existing Kernel Managed Auth. The member handles only login,
   MFA, or CAPTCHA.
4. **Application:** inspect the authenticated developer page. Recover the exact
   Murph marker or create it only when no app exists. Parse, verify, and seal the
   client identity, then insert or compare the application row.
5. **OAuth:** when no active connection is bound to the current application
   revision, start ordinary device-sync OAuth with exact app context and
   complete it in the same authenticated browser.
6. **Connected:** finish the existing ComputerRun and return to the ordinary
   source card while initial jobs run through the existing pipeline.
7. **Optional webhook:** after a separate real-provider proof establishes
   signing-material provenance, ensure the app-scoped subscription and persist
   its ID. This is not required for polling-first connection.

Correctness never depends on one long HTTP request. On retry, inspect provider
and Murph truth before creating an app, OAuth state, connection, or subscription.
No queue, setup-status row, compensating workflow, or background browser worker
is required.

### Trusted browser-result boundary

The Strava adapter may call a server-only helper around
`ComputerUseService.act` with checked-in code. It must not invoke the
assistant's `murph.computer_act` tool or accept model-authored code.

The action result is parsed by a closed provider-specific parser and immediately
sealed. It is never returned by a generic HTTP route or written to logs,
fixtures, snapshots, analytics, or workspace state.

Provider page content is untrusted data, not instructions. The adapter returns
only a finite semantic result such as no app, exact Murph app, unrelated app,
subscription required, expected client identity, proven signing material, or a
known safe error code.

### Managed Auth continuation

Managed Auth handoffs remain the login owner. After successful login, a fixed
same-origin continuation:

1. validates the active Murph session and handoff token;
2. resolves the exact run and `productJourneyJson`;
3. rechecks the member, provider, and connect intent;
4. resumes the same run through the current browser lifecycle; and
5. returns to the fixed provider-setup route.

Do not add an arbitrary persisted `returnTo` or `continuationPath`.

## OAuth and exact application binding

Keep shared `packages/device-syncd` provider and public-ingress interfaces free
of browser and hosted-application concepts. Application authority is hosted Web
context:

```ts
type HostedProviderApplicationContext = {
  applicationId: string;
  revision: number;
};
```

A member-bound public-ingress service wraps the existing Prisma store:

- on start, `createOAuthState` writes context into explicit
  `DeviceOauthSession` columns;
- on callback, Web peeks owner-bound OAuth context before provider construction;
- Web constructs the dynamic registry from that exact application;
- shared ingress consumes state and performs normal replay, exchange, cleanup,
  and initial-job behavior;
- wrapped connection upsert rechecks member, provider, app ID, revision, and v1
  cardinality under the existing lock, then writes explicit connection columns.

This avoids adding hosted application refs to every shared provider type or
encoding authority in ordinary metadata JSON.

### Hosted public callback

For ordinary reconnect:

1. Read provider and state.
2. Validate the existing app-session/browser-proof cookie.
3. Peek the owner-bound OAuth session's application context.
4. Resolve the exact application and construct the dynamic provider.
5. Let shared ingress consume state and finish the callback.

Invalid proof still burns state through the current non-mutating path. Static
OAuth states continue using the current static registry.

### Browser-captured OAuth

Configure the private Strava app for one fixed loopback callback and complete
OAuth in the authenticated Kernel browser:

1. Construct the existing Strava provider from exact app config.
2. Start shared ingress with current member and app context.
3. Before navigation, install checked-in Playwright interception for exactly the
   fixed `http://127.0.0.1/...` callback path.
4. Navigate to the provider authorization URL.
5. Capture only bounded `state`, `code`, `scope`, or provider-error parameters;
   validate state and fulfill loopback navigation with a fixed local page.
6. Call the same shared callback service internally with exact member/app
   context.

The public callback route and browser-proof cookie remain unchanged and are not
weakened for the internal loopback flow.

## Provider construction and legacy coexistence

Reuse the current typed provider factory. Web adds only:

- a helper that resolves one exact member application into typed provider
  config; and
- a helper that overlays that exact config on current static config for one
  member-bound operation before invoking the existing factory.

Do not make provider factories asynchronous or account-aware.

V1 enforces one nonterminal app-backed connection per `(memberId, provider)`.
An active or reauthorization-required legacy static Strava connection blocks
personal-app setup with truthful disconnect-before-migration copy. V1 does not
silently migrate, overwrite, or run both authorizations. A disconnected legacy
row may be reused by normal shared-ingress replacement after old token material
is cleared.

Once a private app exists, every new Strava start for that member uses it. The
platform-static direct route is not separately offered. Keep platform Strava
configuration available for legacy rows until no legacy connection still needs
it; removing the new-connect gate is not permission to delete legacy runtime
credentials.

## Runtime delivery

Do not put member-owned client config in Cloudflare invocation input, runner env,
`userEnv`, `platformEnv`, workspace files, connection metadata, local SQLite, or
checkpoints.

Extend the existing signed credential-material snapshot:

```ts
interface HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  // existing fields
  providerConfigs?: SerializableConfiguredDeviceSyncProviderConfigs;
}
```

Web includes this map only when `includeCredentialMaterial` is true, the request
is bound to the exact personal member, and returned current-revision connections
require it. V1 returns at most one member-owned provider entry. The map excludes
webhook verify tokens, signing secrets, subscription IDs, callback URLs, and
dashboard material.

Assistant runtime changes ordering, not ownership:

1. Fetch one signed snapshot before constructing the local provider registry.
2. Merge snapshot `providerConfigs` over static runtime config for this
   invocation only.
3. Construct the ordinary registry with the existing factory.
4. Hydrate the already fetched connection snapshot without fetching it again.
5. Run existing scheduler, dirty work, token refresh, jobs, importer, and apply.
6. Drop app config at the end of the pass.

Allow hosted device-sync control-plane config with an empty static provider map.
A member-owned provider can then arrive from the snapshot without a second
runtime.

Missing, malformed, foreign, or revision-mismatched app config hard-blocks only
the bound connection and never falls back to static credentials.

## Polling and optional application-scoped webhooks

Polling through the existing bounded reconcile scheduler is the default secure
Strava v1 mode. Webhooks improve freshness but do not justify a second lifecycle
or unsigned callback.

When a real-provider proof establishes signing credentials, enable an opaque
application route:

```text
/api/device-sync/webhooks/:provider/applications/:applicationId
```

Before durable work, the route requires:

1. a finite supported app-backed provider;
2. an application whose provider matches the route;
3. valid provider signature or equivalent authentication;
4. delivered subscription ID matching stored `webhookSubscriptionId`; and
5. an external account resolving to a nonterminal connection bound to the exact
   app ID and current revision.

Then reuse existing public-ingress trace claim, dirty work, wake, dedupe, and
acknowledgement. A scoped Web store prevents a wrong app route from resolving a
foreign connection or creating an orphan trace. Activity detail remains
deferred durable work.

The adapter may call the existing provider-specific subscription client
directly; no generic webhook-admin change is required for v1. If
signing-material provenance is not proven, do not register a subscription and
continue polling. Only a provider or legal requirement for webhooks should
block the whole connection.

## Strava adapter v1

### Fixed policy

- Deterministic Murph marker from a versioned server-keyed member/provider
  digest.
- Code-owned app name prefix, description, category, website, privacy/support
  links, callback domain, and icon.
- Requested scopes: `read,activity:read_all`.
- The initiating Murph action explicitly explains that continuing creates the
  private app and authorizes read-only activity access.
- Developer-terms acknowledgement is automated only when reviewed legal/product
  copy covers it. A new member-specific assertion becomes a truthful handoff,
  not a silent click.
- The adapter may click ordinary OAuth authorization after the explicit Connect
  action; normal members are not assigned a second setup step.

### Provisioning behavior

- Navigate only to reviewed Strava developer-settings origins and paths.
- Distinguish no app, exact Murph app, and unrelated existing app.
- Create only when no app exists.
- Reuse only an app with exact marker and callback ownership.
- Never rewrite or delete an unrelated app.
- Extract only strictly shaped client identity and proven signing material.
- Verify client credentials through a benign provider operation or OAuth
  exchange.
- Never return dashboard text, HTML, cookies, screenshots, or unrelated account
  information.

### Blocked and degraded cases

Stop setup truthfully when:

- the account lacks the subscription required to create an app;
- the account owns an unrelated app and permits no second app;
- login, MFA, CAPTCHA, or provider consent is incomplete;
- the reviewed dashboard contract changed; or
- client credentials cannot be verified.

Missing webhook signing material is a polling-mode condition, not automatically
a connection failure.

### Pre-activation corrections

Before enabling the source:

- update direct Strava revoke to the current `/oauth/revoke` contract;
- prove app creation/recovery, loopback OAuth, token rotation, polling, revoke,
  and cleanup with a disposable account;
- separately prove subscription creation, signing-material provenance, signed
  event verification, and cleanup before enabling webhooks;
- record only safe booleans, status classes, and test-keyed hashes.

The current fail-closed `X-Strava-Signature` verifier must not be weakened.

## Future-provider admission

A provider may reuse this primitive only after proving:

1. An ordinary member may create a client app for their own account.
2. Murph may automate creation after explicit user authorization.
3. The client identity is member-owned rather than a shared platform app.
4. Its token lifecycle fits an ordinary typed device-sync provider.
5. Callback capture is safe through loopback or a separately reviewed callback.
6. Webhooks are cryptographically verifiable, or polling is acceptable.
7. Client replacement can be revision-fenced without secret history.
8. Provider-specific browser behavior fits one checked-in adapter.
9. Provider data normalizes through the existing importer contract.
10. A disposable real-provider proof can clean up external effects.

If the first three answers are no, use platform OAuth, Junction, native SDK,
Apple Health, Health Connect, archive import, or another truthful route.

A second provider adds its ordinary provider/importer and one Web adapter. It
must not require another table, secret transport, setup session, browser
service, or runtime.

## Failure, disconnect, removal, and deletion

### Provisioning and OAuth

- The deterministic remote marker recovers ambiguous creation without a
  duplicate app.
- Local `(memberId, provider)` uniqueness serializes ownership.
- Provider UI drift fails closed with a safe code-owned adapter error.
- Existing OAuth state expiry and replay remain authoritative.
- Wrong member/provider/app/revision fails before exchange when possible and
  before commit otherwise.
- Missing required scopes revokes and fails.
- An unrelated active ComputerRun blocks setup retryably.

### Normal disconnect

**Disconnect Strava** resolves the exact app-bound provider, revokes athlete
authorization, and uses the existing connection lifecycle. It retains the app
for a simple reconnect.

If provider cleanup is unavailable, existing fail-closed disconnect semantics
retain enough local authority to retry instead of silently discarding the only
cleanup credential.

### Repair and app removal

Client replacement never retargets a live connection. Repair first disconnects
all linked nonterminal connections. An explicit abandon-and-repair path may
clear local token material and surface an upstream-revoke warning when the
provider already invalidated credentials and cleanup cannot succeed.

**Remove private Strava app** disconnects linked connections, removes the
optional webhook and remote app when supported, verifies linked rows are
terminal, clears their app refs, then deletes the local app row. Failure retains
local config so cleanup can be retried.

### Account deletion

Account deletion fences new work first and attempts bounded token, webhook, and
remote-app cleanup before deleting the Kernel profile. A provider or Kernel
outage must not block deletion of Murph-held data: local token/app secrets,
browser state, connections, and member state are still deleted, and cleanup
failure never restores authority.

## Contextual connection offers

Keep `packages/device-syncd` as the static route catalog. Add one Web-owned
contextual resolver combining enabled operator targets with finite app-backed
Web targets. It returns the existing `DeviceSyncConnectTarget` identity.

Every hosted surface uses the same resolver:

- `/connect`;
- source start;
- `DeviceConnectIntent`;
- assistant connect link;
- reconnect link;
- assistant-visible provider capability projection.

For Strava:

- no app -> first-party automatic setup;
- current app and no connection -> app-backed OAuth;
- current app and stale connection -> reconnect or repair;
- active current-revision connection -> connected;
- active legacy static connection -> connected plus explicit
  disconnect-before-migration recovery.

Keep the current static Strava start gate until every hosted surface uses the
resolver. Then delete the temporary gate; do not maintain two availability
systems.

## Implementation sequence

Land three reviewable PRs.

### PR 1 — dormant durable and runtime foundation

- Add the application row, exact OAuth/connection columns, migration, SecureBox
  store, replacement/removal/deletion rules, and legacy conflict checks.
- Add Web-only dynamic provider resolution and scoped public-ingress store
  wrappers; keep shared provider/public-ingress interfaces unchanged.
- Extend the signed snapshot with invocation-scoped provider config.
- Fetch the snapshot before registry construction and reuse it for hydration.
- Permit an empty static runtime provider map.
- Add no user-facing Strava offer.

### PR 2 — trusted setup and Strava proof

- Add `HostedComputerRun.productJourneyJson`, its strict parser/store methods,
  terminal clearing, and fixed Managed Auth continuation. Leave existing
  `metadataJson` checkpoint behavior unchanged.
- Reuse a claimed `DeviceConnectIntent` across setup requests.
- Add the finite adapter registry and a production-faithful fake provider.
- Add Strava dashboard automation, marker recovery, loopback OAuth, the current
  revoke contract, and polling-first execution.
- Run fake-provider E2E and the disposable real-Strava proof.
- Keep the source gated until security/provider proof passes.

### PR 3 — one product surface and optional webhook

- Add the contextual resolver and migrate every Web/assistant surface.
- Add setup/progress/recovery UI and responsive browser proof.
- Activate polling-first Strava after its real-provider gate passes.
- Add app-scoped webhooks only if the independent signing proof passes.
- Remove the temporary static Strava gate.
- Preserve runtime support and legacy static credentials as the rollback floor.

## Exact implementation guide

### `packages/device-syncd`

- Reuse manifests, factory, shared ingress, credential policy, jobs, and
  importer contracts.
- `src/hosted-runtime.ts`: add bounded optional snapshot `providerConfigs`.
- `src/providers/strava.ts`: reuse OAuth/jobs and update revoke compatibility.
- `src/providers/strava-webhooks.ts`: reuse ensure result/subscription ID only
  after webhook proof.
- Do not add browser concepts or hosted app refs to shared provider interfaces.

### `apps/web`

- `prisma/schema.prisma` plus migrations: add the app row, exact refs, and
  `HostedComputerRun.productJourneyJson`.
- `src/lib/device-sync/provider-applications/**`: SecureBox, store, finite
  registry, dynamic builder, setup orchestrator, and Strava adapter.
- `src/lib/device-sync/prisma-store/oauth-sessions.ts`: app-context columns and
  narrow owner-bound peek.
- `src/lib/device-sync/prisma-store/connections.ts`: app-context write plus
  final revision/cardinality checks inside the current lock.
- `src/lib/device-sync/public-ingress-service.ts`: optional Web app context and
  scoped store wrapper.
- callback route: existing proof, app-context peek, exact provider, shared
  ingress.
- refresh/revoke/disconnect owners: exact provider from the connection-bound
  app.
- `src/lib/device-sync/hosted-runtime-authority.ts`: project only required
  current-revision runtime configs with credential-material authority.
- `src/lib/device-sync/contextual-connect-targets.ts`: the single hosted
  resolver.
- existing connect, intent, reconnect, assistant-link, settings, and deletion
  owners: consume the resolver/store instead of duplicating policy.
- `src/lib/computer-use/store.ts` and service: map and strictly mutate
  `productJourneyJson`, preserve existing `metadataJson` checkpoint ownership,
  and expose one fixed continuation.
- setup and optional webhook routes: safe status only, never raw browser result.

### `packages/assistant-runtime`

- `hosted-runtime/device-sync-maintenance.ts`: fetch the snapshot first, merge
  invocation config, and reuse the snapshot.
- `hosted-device-sync-runtime.ts`: accept a pre-fetched snapshot without
  persisting app config.
- Assistant capability assembly: consume Web-projected contextual offers rather
  than infer app-backed support from static runtime config.

### Canonical docs

When implementation begins, update:

- `docs/device-sync-hosted-control-plane.md`;
- `agent-docs/SECURITY.md`;
- `agent-docs/RELIABILITY.md`;
- `agent-docs/references/testing-ci-map.md`;
- device-provider contribution guidance.

## Proof matrix

### Persistence and authority

- Member A cannot read, replace, resolve, or remove member B's app.
- Personal-member requirement excludes group/synthetic members.
- Ciphertext is bound to member, row, provider, field, lane, and scope.
- Unknown secret schema/fields fail closed.
- Identical reprovision keeps revision; a live link blocks replacement.
- Delete/recreate cannot satisfy a stale ref.
- An active legacy same-provider connection blocks app setup.

### Computer use and setup

- An unrelated active run is never reused or navigated.
- Only trusted Web code writes `productJourneyJson`.
- Existing `metadataJson` checkpoint reads/writes remain unchanged.
- Managed Auth pause/resume preserves the journey field.
- Terminal run transitions clear the journey field.
- Managed Auth continuation resolves exact handoff, run, member, intent, and
  provider.
- Existing assistant handoffs and reply behavior are unchanged.
- Trusted browser output is absent from HTTP bodies, logs, snapshots, tools,
  and workspace state.
- Ambiguous remote app creation is recovered without duplication.

### OAuth and connection

- OAuth session stores exact app ID/revision columns.
- Public callback still requires same-browser proof.
- Loopback accepts the exact path, state, and bounded query fields only.
- Wrong member/provider/app/revision fails closed.
- Replacement during exchange fails the final check and revokes.
- Replay remains side-effect free; missing scopes revoke and fail.
- Connection and initial jobs still commit through shared ingress.

### Runtime and refresh

- Provider config is returned only with credential-material authority.
- Group, wrong-member, no-connection, and static-only responses contain no
  member config.
- Runtime executes app-backed Strava without static Strava config.
- Snapshot is fetched once; config never reaches SQLite or checkpoints.
- Rotating refresh tokens keep existing version/lease behavior.
- Missing/stale app never falls back to platform config.
- Existing static providers and legacy Strava remain unchanged.

### Polling and webhooks

- Polling imports new data through existing reconcile jobs.
- No signing material means no subscription, never unsigned ingress.
- If enabled, validation GET uses the derived exact-app verify token.
- Event POST requires a valid signature and matching subscription ID.
- A wrong app route cannot create an orphan trace.
- Duplicate events use current trace handling; detail fetch remains deferred.

### Product and real-provider proof

The fake-provider E2E proves Connect, secure login, automatic app creation,
secret non-disclosure, loopback OAuth, exact app-bound connection, initial
backfill, runtime import, and connected status. Negative cases include missing
subscription, unrelated app, UI drift, active legacy connection, stale revision,
cancellation, replay, and an unrelated active browser run.

The disposable Strava proof cleans tokens, the remote app when supported, and
the Kernel profile. Optional webhook evidence additionally cleans the
subscription. Stored evidence contains no raw credential or identifiable
provider data.

## Deployment and rollback

Deploy in order:

1. additive schema/readers and snapshot consumer;
2. dormant Web writers, dynamic resolution, and setup;
3. real-provider polling proof;
4. contextual offers;
5. optional signed webhooks.

Before contextual offers, no member creates an app-backed connection.

Once app-backed connections exist, runtime snapshot consumption and exact app
resolution are the rollback floor. Rollback disables new offers first, keeps
runtime support and legacy static credentials, disconnects app-bound
connections if needed, and deletes app rows only after cleanup policy completes.

Never roll back by copying member client secrets into platform env, connection
metadata, or browser-visible state.

## Rejected alternatives

- **Shared Murph Strava app:** wrong ownership and shared review/rate limits.
- **Member copies credentials:** clipboard/chat/screenshot/support/log risks.
- **Assistant reads the secret:** generic computer result crosses the model
  transcript.
- **Overload `HostedComputerRun.metadataJson`:** it already owns checkpoint
  context and current pause/resume transitions replace or clear it.
- **Secret on `DeviceConnection`:** the app exists before and beyond one athlete
  token.
- **Secret on container disk/env:** creates a second control plane across an
  ephemeral container, callback, reconnect, and deletion.
- **Generic credentials table:** erases OAuth-client revision and lifecycle
  meaning.
- **Generic browser workflow engine:** adds a selector DSL and workflow state for
  one finite adapter.
- **Dynamic resolver in every provider:** the existing typed factory already
  builds a provider from config.
- **Phone health store only:** useful fallback, not equivalent to
  provider-native history and fields.

## External references

- Strava Getting Started:
  https://developers.strava.com/docs/getting-started/
- Strava OAuth:
  https://developers.strava.com/docs/authentication/
- Strava webhooks:
  https://developers.strava.com/docs/webhooks/
- Kernel Managed Auth:
  https://www.kernel.sh/docs/auth/overview
- Polar AccessLink:
  https://www.polar.com/accesslink-api/

## Definition of done

A normal eligible Strava member selects Connect, performs only provider
authentication, and reaches one active current-revision backfilling connection.
No client secret or token crosses the model or public-browser boundary. Existing
device-sync ownership remains intact. A later proven provider can reuse the app
row, intent, ComputerRun lifecycle plus typed journey field, dynamic Web
provider resolution, runtime snapshot, and contextual resolver without another
state owner.