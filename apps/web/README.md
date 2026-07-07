# @murphai/hosted-web

Hosted integration control plane for Vercel deployments.

`apps/web` is the canonical hosted control plane. Hosted product meaning lives
in Postgres here, not in Cloudflare worker control storage. In particular,
`apps/web` owns hosted member identity, routing, billing, email authorization,
device-sync control-plane authority, the hosted AI usage ledger,
hosted computer-use browser run/checkpoint state, and the hosted mailbox,
latest workspace checkpoint pointer, and redacted runtime logs/status
projection.

Exact hosted message/event producers append encrypted mailbox items in Postgres,
then signal the pointer-only hosted Temporal workflow for the affected member.
Device-sync webhook freshness is a dirty-state path instead: web records
trace/audit facts, widens per-connection dirty resources, completes the trace in
that transaction, and appends one deterministic `device-sync.wake` mailbox
handoff only when the connection moves clean-to-dirty. Already-dirty level hints
coalesce without another mailbox row. The dirty row remains the source of truth;
the mailbox row is only the durable handoff into the normal Temporal wake path.
Post-commit Temporal signal failures are logged as best-effort mailbox handoff
failures; repeated dirty hints while a connection is already dirty do not retry
the signal, and any stronger repair must be mailbox-wide rather than a
device-sync recovery path.
Hosted execution no longer flows through a web-owned acquire/commit/finalize run
protocol; the restored local runtime imports mailbox items, pulls dirty
device-sync state, and checkpoints its own workspace state.

Signup-oriented landing-page auth completion for accessible hosted stages routes
to `/home?initialVisit=true`. The home page treats that query as a one-shot
browser handoff: it opens the welcome dialog, resolves the member's best
available Murph contact route, and strips the query parameter on mount so
ordinary `/home` visits are not blocked. Login-oriented landing CTAs continue to
route to `/home`.

`apps/cloudflare` remains the execution-only runtime boundary. It accepts
authenticated execution intents, restores encrypted runtime state, runs a
workspace-runtime pass, and checkpoints through the web-owned workspace CAS. It may hold
opaque encrypted runtime blobs and explicit execution-time callback data, but it is not the
canonical owner of hosted product facts.
Hosted device-sync provider registration is intentionally shared with
`@murphai/device-syncd/config`; `apps/web` should reuse that assembly path
instead of maintaining an app-local provider list or provider-config object.
Routes and pages that only need connect-target metadata should use the narrower
`@murphai/device-syncd/connect-config` entrypoint so builds do not pull provider
runtime factories into static analysis.

Hosted E2E orchestration helpers live under `apps/web/test/support`, not
`apps/web/src`. Application source should expose production runtime seams such
as client factories and dependency-bearing functions; the testkit owns smoke-env
adaptation, seed composition, and cross-app E2E imports.

## Experiment detail data sources

The experiment detail page composes two narrow data sources:

- Health Commons is the public protocol source of truth. Server components resolve generated route bundles/projections and pass a typed `ExperimentProtocol` into the page.
- The browser vault is the private run source. Client components decrypt the dashboard snapshot in-browser, project a matching `ExperimentRunProjection`, and overlay only private status, timeline, next-step, and outcome fields.

The UI receives the composed `Experiment` view model, but public protocol prose, citations, and commons revisions are never copied into private run state.

The `/settings` Data & privacy export uses that same in-browser browser-vault replica path. It downloads the decrypted `murph.browser-vault-replica` JSON that dashboard pages can already read, rather than making the primary user export the older hosted account metadata bundle.

## Core responsibilities

- Garmin connect plus Oura, Strava, and WHOOP OAuth start/callback flows
- Oura, Strava, and WHOOP webhook intake
- hosted Linq and Telegram webhook ingress plus sparse routing state
- per-user device connection ownership mapping plus token audit history
- hosted member core, identity, routing, billing, email-authorization, and legal-consent slices
- signed hosted user crypto root envelopes plus append-only crypto audit rows
- encrypted hosted mailbox rows and lane counters for durable execution inputs
- latest hosted workspace checkpoint metadata plus redacted runtime logs/status
- immutable hosted AI usage rows in Postgres for billing-safe reconciliation
- event-id keyed Linq first-contact classifier decisions with no classifier
  prompt/response bodies; the legacy rejected-message-text column is an ignored
  deploy-skew compatibility column and is scrubbed by migration
- bounded hosted product-feedback rows for explicit structured product feedback
- member-bound hosted phone-call rows for web-owned Retell starts and signed
  Retell function/webhook results
- Kernel-backed hosted computer runs, Live View handoffs, and durable Managed Auth connections
- hosted Stripe receipt/retry state, billing reconciliation, and onboarding webhook receipts
- local-agent pairing plus sparse signal/token routes for hosted integrations

## Non-goals

- canonical health-data storage
- canonical inbox-capture storage
- vault imports
- proxying provider health payloads through the hosted app
- storing canonical Linq chat captures in Postgres
- storing raw provider webhook bodies or provider tokens in hosted API responses
- turning Cloudflare execution mirrors into a second durable source of product truth

## Legal and health-permission publication surfaces

Hosted deployments should expose HTML legal pages in addition to downloadable
PDFs:

- `/legal/privacy`
- `/legal/terms`
- `/consumer-health-data-privacy-policy`
- `/legal/health-ai-safety-disclosure`
- `/legal`
- `/subprocessors`
- `/legal/manifest.json`

