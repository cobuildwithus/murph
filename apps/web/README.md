# @murphai/hosted-web

Hosted integration control plane for Vercel deployments.

`apps/web` is the hosted integration control plane for OAuth callbacks, webhooks, sparse connection metadata, sparse Linq routing state, sparse local-agent APIs, and the durable encrypted hosted-member private fields that power onboarding and billing. Canonical decryptable device-sync token escrow plus mutable hosted device-sync runtime state now live in the Cloudflare runtime store; Postgres keeps only opaque connection ids, blind-index ownership mapping, typed connection summary fields, sparse signal history, token-audit history, and the encrypted owner-table fields for hosted member identity, routing, and billing references. Ordinary hosted-web settings and control-plane reads stay on that durable Postgres metadata path, while live Cloudflare runtime inspection is reserved for explicit operational routes such as agent token export/refresh, heartbeat reconciliation, disconnect, and runtime upkeep.

## Core responsibilities

- Garmin, WHOOP, and Oura OAuth start/callback flows
- WHOOP and Oura webhook intake
- hosted Linq webhook ingress plus sparse chat routing state
- per-user connection ownership mapping
- public connection metadata plus sparse durable status hints and token-audit history
- blind-index provider account ownership mapping without raw provider ids in SQL
- encrypted hosted-member private fields on the owner Prisma tables for onboarding identity, routing, and billing references
- durable `execution_outbox` records for Cloudflare-bound hosted execution intents, persisted as immutable inline envelopes or staged Cloudflare-owned dispatch refs
- immutable hosted AI usage rows imported after successful hosted commits, limited to billing-safe counters plus routing metadata for downstream Stripe token metering
- local-agent pairing plus sparse signal/token routes for hosted integrations
- internal runner snapshot/apply APIs for explicit hosted device-sync operational reads and reconciliation

## Non-goals

- canonical health-data storage
- canonical inbox-capture storage
- vault imports
- proxying provider health payloads through the hosted app
- storing canonical Linq chat captures in Postgres
- storing raw provider webhook bodies or provider tokens inside hosted device-sync signal payloads
- storing raw provider account ids or provider-supplied account labels in hosted Postgres

## Key environment variables

See `.env.example` for a working template.

Required:

- `DATABASE_URL`
- `DEVICE_SYNC_ENCRYPTION_KEY`
- `DEVICE_SYNC_ENCRYPTION_KEY_VERSION`

Required for the hosted device-sync lane:

- `GARMIN_CLIENT_ID`
- `GARMIN_CLIENT_SECRET`
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`

Required for hosted Linq ingress:

- `LINQ_WEBHOOK_SECRET`

Optional but recommended:

- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS`
- `DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`
- `DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER`
- `DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER`
- `DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET`
- `HOSTED_WEB_BASE_URL`
- `OURA_WEBHOOK_VERIFICATION_TOKEN`
- `CRON_SECRET` for Vercel-owned hosted cron routes
- `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK`
- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID`
- `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON` when rotating callback verification keys

Hosted onboarding extras:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL`
- `HOSTED_CONTACT_PRIVACY_KEY` for the legacy single-key `v1` fallback only
- `HOSTED_CONTACT_PRIVACY_KEYS` as a comma-separated `version:base64key` keyring when preparing blind-index rotation
- `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION` when `HOSTED_CONTACT_PRIVACY_KEYS` defines more than one version
- `HOSTED_WEB_ENCRYPTION_KEY`
- `HOSTED_WEB_ENCRYPTION_KEY_VERSION`
- `HOSTED_WEB_ENCRYPTION_KEYRING_JSON` when rotating hosted-member private field keys
- `HOSTED_ONBOARDING_SIGNUP_PHONE_NUMBER` to show a public `Text to start` CTA on `/`
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_PRIVY_CLIENT_ID` if you want the hosted web app to select a specific Privy web client per environment
- `PRIVY_CUSTOM_AUTH_DOMAIN` or `NEXT_PUBLIC_PRIVY_CUSTOM_AUTH_DOMAIN` when Privy uses a custom auth host such as `https://privy.example.com`; `apps/web` uses this to extend the CSP `connect-src` and `frame-src` allowlists for Privy's browser SDK
- `PRIVY_BASE_DOMAIN` or `NEXT_PUBLIC_PRIVY_BASE_DOMAIN` as an optional fallback when the Privy custom host follows the `privy.<base-domain>` pattern
- `PRIVY_VERIFICATION_KEY`
- enable Privy email login/linking in the dashboard so `/settings` can verify account email addresses
- enable Privy identity tokens in the dashboard under `User management > Authentication > Advanced`
- enable Privy access + identity tokens so hosted browser requests can authenticate API calls with bearer + identity-token headers
- `HOSTED_ONBOARDING_INVITE_TTL_HOURS`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_API_BASE_URL`
- `HOSTED_EXECUTION_DISPATCH_URL`
- `HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS`
- `CRON_SECRET`

Hosted onboarding private state is now local to `apps/web`: blind lookup keys stay queryable in Postgres, while recoverable raw member ids and the raw source values needed to re-derive those lookup keys are encrypted into the owning Prisma rows instead of being mirrored into Cloudflare. Blind-index rotation follows one simple model: write one current version, read any configured keyring versions, backfill the owner tables in place, and only then remove the old version from the contact-privacy keyring. Drain lookup-bearing hosted execution outbox events before a write-mode rotation backfill so staged payload refs do not preserve stale lookup identities.

Optional hosted AI usage metering:

- `HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME`
- `HOSTED_AI_USAGE_STRIPE_BATCH_LIMIT`

## Hosted public origin and Cloudflare callback auth

Treat this section as the canonical operator-facing contract for hosted public origin and Cloudflare-owned callbacks. The Cloudflare docs only list the worker-side envs they consume and point back here instead of restating the precedence rules.

Public origin precedence:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL` wins for invite, join, and hosted-share links.
- Otherwise `HOSTED_WEB_BASE_URL` is the canonical hosted-web public base URL.
- On Vercel, when neither explicit hosted public-base env is set, `apps/web` falls back to `VERCEL_PROJECT_PRODUCTION_URL`.
- `DEVICE_SYNC_PUBLIC_BASE_URL` overrides the provider-facing callback and webhook base for hosted device sync. When it is unset, `apps/web` derives that base as `<canonical hosted public origin>/api/device-sync`.

Callback auth contract:

- `apps/web` verifies Cloudflare-owned internal callbacks with `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK`.
- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID` selects the active callback key id and defaults to `v1`.
- `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON` is the optional `{ keyId: publicJwk }` verification keyring for staged callback-key rotation.
- `apps/cloudflare` signs those callbacks with the matching private key at `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`; keep its active key id aligned with `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID`.

When you set `DEVICE_SYNC_PUBLIC_BASE_URL`, point it at the stable production project domain or a custom domain for the hosted app, for example `https://your-project.vercel.app/api/device-sync`. Do not use an ephemeral preview deployment URL as the long-lived provider callback or webhook base.

### Vercel setup

Set these under `Settings -> Environment Variables` in the Vercel project that deploys `apps/web`. Production is the minimum. Only set Preview if you also have matching preview peers and secrets instead of pointing preview deploys at production control planes.

- Enable Vercel OIDC for the project so the app-local hosted-execution auth adapter in `apps/web` can present bearer workload identity to Cloudflare on hosted execution dispatch/control requests.
- `CRON_SECRET`: configure the Vercel cron bearer secret for the hosted cron routes under `/api/internal/**/cron`.
- Configure the hosted public-origin envs and `HOSTED_WEB_CALLBACK_SIGNING_*` values exactly as documented in the `Hosted public origin and Cloudflare callback auth` section above.
- `DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET`: generate a distinct strong random secret and use the same value in Vercel plus whichever trusted auth proxy or middleware signs the hosted user assertion headers. `apps/web` verifies that signature before trusting the lower-level assertion-backed device-sync bridge routes.

If you prefer the CLI, Vercel's current docs cover `vercel env add`, `vercel env update`, and `vercel env pull` for managing these project environment variables.

Development fallback only:

- `DEVICE_SYNC_DEV_USER_ID`
- `DEVICE_SYNC_DEV_USER_EMAIL`
- `DEVICE_SYNC_DEV_USER_NAME`