For Google Health Connect distribution, the Google Play privacy-policy link and
the Health Connect permission flow should point to the same `/legal/privacy`
policy users can reach in product. Health and fitness permissions must be tied
to a clear user benefit, no broader than necessary for the feature, and the
policy must explain collected health/fitness categories, use, storage, sharing,
retention/deletion, and security practices.

## Canonical hosted models

The hosted Prisma schema keeps ownership sharp and nested:

- `HostedMember` is the core member row plus activation/billing status
- `HostedMemberIdentity` owns recoverable member identity facts
- `HostedMemberRouting` owns hosted channel routing facts
- `HostedMemberBillingRef` owns Stripe/customer subscription references
- `HostedMemberEmailAuthorization` owns verified-email and sender-authorization facts
- `HostedConsentEvent` and `HostedConsentGrant` own append-only legal consent
  history plus current launch-required and optional feature-consent state
- `HostedMailboxItem`, `HostedMailboxPayload`, and `HostedMailboxLaneCounter`
  own append-only encrypted execution inputs and per-lane sequence allocation
- `HostedWorkspace` owns the latest encrypted checkpoint pointer and redacted
  status projection
- `HostedRuntimeLog` owns bounded redacted observability events
- Temporal orchestrates per-user execution wakeups; Cloudflare only executes or
  wakes a bound runtime and does not own a queue, mailbox cursor, or web-visible
  run recovery ledger
- `HostedAiUsage` owns the canonical hosted usage ledger
- `HostedProductFeedback` owns assistant-captured structured product feedback
  with only a bounded product-only summary, kind, and optional changelog ids,
  without storing raw conversation text, health details, tags, topics, or provider payloads
- `HostedPhoneCall` owns one member-bound Retell phone-call row per real call
  with a bounded call brief, provider call id, status, and final analysis
  result; Retell credentials stay in web env, transfer destinations are resolved
  from verified member identity, and raw transcripts/audio are not stored in
  Murph.
- `HostedComputerRun` and `HostedComputerHandoff`
  own member-scoped Kernel profile names, resumable run state, and durable
  `awaiting_user` checkpoints. Assistant dynamic tools receive only run handles;
  `apps/web` owns Kernel lifecycle and encrypted browser capabilities. Awaiting
  runs open through `computer_open`, which creates, reuses, resumes, or safely
  reclaims completed or stale-checkpointed active runs and returns current page
  state. `apps/web` verifies newer
  hosted `conversation.message` mailbox items and delivery context when reply
  proof is required; model-supplied run ids or confirmation text are not proof.
  `computer_act` runs bounded raw Playwright code against the current Kernel
  page, and `computer_os_control` is a bounded mouse/keyboard fallback for page
  surfaces that cannot be operated through Playwright. The agent explicitly
  selects `managed_login` for Kernel Hosted UI plus a durable profile/domain
  connection, or `login` for the existing Live View takeover; CAPTCHA,
  payment, missing-detail, and direct takeover handoffs remain Live View. Authenticated
  handoffs reuse the current hosted web session's last measured takeover surface
  as a fast browser-viewport hint, then correct from the live client surface in
  the background without blocking takeover.
- `hosted_user_crypto_envelope` stores signed wrapped per-user/per-domain root
  envelopes; plaintext roots are never stored
- `hosted_user_crypto_audit` records hosted crypto authority events

## Key environment variables

See `.env.example` for a working template.

Required:

- `DATABASE_URL`
- `HOSTED_DEVICE_ROUTING_INDEX_KEY`

Required for production migrations:

- `DIRECT_DATABASE_URL`

Required for the hosted device-sync lane:

- `JUNCTION_API_KEY`
- `JUNCTION_CLIENT_USER_ID_SECRET`
- `JUNCTION_ENV`
- `JUNCTION_REGION`
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`

Required for hosted Linq ingress:

- `LINQ_WEBHOOK_SECRET`

Required for hosted WhatsApp Cloud API ingress:

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`

The WhatsApp webhook maps Cloud API `from` sender ids to existing verified
hosted phone identities. Normal text messages are appended to the hosted mailbox
only after the member has active access and current `feature.whatsapp-messaging`
consent; inbound `START` grants that consent and inbound `STOP` revokes it.

WhatsApp outbound replies are sent by the Cloudflare hosted runner provider
effect. Configure those Cloud API delivery credentials on `apps/cloudflare`;
keep this web surface to ingress verification secrets only.

Optional but recommended:

- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS`
- `DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`
- `DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER`
- `DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER`
- `DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET`
- `HOSTED_WEB_BASE_URL`
- `MURPH_LABELS_DB_URL` for the shared product labels Postgres database required by `/api/foods` and `/api/supplements`
- `MURPH_DATA_API_KEY` for server-to-server data API auth on `/api/foods` and `/api/supplements`; hosted Cloudflare owns the same secret for Worker-side injection and the key must not be exposed to browsers or runner env
- `CRON_SECRET`
- `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK`
- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID`
- `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON`

Required when hosted computer-use is enabled:

- `KERNEL_API_KEY`
- `HOSTED_COMPUTER_PROFILE_NAMESPACE`, unique per hosted computer-use trust
  boundary. Keep production stable; previews should use a deployment/branch
  namespace or disable the persistent computer-use profile.

The Kernel API key stays in `apps/web` only. Cloudflare-hosted execution reaches
computer-use through signed `web-control.worker` callbacks; neither Cloudflare
nor Codex dynamic tool payloads receive raw Kernel credentials or live-view
URLs.
Kernel live-view iframe and WebSocket origins are code-owned from Kernel's
documented CSP sources (`https://*.onkernel.com:8443` and
`wss://*.onkernel.com:8443`) rather than operator-managed environment
configuration.

## Product label databases

`/api/foods` and `/api/supplements` both require the shared product labels
Postgres database configured by `MURPH_LABELS_DB_URL`; both routes fail closed
when it is unset. Apply the relevant schema under `sql/foods/` or
`sql/supplements/`, import the label data, then use read-only runtime
credentials after import. `MURPH_SUPPLEMENT_DB_URL` is not a runtime fallback.

Product contaminant summaries use the same APIs. Use
`sql/product-tests/import-plasticlist.sh --schema-only` to apply `foods`,
`supplements`, and `product_tests` schemas to every configured labels database
in the same deploy window as contaminant-aware web code. This schema removes
the old threshold-application table, so do not apply it to an environment still
serving the previous contaminant-aware build. Deployment precondition: every web
environment serving `/api/foods` or `/api/supplements` must have
`MURPH_LABELS_DB_URL` configured before this code ships. `--legacy-supplement-db`
is only a one-time schema-preparation helper for old supplement-only databases
during migration; when using it, temporarily assign that database URL to
`MURPH_LABELS_DB_URL`. That mode prepares a column-compatible food foreign-key
target without requiring food search extensions.
`product_tests` rows must link to the exact returned `foods.id` or
`supplements.id`; the lookup layer does not infer contaminants from names,
brands, ingredients, tags, categories, or fuzzy matches. The PlasticList import
helper creates PlasticList-backed `foods` rows for source products that keep
tests on the source-backed food id, while curated remaps attach tests directly
to the explicit target row. Those imports are exact measured evidence; concern
alerts require separately curated active `contaminant_thresholds` rows. Daily
exposure screens, such as the BPA one-serving-per-day adult screen, use the
label row's `serving_grams` when it is available instead of storing manual
product-threshold application rows.
Attribution lives under `sql/product-tests/`.

The current search path uses built-in Postgres full-text search only. No
extensions such as `pg_trgm`, `pgvector`, or vector indexes are required for
supplement label lookup. Food label lookup additionally applies `pg_trgm` in
`sql/foods/schema.sql` for name search support.

Provider-owned webhook-admin settings:

- `OURA_WEBHOOK_VERIFICATION_TOKEN` when the shared Oura provider config should answer webhook preflight challenges and maintain Oura webhook subscriptions. This secret should stay on the provider-owned config path rather than the generic hosted env surface.
- `STRAVA_WEBHOOK_SIGNING_SECRET` when direct Strava webhook POST delivery is enabled, plus optional `STRAVA_WEBHOOK_TIMESTAMP_TOLERANCE_MS`; these stay on the provider-owned config path and are not needed for hosted connect-source flows that do not use direct Strava webhook delivery.
- `STRAVA_WEBHOOK_VERIFY_TOKEN` when the shared Strava provider config should answer webhook preflight challenges and maintain the one app-global Strava webhook subscription. This secret should stay on the provider-owned config path rather than the generic hosted env surface.

Hosted onboarding extras:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL`
- `HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS` for explicit trusted browser mutation origins. Leave empty in production unless a deliberate first-party frontend origin must mutate the same hosted state; do not include loopback origins in production.
- `HOSTED_CONTACT_PRIVACY_KEYS`
- `HOSTED_DEVICE_ROUTING_INDEX_KEY`
- `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION`
- `HOSTED_MAILBOX_FINGERPRINT_KEY`
- `HOSTED_ONBOARDING_SIGNUP_PHONE_NUMBER`
- `RESEND_API_KEY`, `HOSTED_SIGNUP_WELCOME_EMAIL_FROM`, and `HOSTED_SIGNUP_WELCOME_EMAIL_FOUNDER_NAME` enable the plain-text post-activation signup welcome email to the member's verified email address, or to the Stripe checkout email when no verified email is linked yet. Leave any of them unset to disable the send path.
- `HOSTED_SIGNUP_NOTIFICATION_EMAILS` optionally enables a plain-text internal notification to comma-separated recipients when Stripe reconciliation accepts a hosted signup or trial activation. Leave it unset to disable the internal notification path.
- `HOSTED_SIGNUP_WELCOME_EMAIL_TIMEOUT_MS` optionally bounds the Resend request timeout; the default is 10 seconds.
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_PRIVY_CLIENT_ID`
- `PRIVY_CUSTOM_AUTH_DOMAIN`
- `PRIVY_BASE_DOMAIN`
- `PRIVY_APP_SECRET`
- `PRIVY_VERIFICATION_KEY`
- `HOSTED_ONBOARDING_INVITE_TTL_HOURS`
- `HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS`
- `HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS` for local `pnpm dev` or hosted-local runs only. Set this in local env when a development tunnel shares real Linq credentials so non-allowlisted inbound senders are accepted and ignored before mailbox append or assistant wake. Do not set it in production.
- `HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER`
- `RETELL_API_KEY`, `RETELL_FROM_NUMBER`, `RETELL_AGENT_ID`,
  `RETELL_AGENT_DATA_STORAGE_SETTING=basic_attributes_only`, and optional
  `RETELL_AGENT_VERSION` enable hosted Retell phone calls, signed `ask_murph`
  custom-function verification, and signed Retell lifecycle webhooks. Keep the
  published Retell agent configured for basic-attributes-only storage and point
  function/webhook URLs at the deployed `apps/web` routes.