## Browser auth contract

The lower-level assertion-backed device-sync bridge routes, such as `POST /api/device-sync/agents/pair`, trust a front-end/auth proxy only when it attaches:

- a base64url JSON assertion in `DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER`
- an HMAC signature for that exact assertion in `DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER`

The signed assertion must include the hosted user claims plus:

- `iat` and `exp` with a lifetime of at most 5 minutes
- a strong random `nonce`
- `aud`, `method`, `path`, and `origin` bindings for the current request

The hosted control plane consumes each assertion nonce once, so replayed assertions fail even if the user id/email/name tuple is unchanged.

## Secret hygiene and rotation

- Keep real hosted values in an untracked local `.env` for development or in the platform secret manager for deployed environments. The committed `.env.example` file must stay placeholder-only.
- A raw filesystem archive of a repo clone is still an exposure when ignored local `apps/web/.env`, `.next`, `.next-dev`, or `.next-smoke` output exists, even when git has no tracked secret diff. Use the guarded `pnpm zip:src` / `scripts/package-audit-context.sh` flow for source sharing instead of archiving the clone directly; that path stages git-visible files, now includes the tracked `config/workspace-source-resolution.ts` helper, and filters blocked local residue from the bundle.
- Treat `DATABASE_URL`, `DEVICE_SYNC_ENCRYPTION_KEY`, `GARMIN_CLIENT_SECRET`, `WHOOP_CLIENT_SECRET`, `OURA_CLIENT_SECRET`, and `OURA_WEBHOOK_VERIFICATION_TOKEN` as rotation-required if a real hosted `.env` or deploy secret was ever exposed.
- Treat a leaked raw clone/archive that included the local hosted `.env` the same way as a direct secret exposure.
- Rotate `DEVICE_SYNC_ENCRYPTION_KEY_VERSION` whenever you rotate `DEVICE_SYNC_ENCRYPTION_KEY`, but do not assume the version field alone gives backwards-compatible reads. The current hosted control plane still uses this key for device-sync control-plane secrecy such as opaque browser connection ids and key-versioned audit metadata.
- Canonical decryptable provider tokens no longer live in Postgres. The Cloudflare runtime store now owns token escrow under the user root key, so escrow rotation or revocation must follow the hosted-execution/Cloudflare key path rather than the removed `device_connection_secret` table.

## Prisma

Generate the client and apply migrations with Prisma:

```bash
pnpm --dir apps/web prisma:generate
pnpm --dir apps/web prisma:migrate:deploy
```

The hosted device-sync SQL hard-cut is currently greenfield/reset-only. Until a deployed hosted Postgres environment needs an in-place rollout, the repo keeps that hard-cut folded into the initial migration instead of carrying a separate forward migration for the removed raw-id/JSON columns.

## Local verification

- `pnpm --dir apps/web lint` runs the explicit ESLint CLI with `eslint-config-next`.
- `pnpm --dir apps/web dev` now keeps interactive Next dev artifacts under `apps/web/.next-dev`.
- The Next 16 Turbopack filesystem cache is disabled by default for local `next dev` in this repo; set `MURPH_NEXT_DEV_FILESYSTEM_CACHE=1` only when you explicitly want on-disk dev cache reuse.
- `pnpm --dir apps/web build` and `pnpm --dir apps/web start` keep using `apps/web/.next`.
- `pnpm --dir apps/web test` is the fast hosted-web Vitest lane. `pnpm --dir apps/web verify` adds the app-local typecheck, lint, a cold-boot `next dev` smoke under `apps/web/.next-smoke`, and the production build so the heavier preflight checks stay out of the default unit-test loop.
- Treat `apps/web/.next`, `apps/web/.next-dev`, and `apps/web/.next-smoke` as generated local artifacts that must stay out of commits and raw source bundles.
- Hosted execution outbox draining and hosted AI usage metering now accept only Vercel cron bearer auth via `CRON_SECRET`.
- Hosted AI usage rows no longer persist provider/session/request ids or raw provider usage JSON; hosted Postgres keeps only billing-safe counters and routing metadata.
- Cloudflare-owned callback routes such as hosted device connect-link and share-import completion/release now accept only the dedicated Cloudflare callback signature verified against `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK`.
- Hosted Stripe webhooks now attempt inline reconciliation for the just-recorded event, then best-effort drain the matching hosted execution outbox rows immediately. The Stripe cron route remains the recovery path for failed or deferred Stripe facts and RevNet follow-up only; first-contact welcomes now commit as assistant outbox intents during hosted `member.activated` handling and drain afterward through the same post-commit assistant-delivery path as other hosted assistant sends.

## Main routes

Hosted settings-authenticated wearable routes:

- `GET /api/settings/device-sync`
- `GET /api/settings/device-sync/connections/:connectionId/status`
- `POST /api/settings/device-sync/providers/:provider/connect`
- `POST /api/settings/device-sync/connections/:connectionId/disconnect`

These are the only browser-facing wearable-management routes. They power the `/settings` wearable-sources card and use the hosted onboarding Privy bearer + identity-token contract so the browser can manage calm connect, reconnect, refresh, and disconnect flows without the separate signed browser-assertion headers required by the lower-level agent bridge.

Assertion-authenticated browser-to-agent bridge routes:

- `POST /api/device-sync/agents/pair`
- `GET /api/linq/bindings`
- `POST /api/linq/bindings`

Hosted settings device-sync responses intentionally omit `externalAccountId`, and the `id` returned from settings connection routes is an opaque handle rather than the raw hosted `device_connection.id` value.

Public provider-facing routes:

- `GET /api/device-sync/oauth/:provider/callback`
- `POST /api/device-sync/webhooks/:provider`
- `GET /api/device-sync/webhooks/oura` for Oura webhook verification challenges
- `GET /api/linq/webhook`
- `POST /api/linq/webhook`

Local-agent routes:

- `GET /api/device-sync/agent/signals`
- `POST /api/device-sync/agent/connections/:connectionId/export-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/refresh-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat`
- `POST /api/linq/agents/pair`
- `GET /api/linq/agent/events`

Hosted device-sync agent signals stay sparse by design:

- webhook wake hints expose only sparse typed metadata plus normalized job hints and reconcile metadata that the hosted runner can safely replay in-memory
- hosted Postgres/API state must not persist or return raw provider webhook payload blobs or provider tokens

Hosted execution maintenance routes:

- `GET /api/internal/hosted-execution/outbox/cron`
- `GET /api/internal/hosted-execution/usage/cron`
- `POST /api/internal/hosted-execution/share-import/complete` (Cloudflare-signed internal callback only)
- `POST /api/internal/hosted-execution/share-import/release` (Cloudflare-signed internal callback only)

The old `POST /api/internal/hosted-execution/outbox/drain` route has been removed. Cloudflare no longer round-trips through hosted-web runtime snapshot/apply routes or direct usage-record writes in the hot path. Device-sync hydration and usage buffering now stay on the Cloudflare side during execution, `apps/web` later imports buffered usage from Cloudflare-owned storage, and the optional usage cron sends total-token meter events to Stripe while skipping member-supplied API-key runs.

## Hosted onboarding routes

This repo now also includes a hosted onboarding lane for phone-bound invites and public signup:

- `GET /`
- `GET /join/:inviteCode`
- route-local loading UI at `app/join/[inviteCode]/loading.tsx`
- `GET /join/:inviteCode/success`
- `GET /join/:inviteCode/cancel`
- `GET /share/:shareCode`
- route-local loading UI at `app/share/[shareCode]/loading.tsx`
- `GET /api/hosted-onboarding/invites/:inviteCode/status`
- `POST /api/hosted-onboarding/privy/complete`
- `POST /api/hosted-onboarding/billing/checkout`
- `GET|POST /api/hosted-onboarding/linq/webhook`
- `POST /api/hosted-onboarding/stripe/webhook`
- `GET /share/:shareCode`
- `POST /api/hosted-share/:shareCode/accept`
- `POST /api/hosted-share/create`

The onboarding lane is intentionally thin:

- a Linq webhook can text back a hosted join link to a new phone number or a trigger phrase like "I want to get healthy"
- the public landing page can start the same flow with Privy SMS verification
- the invite page binds the verified phone number to a hosted member row in Postgres, while the UI stage itself is derived from invite expiry, session match, billing entitlement, and suspension facts instead of persisted invite/member lifecycle enums
- Privy handles phone OTP, the browser makes one explicit completion attempt after verifying phone and best-effort wallet provisioning, and the backend locally verifies the client's bearer access token plus identity token instead of minting a separate hosted session cookie; the wallet only becomes mandatory later if RevNet-backed billing is ever enabled again
- checkout uses Stripe Checkout so Apple Pay can appear directly inside the hosted payment handoff when available in Safari, the hosted app creates a fresh Checkout Session for each start attempt, and durable Postgres state keeps only the stable Stripe customer/subscription refs needed for metering and reconciliation
- Stripe webhook ingress now verifies and stores a minimal Stripe receipt quickly, then immediately re-fetches the live event from Stripe during reconciliation so billing activation and `member.activated` dispatching are not gated on a scheduler; the hosted Stripe cron remains the recovery path for failed or deferred receipts
- hosted billing is subscription-only, `invoice.paid` is the only positive Stripe entitlement source, `customer.subscription.*` only tracks negative or status transitions, and `checkout.session.completed` only binds stable Stripe refs without granting access by itself
- hosted share links now keep only a tiny UX summary plus expiry and lifecycle metadata in Postgres while Cloudflare stores only the opaque one-time share-pack object for foods, recipes, and supplement/protocol records; the flow can still issue or reuse a phone-bound invite so `/join/:inviteCode?share=...` can import the shared bundle after activation, and the default and maximum hosted share-link lifetime remains 24 hours to keep that transient share-pack storage privacy-first
- once a member has active billing entitlement, hosted onboarding, hosted share acceptance, and hosted device-sync wakes write signed internal execution intents to the shared Postgres `execution_outbox` in the same transaction as their control-plane state changes instead of synchronously depending on `apps/cloudflare`
- hosted share acceptance no longer reads Cloudflare during the claim transaction: Postgres writes only the durable claim state plus a tiny inline `vault.share.accepted` share ref, and Cloudflare hydrates the opaque pack later when the runner is actually about to import it
- new steady-state outbox rows are immutable: inline events store the full dispatch body, while reference-backed events stage the full dispatch into Cloudflare-owned encrypted dispatch-payload storage and persist only the dispatch ref plus opaque payload ref in Postgres
- a best-effort drain still runs after commit, but the Postgres outbox is now delivery-only: once Cloudflare accepts the dispatch, retries, poison/backpressure, in-flight execution, business-outcome callbacks, and completion live in the Cloudflare queue instead of on the outbox row; new reference-backed rows still require a staged Cloudflare payload ref instead of falling back to web-side dispatch reconstruction
- if Cloudflare later cannot hydrate the share pack, it releases the hosted share claim through the signed `/api/internal/hosted-execution/share-import/release` callback instead of leaving the acceptance stuck
- hosted onboarding webhook receipts still keep receipt-local side-effect markers for retry-safe Linq invite replies, persist the planned response plus queued side effects before any external send, and use a reclaimable processing lease so a retried Linq or Telegram webhook can resume abandoned work instead of being dropped as a duplicate
- the current hosted outward-effect lanes are now explicit: Cloudflare-bound execution uses `execution_outbox`, receipt-owned Linq or Telegram replies use the webhook receipt side-effect journal, and Stripe facts use inline webhook reconciliation plus cron recovery
- Stripe customer/subscription entitlement writes now re-fetch canonical subscription state from Stripe before mutating local billing status, so out-of-order webhook delivery does not rely on durable local event-order markers
- subscription cancellation, pause, unpaid, refund, and dispute paths revoke hosted access through billing or suspension state; refund and dispute suspensions stay blocked until an operator clears them explicitly

Current hosted billing assumptions:

- Hosted checkout is always Stripe subscription mode.
- `invoice.paid` is the only positive activation source; `checkout.session.completed` and `customer.subscription.*` do not grant access by themselves.
- RevNet issuance code remains in-tree but is currently hard-disabled and no `HOSTED_ONBOARDING_REVNET_*` envs are read.
- Chargebacks, disputes, and refunds are not clawed back onchain; the Stripe webhook suspends hosted access and halts future activation until manual review.