- `RETELL_WEBHOOK_PUBLIC_BASE_URL` optionally overrides the Retell lifecycle
  webhook origin per created call. Leave it unset in production unless you are
  deliberately overriding the published agent webhook; root `pnpm dev` sets it
  from the managed local public tunnel when that tunnel is running.
- `MURPH_TELEGRAM_USERNAME_OVERRIDE` optionally overrides user-facing Murph Telegram links. It is not a secret and is exposed to the browser bundle so local Vercel dev can point links at a development bot, for example `@murphdevelopment_bot`.
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY`
- `HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID` optionally selects a dedicated Family Billing Portal configuration.
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_API_BASE_URL`
- `HOSTED_EXECUTION_CONTROL_URL`
- `HOSTED_EXECUTION_CONTROL_TIMEOUT_MS`

Hosted managed crypto:

- `HOSTED_CRYPTO_ENV`
- `HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME`
- `HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION`
- `HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM`
- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK`
- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID`
- production Vercel OIDC / GCP Workload Identity Federation:
  `HOSTED_CRYPTO_GCP_PROJECT_NUMBER`,
  `HOSTED_CRYPTO_GCP_SERVICE_ACCOUNT_EMAIL`,
  `HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_POOL_ID`, and
  `HOSTED_CRYPTO_GCP_WORKLOAD_IDENTITY_PROVIDER_ID`
- local/dev escape hatch: `HOSTED_CRYPTO_GCP_ACCESS_TOKEN` with
  `HOSTED_CRYPTO_ALLOW_STATIC_GCP_ACCESS_TOKEN_FOR_DEV=1`; production must use
  Vercel OIDC / GCP Workload Identity Federation
- production IAM setup must stay least-privilege:
  - bind only the Vercel production project/environment principal, for example
    `principal://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/<pool-id>/subject/owner:<vercel-team>:project:<vercel-project>:environment:production`;
    do not bind all pool members
  - grant that principal `roles/iam.workloadIdentityUser` on the hosted crypto
    service account so the app can call IAMCredentials `generateAccessToken`
    without a service-account key
  - grant the hosted crypto service account Cloud KMS access only on the
    specific keys it uses: `roles/cloudkms.cryptoKeyEncrypterDecrypter` on
    `HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME` and `roles/cloudkms.signer` on the
    key containing `HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION`
  - do not grant project-wide Owner/Editor, broad Cloud KMS admin, or
    `cloud-platform`-only access as a substitute for the IAM/KMS split
- optional future recipients:
  `HOSTED_CRYPTO_TEE_RUNTIME_PUBLIC_JWK`,
  `HOSTED_CRYPTO_TEE_RUNTIME_KEY_ID`,
  `HOSTED_CRYPTO_TEE_RUNTIME_POLICY_ID`,
  `HOSTED_CRYPTO_RECOVERY_PUBLIC_JWK`, and
  `HOSTED_CRYPTO_RECOVERY_KEY_ID`; configure the recovery pair together, and
  configure the TEE runtime public key, key ID, and policy ID together

Hosted AI usage metering:

- Hosted AI usage rows are recorded locally for allowance, audit, and future billing analysis. The hosted app no longer attaches Stripe usage prices at checkout or posts Stripe meter events.
- Hosted AI included-allowance gating is app-owned: web prices recorded `HostedAiUsage` rows into allowance columns, maintains `HostedAiUsagePeriod` spend snapshots from current hosted billing state, and gates hosted runtime work that strongly implies foreground model work. It is a post-task hard stop, not an exact prepaid cap.
- Homepage reset countdowns come from the same usage-gate period end/retry-after value; a fresh monthly period is created by the next mutating gate resolution after the prior billing or calendar period ends (turn admission owns usage-period bookkeeping; hot-path gate checks are read-first and only escalate to the mutating gate to confirm denials), with no separate reset cron. Spend accounting also ensure-creates the period inside the spend transaction as a backstop.
- Temporal does not fetch or forward signed usage decisions to Cloudflare ensure-processing, and webhook wake handoff signals Temporal by mailbox pointer only. Runtime/provider code still enforces spend before actual model calls and records usage rows through the hosted runtime platform.
- Pulse Trial uses the same allowance system with a phase-aware 4.50 USD trial cap. Paid phase is authoritative for the normal Pulse allowance, and stale or malformed trial phase denies before calendar fallback or fallback-usage carryover.
- Included-allowance accounting starts from the deployment that enables allowance accounting on imports. Existing current-period usage rows are not backfilled by default.

`apps/web` records every hosted assistant usage row by member in `HostedAiUsage`.
Hosted execution accepts Murph-owned usage rows with `stripeMeterSource=murph`.
Recorded rows keep `stripeMeterStatus=skipped` so they cannot be backbilled by
the removed Stripe meter path. The hosted allowance gate reads web-owned spend,
and the runtime/provider layer enforces spend before actual model calls instead
of relying on a Cloudflare-start signed decision.

Hosted pages assume the hosted Privy phone-auth setup is present and fail fast
when it is missing instead of carrying fallback branches in page code.

### Local Stripe webhook listener

`pnpm dev` auto-launches `stripe listen --forward-to http://<web-host>:<web-port>/api/hosted-onboarding/stripe/webhook`
and captures the listener's live `whsec_...` signing secret from its startup
output. The captured secret is injected into the web dev child's env as
`STRIPE_WEBHOOK_SECRET` before Next.js boots, so hosted onboarding checkout
works locally without a second terminal.

- The listener's signing secret is per-developer (tied to each operator's
  Stripe CLI login), so sharing a single `STRIPE_WEBHOOK_SECRET` in Vercel
  Development env does not work for a multi-dev team. Remove that value from
  Vercel Development so the captured secret takes over.
- An explicit shell `STRIPE_WEBHOOK_SECRET` or repo-root `.env`
  `STRIPE_WEBHOOK_SECRET` is preserved over the captured value. A stale value
  that would otherwise arrive only through `vercel env pull` is discarded.
- If the Stripe CLI is not on `PATH`, the orchestrator logs an actionable
  warning (`brew install stripe/stripe-cli/stripe`) and continues without the
  listener. Hosted onboarding checkout will fail locally until the CLI is
  installed or `STRIPE_WEBHOOK_SECRET` is set explicitly.
- The listener runs alongside `cloudflare` and `web` but is treated as an
  ancillary process: if it exits post-startup, the orchestrator logs a
  degraded-mode warning and keeps the rest of the stack running. Restart
  `pnpm dev` to recover webhook forwarding.
- Set `MURPH_DEV_SKIP_STRIPE_LISTEN=1` to fully opt out of the auto-listener
  (for example, when running integration tests with a mocked webhook surface).
- Captured secret bytes are redacted before they reach the orchestrator's
  stdout pipe, stderr pipe, and output-tail buffers, so operator logs never
  contain the live `whsec_...`.

#### Full local test-mode checkout

The local hosted signup flow uses real Stripe Checkout against Stripe's test
environment; it does not use an in-process fake checkout service. To complete
the flow without moving real money:

1. Configure test-mode Stripe values in `.tmp/.env.hosted-local-stripe`,
   `apps/web/.env.local`, or shell env:
   - `STRIPE_SECRET_KEY=sk_test_...`
   - `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY=price_...`
   - `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY=price_...`
   - `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY=price_...`
2. Install and log in to the Stripe CLI once with `stripe login`.
3. Run root `pnpm dev` without `MURPH_DEV_SKIP_STRIPE_LISTEN=1`; the dev
   orchestrator starts `stripe listen` and injects the captured
   `STRIPE_WEBHOOK_SECRET` into the web process.
4. Use a real hosted onboarding invite and continue to checkout. The dev-only
   `/join/<inviteCode>?preview=checkout` URL is only a UI preview; pressing its
   checkout button still calls the real checkout API.
6. On the Stripe-hosted Checkout page, use Stripe's interactive test card
   `4242 4242 4242 4242` with any future expiration date and any three-digit
   CVC. Stripe test cards are valid only in test environments.

Root `pnpm dev` loads Stripe env in this precedence order: repo-root `.env`,
Vercel Development env, `apps/web/.env`, `apps/web/.env.local`,
`.tmp/.env.hosted-local-stripe`, then the shell env. Local dev refuses
`sk_live_...` and `rk_live_...` keys by default so test checkout cannot
accidentally move real money; set `MURPH_DEV_ALLOW_LIVE_STRIPE=1` only for an
intentional live-mode local run.

Stripe's docs for this contract are:

- Test environments do not make actual charges or move real money:
  https://docs.stripe.com/testing-use-cases
- Interactive test cards require test API keys:
  https://docs.stripe.com/testing
- `stripe listen --forward-to ...` forwards sandbox events locally and prints
  the signing secret used for webhook signature verification:
  https://docs.stripe.com/stripe-cli/use-cli

## Hosted public origin and Cloudflare callback auth

This section is the operator-facing contract for hosted public origin and the
narrow Cloudflare-to-web signed callback surface.

Public origin precedence:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL` wins for invite and join links
- otherwise `HOSTED_WEB_BASE_URL` is the canonical hosted-web public base URL
- on Vercel, when neither explicit hosted public-base env is set, `apps/web`
  falls back to `VERCEL_PROJECT_PRODUCTION_URL`
- `DEVICE_SYNC_PUBLIC_BASE_URL` overrides the provider-facing callback and
  webhook base for hosted device sync; when unset, `apps/web` derives that base
  as `<canonical hosted public origin>/api/device-sync`

Hosted public-base constraints:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL`, `HOSTED_WEB_BASE_URL`, and the
  `VERCEL_PROJECT_PRODUCTION_URL` fallback are origin-only values. Do not set
  them to subpaths such as `https://example.test/app`.
- `DEVICE_SYNC_PUBLIC_BASE_URL` remains the one explicit callback-base override
  that may include its `/api/device-sync` path because that route base is part
  of the device-sync provider contract.

Callback auth contract:

- `apps/web` verifies narrow Cloudflare-signed internal callbacks with
  `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK`
- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID` selects the active callback key id and
  defaults to `v1`
- `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON` is the optional
  `{ keyId: publicJwk }` verification keyring for staged rotation
- `apps/cloudflare` signs those callbacks with
  `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK` stays in the Cloudflare worker
  boundary; the isolated execution child talks back through the worker-owned
  `web-control.worker` proxy instead of receiving the signing key directly
- Hosted member private fields, device-sync credentials, mailbox payloads, and
  runtime execution state use signed hosted domain-root secure-box envelopes;
  lookup fingerprints/indexes use separate HMAC-only keys.

When you set `DEVICE_SYNC_PUBLIC_BASE_URL`, point it at the stable production
project domain or a custom domain. Do not use ephemeral preview deployment URLs
as long-lived provider callback or webhook bases.

### Vercel setup

Set these under `Settings -> Environment Variables` in the Vercel project that
deploys `apps/web`. Production is the minimum.

- Enable Vercel OIDC so the app-local hosted-execution auth adapter can present
  workload identity to Cloudflare on dispatch and status requests.
- Set `CRON_SECRET` for the hosted cron routes under `/api/internal/**/cron`.
- Configure the hosted public-origin envs and `HOSTED_WEB_CALLBACK_SIGNING_*`
  values exactly as described above.
- Set `HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS` and, if needed,
  `HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER`.
- Set `DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET` to the same value used by the
  trusted auth edge that signs browser assertions for lower-level device-sync
  bridge routes.
- Set `DEVICE_SYNC_BACKFILL_DIAGNOSTIC_ENABLED=true` when admin
  device-sync diagnostics should be available outside localhost.

## Browser auth contract

The lower-level assertion-backed device-sync bridge routes, such as
`POST /api/device-sync/agents/pair`, trust a front-end/auth proxy only when it
attaches:

- a base64url JSON assertion in `DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER`
- an HMAC signature for that assertion in `DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER`

The signed assertion must include hosted user claims plus:

- `iat` and `exp` with a lifetime of at most 5 minutes
- a strong random `nonce`
- `aud`, `method`, `path`, and `origin` bindings for the current request

Each assertion nonce is consumed once so replayed assertions fail even if the
user tuple is unchanged.
There is no unauthenticated development-user fallback; local development must
exercise the same signed assertion contract.

## Secret hygiene and rotation

- Keep committed `.env.example` placeholder-only.
- For local hosted-web work, prefer Vercel-backed process injection via
  `cd apps/web && pnpm dev` instead of writing real secrets to repo-local env files.
- Treat leaked raw repo archives that included local hosted env files the same
  way as direct secret exposure.
- Rotate `HOSTED_DEVICE_ROUTING_INDEX_KEY` if the provider-account routing index
  key is exposed. Device-sync token plaintext is protected separately by the
  hosted `device` domain secure-box root.
- Durable hosted device-sync authority now lives on the web/device-sync side.
  Cloudflare consumes explicit execution-time snapshots and signed writebacks only; token rotation or
  revocation must follow the web-owned control-plane path instead of relying on
  worker-owned runtime state.

## Prisma

Generate the client and apply migrations with Prisma:

```bash
pnpm --dir apps/web prisma:generate
pnpm --dir apps/web prisma:migrate:deploy
pnpm --dir apps/web release:production:migrate
pnpm --dir apps/web release:production:contract-migrate
```

The checked-in Vercel build command runs
`pnpm release:production:migrate && pnpm build`, so Vercel deploys still run
the guarded production migration wrapper automatically before building. The
generic `pnpm --dir apps/web build` script is intentionally non-mutating and
only generates artifacts plus validation output. The predeploy migration
wrapper uses `DIRECT_DATABASE_URL` when it is set, requires it in Vercel
production, rejects known pooled Postgres ports such as `6432` and `6543`, and
blocks destructive or incompatible Prisma migration SQL outside the frozen
historical `20260707170000_drop_stale_linq_recency_columns` baseline; keep
`DATABASE_URL` available for app runtime traffic. Because a successful
predeploy migration cannot roll back automatically if a later deploy step
fails, normal production Prisma migrations must stay backward compatible with
the currently deployed app and avoid old-code-breaking changes such as required
columns, drops, renames, `SET NOT NULL`, or column type changes. Those changes
need an expand/backfill/switch/final-cleanup sequence: add the new nullable
shape first, backfill or dual-write as needed, switch application reads/writes
in a later deploy, then clean up the old shape only after the replacement
deployment is live and the prior production function window has drained.
Destructive contract cleanup belongs under
`apps/web/prisma/contract-migrations` and runs through the
`Hosted Web Contract Migrations` GitHub workflow after Vercel reports a
successful production deployment. That workflow only accepts Vercel-originated
deployment statuses, checks out the exact deployed commit, verifies it is
reachable from `origin/main`, waits `HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS`
seconds for prior production function executions to drain, then verifies the
configured Vercel production alias still points at that commit before exposing
the database secret. It requires
`HOSTED_WEB_VERCEL_TOKEN`, `HOSTED_WEB_VERCEL_PROJECT_ID`,
`HOSTED_WEB_PRODUCTION_BASE_URL`, and `HOSTED_WEB_DIRECT_DATABASE_URL` in
GitHub Actions; `HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS` defaults to
`300` and is capped at `600` unless the workflow timeout is raised. The workflow
does not cancel in-progress runs when stale deployment-status events arrive;
the final alias check and the contract migration advisory lock make stale or
duplicate runs skip safely. After those gates, it calls
`pnpm --dir apps/web release:production:contract-migrate` with explicit opt-in.
The `2026062100_hosted_computer_single_member_profile` migration is an explicit
greenfield computer-use hard cut: deploy it only as part of a coordinated
hosted web plus Worker cutover with hosted computer-use traffic paused during
the skew window.

## Production build memory guard

The hosted web production build must keep fitting Vercel's Standard build
machine: 4 vCPUs, 8 GB RAM, and 32 GB disk. The CI guard currently observes the
production `next build` in a root-level cgroup-v2 child for accounting only. It
does not write `memory.max`, `memory.swap.max`, or `memory.oom.group`.

The default advisory budget is 7,200,000,000 cgroup-accounted bytes: the 8 GB
machine model minus a 0.8 GB reserve for OS/container overhead outside the build
cgroup at the ceiling. The legacy-named
`MURPH_HOSTED_WEB_BUILD_MEMORY_CAP_BYTES` override is still validated as this
advisory budget: strictly greater than the 6,000,000,000-byte
known-false-positive cgroup floor and less than or equal to 7,200,000,000 bytes.

PR #349 is historical RSS context only. It calibrated this repo's local
single-process peak-RSS measurement method against the Vercel failure mode:

```bash
/usr/bin/time -l env NEXT_TELEMETRY_DISABLED=1 VERCEL=1 VERCEL_ENV=preview pnpm --dir apps/web build
```

That calibration found 5.34 GB peak RSS passing and 6.18 GB peak RSS failing
with exit 137 on the 8 GB Vercel builder. Those numbers are RSS units and are
not comparable to cgroup `memory.current`, which includes anonymous memory
across all build workers plus page cache. A fully working Linux CI run on
2026-07-06 proved the mismatch: a 6,000,000,000-byte cgroup cap OOM-killed a
build that the real 8 GB Vercel Standard machine accepts.

Linux CI defaults to wrapping the `apps/web verify` production `next build` step
with `apps/web/scripts/build-memory-guard.sh`. Privileged operations are limited
to creating/removing that measured cgroup and moving the build process into it;
the build itself still runs as the invoking user with its normal environment,
working directory, and stdio.

Enforcement is deferred because live CI on 2026-07-07 showed the cold-build
multi-process anonymous-memory ramp is not governed by the Turbopack heap limit:
with `turbopackMemoryLimit=3GiB`, anon climbed about 2.9 GB at 12 seconds, 5.5
GB at 27 seconds, and 6.9 GB at 42 seconds before an OOM-group kill, matching
the prior 4 GiB run. Any hard cgroup limit that leaves a meaningful reserve on
the 8 GB machine would currently false-fail the cold build. Cold-build memory
optimization is the follow-up work; production config should not carry
unproven heap-limit churn from the 3 GiB trial.

The guard samples cgroup `memory.current` and selected `memory.stat` fields
about every 3 seconds during the build, prints trajectory lines about every 15
seconds, then reports sampled maxima before cgroup `memory.peak`,
`memory.events`, and selected final-read `memory.stat` values. If sampled max
anon or `memory.peak` exceeds the advisory budget, it prints a loud
`WOULD EXCEED` warning, but the guard exits with the wrapped build's status.
It still fails closed when cgroup v2, the root memory controller, passwordless
`sudo`, or peak accounting are unavailable.
Disabling the guard in Linux CI requires `MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD=0`
and logs a prominent warning that the Vercel Standard-machine memory budget is
not being measured.
Local non-Linux wrapper validation may use
`MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD_MODE=passthrough`; that mode is rejected in
CI and does not prove cgroup accounting.

Flipping back to enforcement means restoring the `memory.max`,
`memory.swap.max`, and `memory.oom.group` writes after the cold build fits under
the advisory budget with the machine-model reserve intact.

The hosted schema now includes the canonical member slices, hosted email
authorization, device-sync web ownership models, the anonymized hosted
assistant-runtime issue sink, canonical hosted mailbox rows, hosted workspace
checkpoints, and hosted runtime logs/status.
This branch is a greenfield hosted-runtime cutover. If you have an older local
database from the superseded run/ingress/cursor chain, reset it before
reapplying migrations.

## Local dev aids

Dev-only helpers for iterating on UI. All guarded by `process.env.NODE_ENV !== "production"` and removed from the production bundle.

- `/join/<inviteCode>?preview=<stage>` and `/join/<inviteCode>/success?preview=<stage>` render any signup-flow stage without a real invite. Stages: `invalid`, `expired`, `verify`, `checkout`, `messaging-setup`, `blocked`, `active`, `active-pending`. Disables the status-refresh poll so the mocked status is not overwritten.
- CSP allows `https://ui.sh` only in development so the `ui-picker` toolbar can load during design iteration. Production CSP is unchanged.

## Local verification

- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web test`
- `pnpm --dir apps/web verify`

Notes:

- For local dev with hosted secrets, run `cd apps/web && pnpm dev` so Vercel
  injects the linked project's development env without writing a local env file.
- Hosted local cross-app startup probes `GET /api/internal/health` instead of
  the homepage so E2E readiness depends on the web process being alive, not on
  landing-page-only imports.
- `apps/web/prisma.config.ts` reads `DATABASE_URL` from the process environment only.
- `pnpm --dir apps/web dev` keeps interactive Next dev artifacts under
  `apps/web/.next-dev`.
- `pnpm --dir apps/web build` and `pnpm --dir apps/web start` use `apps/web/.next`.
- Treat `apps/web/.next`, `apps/web/.next-dev`, and `apps/web/.next-smoke` as
  generated local artifacts that must stay out of commits and raw source bundles.
- Hosted internal cron paths accept only Vercel cron bearer auth via
  `CRON_SECRET`.
- Hosted Stripe reconciliation now commits local billing facts plus inline
  `member.activated` hosted mailbox input first, then performs activation-path
  managed-user crypto provisioning. Later successful invoices for an already
  active member must not append a new activation welcome or trigger another
  Resend welcome email.

## Main routes

Browser-facing wearable connection start/completion routes:

- `POST /api/connect-sources/:sourceId/start`
- `GET /device-sync/connect/complete`

Hosted settings-authenticated wearable routes:

- `GET /api/settings/device-sync`
- `GET /api/settings/device-sync/connections/:connectionId/status`
- `POST /api/settings/device-sync/connections/:connectionId/disconnect`
- `POST /api/settings/email/sync`

Assertion-authenticated browser-to-agent bridge routes:

- `POST /api/device-sync/agents/pair`

Public provider-facing routes:

- `GET /api/device-sync/oauth/:provider/callback`
- `POST /api/device-sync/webhooks/:provider`
- `GET /api/device-sync/webhooks/oura`
- `GET /api/device-sync/webhooks/strava`
- `POST /api/hosted-onboarding/linq/webhook`
- `POST /api/hosted-onboarding/telegram/webhook`

Local-agent routes:

- `POST /api/device-sync/agent/connections/:connectionId/export-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/refresh-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat`

Internal hosted maintenance and Cloudflare callback routes:

- `POST /api/internal/device-sync/connect-targets/:connectTarget/connect-link`
- `POST /api/internal/device-sync/runtime/snapshot`
- `POST /api/internal/device-sync/runtime/apply`
- `POST /api/internal/device-sync/runtime/dirty-pending`
- `POST /api/internal/device-sync/runtime/dirty-ack`
- `POST /api/internal/hosted-execution/usage/record`
- `POST /api/internal/hosted-mailbox/fetch`
- `POST /api/internal/hosted-mailbox/payload/fetch`
- `POST /api/internal/hosted-mailbox/email-ingress`
- `GET /api/internal/hosted-runtime/status`
- `POST /api/internal/hosted-runtime/log`
- `GET /api/internal/hosted-workspace`
- `POST /api/internal/hosted-workspace/checkpoint`
- `POST /api/internal/computer/runs`
- `POST /api/internal/computer/runs/:runId/act`
- `POST /api/internal/computer/runs/:runId/os-control`
- `POST /api/internal/computer/runs/:runId/pause-for-user`
- `POST /api/internal/computer/runs/:runId/finish`
- `GET /api/internal/hosted-onboarding/stripe/cron`

The old staged-payload and deleted import completion/release callback routes
are gone. Cloudflare no longer round-trips through broad mirror CRUD routes,
deleted sharing CRUD, local-vault import callbacks, or an outbox drain route. It
still uses narrow signed hosted-web callbacks for execution-time device-sync
runtime snapshot/apply, device connect-link starts, direct hosted usage
recording, and mailbox/workspace runtime status plus log callbacks.

## Hosted onboarding routes

Hosted onboarding surfaces:

- `GET /`
- `GET /join/:inviteCode`
- `GET /join/:inviteCode/success`
- `GET /join/:inviteCode/cancel`
- `GET /api/hosted-onboarding/invites/:inviteCode/status`
- `POST /api/hosted-onboarding/invites/:inviteCode/send-code`
- `POST /api/hosted-onboarding/invites/:inviteCode/send-code/confirm`
- `POST /api/hosted-onboarding/invites/:inviteCode/send-code/abort`
- `POST /api/hosted-onboarding/privy/complete`
- `POST /api/hosted-onboarding/billing/checkout`
- `GET /api/hosted-onboarding/billing/success`
- `POST /api/hosted-onboarding/linq/webhook`
- `POST /api/hosted-onboarding/stripe/webhook`

The onboarding lane is intentionally thin:

- Linq or the public landing page can start phone-bound signup.
- Privy verifies login, linking, and security-sensitive identity operations;
  successful hosted completion issues a first-party opaque app session stored as
  a hashed `HostedWebSession`.
- Stripe Checkout is subscription-only. `invoice.paid` remains the normal
  positive entitlement source, with one metadata-gated exception: a valid
  Pulse Trial Checkout completion can activate Pulse in `trial` phase.
- Hosted webhook receipts are retry journals for receipt-local side effects,
  not a second execution lifecycle authority.
- Temporal-bound execution from onboarding and exact message ingress appends
  canonical hosted mailbox input first. Device-sync webhook freshness records
  dirty state in the same transaction, appends a bounded `device-sync.wake`
  mailbox handoff only on clean-to-dirty transitions, then signals Temporal by
  mailbox pointer. Post-commit signal failures are logged as best-effort
  mailbox handoff failures. The dirty row stays the source of truth until the
  runtime checkpoints it.
- Verified email sync updates canonical hosted email-authorization facts in web
  storage; it does not write hosted execution env.

Current hosted billing assumptions:

- Hosted checkout is always Stripe subscription mode.
- The launch tiers are monthly Stripe subscription prices; annual checkout is disabled for now.
- `invoice.paid` is the paid activation and paid-cycle source of truth.
- `checkout.session.completed` normally binds refs only, except for the
  Pulse Trial offer (`pulse_trial_7d`) when metadata, member ownership, and
  the expanded/retrieved subscription prove an active seven-day trial.
- `customer.subscription.*` does not newly activate access and cannot promote
  a Pulse Trial to paid before the accepted paid invoice.
- Chargebacks, disputes, and refunds suspend hosted access pending manual review.
- No-card Pulse Trial signup is the default checkout-stage path when billing is
  configured and messaging setup is complete. Set
  `HOSTED_AUTO_PULSE_TRIAL_ENABLED=0` only to force card checkout fallback.
- Card-based Pulse Trial checkout fallback is gated by
  `HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED=1`.
