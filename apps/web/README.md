# @murphai/hosted-web

Hosted integration control plane for Vercel deployments.

## Frontend design proof

The live design catalog is available at `/design`. Every pull request that
changes user-facing frontend UI must render the real production component on
`/design?tab=components`, or the complete composed section or flow on
`/design?tab=sections`. Include hosted desktop and mobile screenshots captured
from that catalog surface in the PR so reviewers can judge the UI without
reconstructing the state locally. The `Frontend design proof` workflow enforces
the catalog update and PR evidence contract.

`apps/web` is the canonical hosted control plane. Hosted product meaning lives
in Postgres here, not in Cloudflare worker control storage. In particular,
`apps/web` owns hosted member identity, routing, billing, email authorization,
device-sync control-plane authority, the hosted AI usage and usage-credit ledgers,
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
browser handoff. Members with a resolved text contact see the contact-card picker
first and then the production four-step Murph personality picker; members without
one start at the personality picker. A successful save opens the final Welcome to
Murph dialog with the resolved messaging action; skipping or dismissing the
personality picker ends the handoff without it. The page strips the query parameter
on mount so ordinary `/home` visits are not blocked.
Login-oriented landing CTAs continue to route to `/home`.

`apps/cloudflare` remains the execution-only runtime boundary. It accepts
authenticated execution intents, restores encrypted runtime state, runs a
workspace-runtime pass, and checkpoints through the web-owned workspace CAS. It may hold
opaque encrypted runtime blobs and explicit execution-time callback data, but it is not the
canonical owner of hosted product facts.

## Browser-vault member-proof rollback floor

Successful browser-vault session responses in the `empty` and `not_modified`
states carry the authenticated member's non-empty `memberId`. Ready responses
bind that identity through the encrypted replica AAD's `userId` instead of a
redundant top-level field. The browser client fails closed when either
non-ready success response omits its member proof; only the local synthetic
401/403 empty result intentionally uses `memberId: null`.

PR #586 is the permanent hosted-web rollback floor for this contract. The
production alias and retained ready deployments were proved to descend that
producer before the omitted-field reader was removed. Do not roll the Web
alias below #586: a browser loaded from a current deployment can outlive an
alias change and reject an older producer's unproved response. For an incident,
deploy a forward fix or roll forward to #586 or newer.

## Approval-outcome deployment compatibility

Approval decisions unconditionally append the generation-scoped reconciliation
wake. Keep Web at the first bundle that serves the internal action-approval read
route or newer, and keep the runtime at the first bundle that parses
`runtime.pending-effects-reconcile-requested` or newer. A rollback below either
permanent floor requires a separate migration or a forward fix that removes the
dependency; there is no environment toggle that makes a below-floor rollback
safe. See `agent-docs/references/hosted-runtime-protocol.md` and
`apps/cloudflare/DEPLOY.md` for the durable-row and committed-snapshot proof
required before any such migration.

## Direct-login deferred-checkpoint deployment compatibility

A completed direct-login handoff now means "the user completed takeover; the
profile checkpoint is pending until an authorized resume," rather than "the
profile checkpoint already finished." That persisted semantic change is
necessary for Done to return before Kernel stop/save/replacement work. A prior
web bundle will instead reuse the old task browser, mark the run running, and
consume `pendingHandoffId` without performing the deferred checkpoint.

The first production web deployment containing the deferred-checkpoint claim is
therefore the rollback floor while any matching active row can exist. Record the
production alias at that head and confirm prior web functions have drained before
treating the rollout as established. Do not roll below the floor until a database
check proves there is no active `awaiting_user` run whose pending direct-login
handoff has non-null `completedAt` and status `completed` or `checkpointing`.
After deferred writes stop, waiting one full one-hour active-run TTL before that
zero-row check provides the bounded drain condition. This is a web-only rollout;
it does not require a coordinated Cloudflare deployment.

When a valid `idle_shutdown` checkpoint matches the locked workspace version,
web commits it even if a newer durable conversation row is pending. The same CAS
commits the request snapshot, redacted watermarks, and wake projection as one
prefix, and Web returns the optional transient
`conversationInputAhead` observation so a live default-mode runtime can import
immediately; during retention-only work or shutdown, the durable mailbox row
remains the recovery source. Current
web does not return `foreground_pending`; that response remains runner/parser
compatibility for old web deployments only.
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

The experiment detail routes compose two narrow data sources:

- Health Commons is the public protocol source of truth. Server components resolve generated route projections for the Protocol, Research, and public portion of Your results.
- The browser vault is the private run source. The Your results client decrypts the dashboard snapshot in-browser, projects the matching active run or newest completed run, and renders private status, timeline, context, next-step, and outcome fields. Completed and low-confidence runs remain reachable at `/experiments/[experimentId]/results`.

Private measurements and conclusions never enter the server-rendered route payload. Public protocol prose, citations, and commons revisions are never copied into private run state.

## Saved biomarker reference context

Saved lab-result pages keep the imported source flag and per-result laboratory
range authoritative. A normalized latest source range may appear on the chart
as two dashed boundary rules or an exact one-sided limit. If the latest
comparable result has no usable numeric source range, the server may provide an exact-unit,
sourced Health Commons range labeled `Published adult comparator`; its legend
states that it is not the reporting lab's range. The browser requires an exact
unit and eligible coarse specimen kind, and it does not infer ranges, convert
units, or use a comparator to relabel the result. The initial catalog contains
named Mayo Clinic Laboratories adult serum intervals for chloride, LDH,
phosphate, and total protein. Missing, mismatched, and context-dependent
specimens omit the comparator.

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
- immutable hosted AI usage rows plus append-only purchased usage-credit entries
  and their bounded member balance projection in Postgres
- event-id keyed Linq first-contact classifier decisions with no classifier
  prompt/response bodies; the legacy rejected-message-text column is an ignored
  deploy-skew compatibility column and is scrubbed by migration
- bounded hosted product-feedback rows for explicit structured product feedback
- member-bound hosted phone-call rows for web-owned Retell starts and signed
  Retell function/webhook results
- Kernel-backed hosted computer runs, Live View handoffs, and durable Managed Auth connections
- hosted Stripe receipt/retry state, subscription reconciliation, one-time
  usage-credit reconciliation, and onboarding webhook receipts
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

- `HostedMember` is the core member row plus activation/billing status. Its
  nullable assistant tone, voice, Humor, Push, and Detail columns are only the
  authenticated Settings display/write projection; canonical assistant
  preferences remain in `bank/preferences.json`. Settings writes strict sparse
  deltas through the hosted mailbox instead of treating these columns as a
  canonical snapshot. Hosted conversation set/reset uses the signed,
  input-bound Web transaction to update requested personality columns and
  their nullable projection watermarks atomically with a sparse origin-turn
  mailbox event when at least one requested dial applies. The mailbox owner assigns one immutable causal
  sequence across conversation and system lanes, and the canonical companion
  `bank/assistant-preference-mutations.json` retains only per-setting applied
  watermarks. For Humor, Push, and Detail, both owners apply the same
  equality-aware field-local order; timestamps are never conflict authority.
- `HostedMemberIdentity` owns recoverable member identity facts
- `HostedMemberRouting` owns hosted channel routing facts
- `HostedMemberBillingRef` owns Stripe/customer subscription references
- `HostedMemberEmailAuthorization` owns verified-email and sender-authorization facts
- `HostedConsentEvent` and `HostedConsentGrant` own append-only legal consent
  history plus current launch-required and optional feature-consent state
- `HostedMailboxItem`, `HostedMailboxPayload`, and `HostedMailboxLaneCounter`
  own append-only encrypted execution inputs, per-lane progress sequences, and
  the serialized per-member causal sequence carried across lanes. New
  conversation-message rows also store a nullable server-keyed lookup of their
  existing deterministic assistant input id, never the raw id. Web derives the
  configured lookup-key candidates from the callback id and uses the matching
  database projection to bind
  personalization writes to a live member-owned conversation row; it does not
  change the mailbox wire, `sourceRef`, or event id. The same row may hold one
  nullable subscription-action claim as operational metadata. Web claims the
  first action atomically, permits an exact retry, and rejects a conflicting
  action; the claim leaves with the row under existing mailbox retention.
- `HostedWorkspace` owns the latest encrypted checkpoint pointer and redacted
  status projection
- `HostedRuntimeLog` owns bounded redacted observability events
- Temporal orchestrates per-user execution wakeups; Cloudflare only executes or
  wakes a bound runtime and does not own a queue, mailbox cursor, or web-visible
  run recovery ledger
- `HostedAiUsage` owns the canonical hosted usage ledger
- `HostedUsageCreditPurchase` owns the immutable payer, beneficiary, offer,
  frozen Checkout request, and reconciliation state for one intentional
  top-up. `HostedUsageCreditEntry` is the append-only credit source of truth;
  `HostedMember` holds only its bounded balance/version projection.
- `HostedProductFeedback` owns assistant-captured structured product feedback
  with only a bounded product-only summary, kind, and optional changelog ids,
  without storing raw conversation text, health details, tags, topics, or provider payloads
- `HostedPhoneCall` owns one member-bound Retell phone-call row per real call
  with a bounded call brief, provider call id, status, and final analysis
  result. Briefs and results use member/table/row/field/scope-bound hosted
  secure-box ciphertext; new writes never populate the nullable legacy JSON
  columns. Retell credentials stay in web env, transfer destinations are resolved
  from verified member identity, and raw transcripts/audio are not stored in
  Murph. The call row persists the exact initiating resident-session id for
  request-key idempotency. Final analysis appends an
  `assistant.notification.requested` system-mailbox event: Murph composes the
  result in its own voice and proactively messages the member's resolved
  messaging route, and may skip a non-meaningful result (allow-send-or-skip).
  The result JSON is framed as untrusted provider/callee text. The web owner
  bounds the aggregate start path at 40 seconds. Because
  Retell create-call has no documented idempotency contract, a connection or
  timeout ambiguity preserves the durable row as `starting`; the same request
  key never blindly creates another provider call. Exact replays resolve the
  durable row before new-call transfer, encryption, or access
  prerequisites. After the reservation commits, a pointer-only web Workflow is
  armed within the same 40-second aggregate deadline and before Retell dispatch,
  so the durable row remains blocking authority while the bounded Workflow
  reconciles ambiguous starts, provider-id binding failures, unsafe cleanup,
  and terminal provider usage after callback loss.
  Immediately before Retell dispatch, web advances the reservation epoch; a
  reconciliation attempt may mutate only the exact epoch it read, preventing an
  older no-match result from releasing a newly dispatched call. Recovery resolves
  the stable Murph metadata id through Retell:
  a unique safe call binds once, an authoritative no-match fails the
  reservation, and provider unavailability retries without another create.
  While start authority or a known unsafe-storage cleanup remains unresolved, a
  different request cannot reserve a second call. An unsafe-storage call retains
  its provider id as failed cleanup authority even when the compensating stop
  succeeds; consultation rejects it,
  and deletion proves the stop before local authority can be removed. A signed
  consultation callback may omit Retell's optional storage field only when its
  provider id is already bound; an unbound row requires explicit safe storage
  before the callback may claim provider authority.
  Account deletion first suspends the member under the same row lock used by
  call reservation, stops known calls in deterministic batches of eight within
  a 35-second aggregate deadline, and asks the existing deletion owner to retry
  while another batch or unresolved reservation remains. The final transaction
  still proves every active or cleanup-pending provider call stopped before
  deleting local call authority or user crypto material.

  Canonical account deletion also inserts one foreign-key-free, KMS-encrypted
  external-cleanup receipt in the same transaction before removing member
  rows. The immediate attempt and existing hourly retention sweep share that
  idempotent owner for Cloudflare runner/R2, Stripe-customer, and Privy cleanup;
  unconfigured or partial targets stay pending, completed targets are skipped,
  and the receipt is removed only after convergence. Immediate target calls are
  bounded to five seconds plus a small receipt-settlement margin; hourly retries
  use fifteen-second target bounds and four-receipt concurrency. Cloudflare is
  terminal only when the capability-bearing Worker explicitly confirms
  `deleteAllCompleted`, so a legacy response cannot erase retry ownership.

The 40-second web-owned phone-call start deadline requires the Cloudflare
caller's 45-second protocol floor. Roll out or restore the 45-second Cloudflare
caller and prove runner convergence before deploying a web build that uses the
40-second deadline. A 45-second caller remains compatible with an older web
build; a 30-second caller does not remain compatible with the 40-second web
deadline, so do not roll Cloudflare back below 45 seconds while that web build
is active.

- `HostedComputerRun` and `HostedComputerHandoff`
  own member-scoped Kernel profile names, resumable run state, and durable
  `awaiting_user` checkpoints. Assistant dynamic tools receive only run handles;
  `apps/web` owns Kernel lifecycle and encrypted browser capabilities. Awaiting
  runs open through `computer_open`, which creates, reuses, resumes, or safely
  reclaims completed, stale-checkpointed, open, or expired active runs and
  returns current page state. Open or expired handoffs require a newer hidden
  user reply before the agent can resume control. `apps/web` verifies newer
  hosted `conversation.message` mailbox items and delivery context when reply
  proof is required; model-supplied run ids or confirmation text are not proof.
  `computer_act` runs bounded raw Playwright code against the current Kernel
  page, and `computer_os_control` is a bounded mouse/keyboard fallback for page
  surfaces that cannot be operated through Playwright. The agent explicitly
  selects `managed_login` for Kernel Hosted UI plus a durable profile/domain
  connection, or `login` for the existing Live View takeover; CAPTCHA,
  payment, missing-detail, and direct takeover handoffs remain Live View. Murph
  atomically converts a failed Managed Auth checkpoint into a member-bound Live
  View handoff on the same short-lived token when the task browser can be
  restored. The conversion first serializes against the member's conversation
  mailbox ordering row, then atomically writes the current mailbox lane
  sequence to the run's nullable `resumeAfterMailboxLaneSeq` boundary. The
  reconciling `computer_open` request
  remains awaiting, so the mailbox item that discovered the provider failure
  cannot also consume the new Live View checkpoint; only a conversation item
  with a higher lane sequence may resume it, even when transaction timestamps
  do not reflect commit order. Timestamps remain audit metadata. Unmarked
  direct-login and pre-migration rows retain the existing timestamp reply proof
  during the bounded active-run drain and are never reclassified from mutable
  handoff timestamps. For a direct `login` Live View handoff, Done durably
  completes the handoff and returns to the conversation while the existing task
  browser remains the sole profile writer. The next resume that proves a newer
  mailbox item must first claim that exact completed handoff as `checkpointing`
  under the member lock. Only the claim owner may stop the browser so Kernel
  saves the profile, remove a stale deterministic replacement, create and
  publish the replacement, and atomically mark the handoff completed while the
  run becomes `running`. An overlapping open or start request returns a retryable
  checkpoint-in-progress result without calling Kernel. A failed or ambiguous
  replacement retains the `checkpointing` owner; stale-owner recovery can clean
  a deterministic orphan and retry without another login or Done click. Managed
  Auth browser publication and handoff conversion or
  completion commit in one transaction. If both idempotent terminal-write
  attempts return an error, Murph treats the outcome as unknown and leaves the
  handoff checkpointing until durable state can be reread or safely reclaimed;
  it does not provision or delete another task browser in that request. Every
  nonterminal Managed Auth row remains on the provider-aware recovery path,
  including when its inter-request claim is yielded to `open`; generic
  completion and open/resume logic cannot replace, terminally expire, or
  resume it. Read-only failures and nonterminal observations after reclaiming
  a request-local claim yield that claim. `computer_open` reconciles Kernel before any generic
  resume authority and stays awaiting while provider ownership is in progress
  or unknown. Client-link expiry revokes the capability without terminally
  expiring provider-owned work. Repeated pause rotates an idle/open or stale
  recovery row's token hash and link expiry, invalidating the prior token without
  replacing the row or refreshing its claim lease; a fresh controller claim
  keeps its callback token stable. The immutable handoff creation time, rather than
  the mutable claim timestamp, anchors provider-flow correlation across
  stale-claim recovery. Dispatching provider startup remains effect-ambiguous
  even when the first current-flow read is empty, so Murph keeps the row
  checkpointing instead of publishing a fallback writer. Partial detachment is
  reconciled before a stored browser capability can be reused. If reconciliation
  cannot prove that no Managed Auth browser owns the profile, Murph does not
  publish another profile writer. Run-terminal cleanup acquires an exact-CAS
  `cleanup_pending` fence under an identity-only member lock before reading or
  deleting the connection's shared current browser. Cleanup remains available
  for suspended members without reopening foreground computer access. The
  fence blocks replacement runs even after run expiry; only a stale cleanup
  lease can reclaim it, and unrelated finish requests cannot clear it. Final
  Managed Auth failures record only fixed-vocabulary stage and internal
  error-code metadata plus URL validation booleans; handoff tokens, domains,
  connection ids, provider payloads, and browser capability URLs stay out of
  runtime logs, and the best-effort log write is scheduled after the
  user-visible retry redirect. While that failure
  claim remains checkpointing, the handoff page offers only a safe return to
  Murph instead of retrying the Managed Auth controller. Murph does not resize a
  running Kernel browser during takeover; the handoff embeds the existing live
  view and lets Kernel retain the browser viewport it created.
- `hosted_user_crypto_envelope` stores signed wrapped per-user/per-domain root
  envelopes; plaintext roots are never stored
- `hosted_user_crypto_audit` records hosted crypto authority events

## Key environment variables

See `.env.example` for a working template.

Required:

- `DATABASE_URL`
- `HOSTED_DEVICE_ROUTING_INDEX_KEY`
- `HOSTED_APP_SESSION_HMAC_KEY` as a dedicated canonical 32-byte base64url
  key. Web uses it only to authenticate first-party app-session bearer and row
  claims; do not reuse contact, mailbox, provider, or encryption keys.

Required for production migrations:

- `DIRECT_DATABASE_URL`

Required for live Labs discovery:

- `JUNCTION_API_KEY`

This is the same canonical Junction credential used by hosted device sync.
Labs discovery keeps the key server-only, targets the code-owned production US
origin, and serves authenticated `POST /api/labs` plus signed
`POST /api/internal/hosted-execution/labs/tool` through one stateless service.
No catalog, query, or ZIP is persisted.

Required for the hosted device-sync lane in addition:

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
brands, ingredients, tags, categories, or fuzzy matches. Product-test imports
create source-only observations and never create catalog labels. Reviewed
remaps attach those observations directly to an existing, independently sourced
food or supplement label; a genuinely missing product must first enter through
the normal full-label ingestion path. Those imports are exact measured evidence;
concern alerts require separately curated active `contaminant_thresholds` rows. Daily
exposure screens, such as the BPA one-serving-per-day adult screen, use the
label row's `serving_grams` when it is available instead of storing manual
product-threshold application rows.
Attribution lives under `sql/product-tests/`.

The current search path uses built-in Postgres full-text search only. No
extensions such as `pg_trgm`, `pgvector`, or vector indexes are required for
supplement label lookup. Food label lookup additionally applies `pg_trgm` in
`sql/foods/schema.sql` for name search support.

The supplement payload constraint is additive for existing databases:
`sql/supplements/schema.sql` adds it `NOT VALID`, so it immediately rejects new
invalid inserts and updates without blocking a known legacy corpus restore.
Fresh tables create the constraint as valid. To recover the retained
pre-repair July 2026 corpus, restore it into its legacy table shape, apply the
reusable schema, then run
`sql/supplements/repair-data-quality-2026-07.sh --apply`; that exact guarded
repair validates the constraint after correcting the known rows. It fails by
design against an already-repaired or drifted corpus and must not be replayed
there. For another existing corpus, run the aggregate supplement audit, repair
any proven violations, then validate `supplements_payload_format_check`
explicitly. After this constraint is installed, importer rollback must stay at
or above the first version that bounds and validates the affected payload
fields; an older importer requires an explicit constraint rollback first.

## Murph Safe public product data

`/search` exposes the public Murph Safe product-evidence experience. Its browser
search calls `POST /api/public/v1/products/search`; server-rendered product
details use the same service as
`GET /api/public/v1/products/[productRef]`. The generated OpenAPI 3.1 document
is available at `/api/public/v1/openapi.json`, and the current schema id is
`murph.public-products.v1`.

The public catalog includes current supplement and branded-food sources and
excludes generic food origins. Search and detail DTOs are bounded normalized
projections; product tests join only through the selected row's exact
`food_id` or `supplement_id`. Search terms stay in POST bodies and are not
echoed, persisted, analyzed, or logged.

Before a production build, configure these Production-scoped server values:

- `MURPH_PUBLIC_ROUTES_WAF_REQUIRED=1`
- `MURPH_SAFE_SEARCH_WAF_RULE_ID`
- `MURPH_SAFE_DETAIL_WAF_RULE_ID`
- `HOSTED_WEB_VERCEL_PROJECT_ID`
- optional `HOSTED_WEB_VERCEL_TEAM_ID`
- `HOSTED_WEB_VERCEL_TOKEN`, limited to reading the project's firewall config

The exact-id custom rules must be the first active rules after the optional
companion diagnostics rule. Search is an exact POST path with a fixed-window
per-IP 429 at 30 requests per 60 seconds. Detail covers the public API prefix
while excluding search, plus the public web-detail prefix, at 120 requests per
60 seconds. `pnpm public-routes:waf-check` reads the active Vercel firewall
configuration and fails on disabled firewall, order, condition, algorithm,
key, limit, window, action, or id drift. It never downloads environment values
or prints the provider token or response body.

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
- `HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER` as an advisory
  balancing target; assignments remain available when every line reaches it
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
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_5_USD`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_10_USD`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_20_USD`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_25_USD`
- `HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID` optionally selects a dedicated Family Billing Portal configuration.
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_API_BASE_URL`
- `HOSTED_RUNTIME_LATENCY_ALERT_LINQ_CHAT_ID` and
  `HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE` together enable the five-minute
  production reply-latency monitor. Configure one opaque existing Linq chat ID
  for a dedicated operator thread and one valid IANA time zone; do not put a
  phone number in either value. The participant should reply once before
  relying on the thread for alerts. The monitor uses the fixed 30-second
  product boundary, sends one alert per continuous incident, suppresses sends
  from 11 PM through 7 AM operator-local time, and adds up to ten minutes of
  stable wake/retry jitter. Provider attempts therefore stay at least ten
  minutes apart and spread across more than one five-minute cron tick. A
  fresh health and operator-time recheck before provider admission makes no
  attempt-state change when latency recovered or quiet hours began. Only the
  exact row-version compare-and-swap immediately before Linq advances the
  provider-attempt boundary; a stale evaluation cannot win after another
  incident cycles the singleton back to the same visible status. A known-unsent
  first deferral therefore builds fresh evidence in the morning, while a blocked
  ambiguous retry retains its prior exact body, key, and real attempt time.
  Once a provider call is admitted, healthy scans coalesce for the bounded
  four-minute send lease instead of claiming recovery while the outcome is
  unknown; the first healthy scan after the call settles, fails, or the lease
  expires clears the incident. Persisted evidence remains aggregate
  counts/timings in the existing operational-alert row.
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
- Hosted AI included-allowance accounting is app-owned: web prices recorded `HostedAiUsage` rows into allowance columns and maintains `HostedAiUsagePeriod` spend snapshots from current hosted billing state. Subsequent usage-bearing work is blocked when included capacity and purchased usage credit are both exhausted. The operation that crosses the boundary may finish; its accepted input is not discarded.
- Retell phone calls use the same ledger through a web-internal deterministic row keyed by the Murph call id. Web records Retell's final provider-reported combined cost, including discounts and transfer-leg cost, and never accepts that cost field from the hosted-runtime usage callback. `transfer_ended` and the pre-armed phone-call reconciliation workflow prevent a provisional transfer cost or lost callback from becoming permanent undercounting.
- Purchased usage credit is separate from the included-allowance period. A beneficiary-serialized transaction consumes included capacity first, then append-only credit grants in order, while `HostedMember` carries the bounded balance/version hot-path projection. Unused credit carries across allowance periods and does not create subscription entitlement.
- Web derives one read-only member plan-usage projection from that same allowance resolver and usage ledger for Settings and `murph.plan_usage`. It persists no forecast and performs no Stripe read. `recommendedAction` is thresholded and may return `add_usage` only for eligible direct paid Pulse and Edge members; the authenticated Settings surface exposes the fixed $5, $10, and $25 catalog. An opted-in `subscriptionActionQuote` returns current terms for an explicit subscription request even below the threshold; it is not a recommendation or consent. Callers that send the original empty request receive the original response shape with that field omitted.
- Usage-credit payment accepts the existing personal self-target, an authenticated active Family owner selecting one exact active unsuspended Family membership, or the existing hosted-group funding target. Family admission re-binds the opaque path selector to the authenticated owner, their active unsuspended group, the exact active member, and that group's canonical `HostedAccountGroupBillingRef` customer. Every flow accepts only a server-owned offer code and single-use request key, re-fetches the configured active one-time Price to verify its exact single-currency amount and shape, and keeps the browser from choosing an arbitrary amount, Price, Customer, payer, beneficiary, grant, or Checkout URL.
- Personal and Family funding use Stripe `mode=payment` Checkout with Adaptive Pricing disabled. Current-policy group funding first selects one canonical card attached to the authenticated payer's Customer. It creates an unconfirmed PaymentIntent, then rechecks active payer and still-created purchase state while durably binding that exact intent under the payer lock before off-session confirmation; a deletion or terminal-state race cancels the unbound intent and never confirms it. Ambiguous responses remain bound to that exact intent and frozen offer, the browser preserves the original amount/request key for recovery, and authentication or card failure may open Checkout only after verified cancellation. The payer-owned cancel path also resolves a sessionless direct attempt from Settings or a target-conflict surface. Group Checkout saves the entered card for a later explicit contribution. Murph stores no raw card data and never charges from amount selection alone.
- A browser return or synchronous PaymentIntent response never grants credit. The existing verified Stripe event receipt owner re-fetches Checkout and line-item facts when present plus the exact PaymentIntent and Charge, then commits at most one purchase grant. After a new grant commits, the same durable Stripe-event retry lane requests the normal runtime recheck so preserved blocked input can resume.
- The purchase schema freezes payer and beneficiary separately. Personal, Family-member, and hosted-group purchases converge on the same append-only beneficiary ledger, Stripe verification, refund/dispute adjustments, status/expire routes, and webhook-only grant path. Family top-ups reuse the active group billing customer; they do not create a personal customer, Family wallet, second ledger, or second credit projection. One payer-wide nonterminal purchase is the ambiguity fence: a conflicting Family target receives no payable URL or retry action, and former-member recovery remains payable only when Settings can show an owner-recognizable frozen beneficiary.
- Web owns the separate `murph.subscription` callback for an explicit private member choice to continue Pulse at trial end, start Pulse now, or upgrade Pulse to Edge. It binds the runtime-supplied accepted input id to the callback member, atomically claims the first action on that existing mailbox row, re-derives current eligibility, and delegates to the existing billing services. An exact retry is allowed and a conflicting action fails closed. Pulse activation keeps its existing Stripe-hosted invoice or Customer Portal handoff when payment is required; a pending Edge change returns Customer Portal without a separate invoice lookup. No custom checkout or second billing owner is introduced.
- Homepage period facts come from the same allowance owner. Spend accounting ensure-creates a fresh billing or calendar period inside the spend transaction, with no reset cron.
- Web applies the composed access-and-usage gate in runtime reconciliation and
  mailbox fetch/payload routes before exhausted work reaches the runner.
  Temporal owns only the resulting blocked orchestration facts; Cloudflare
  receives no billing or credit projection. Runtime usage is recorded after it
  exists.
- Assistant usage recording may carry the exact authority-bound originating Linq group route for a proactive thread-cap crossing notice. Web reuses the existing claimed Linq delivery path, never derives a group target from personal home routing, and keeps the next-inbound gate notice as the backstop when the target is missing or ambiguous.
- Pulse Trial uses the same enforced allowance system with a phase-aware 4.50 USD threshold. Trial members cannot buy usage credit; paid phase is authoritative for normal Pulse allowance, while stale or malformed trial entitlement fails admission before any calendar fallback.
- Included-allowance accounting starts from the deployment that enables allowance accounting on imports. Existing current-period usage rows are not backfilled by default.

`apps/web` records every hosted assistant usage row by member in `HostedAiUsage`.
Hosted execution accepts Murph-owned usage rows with `stripeMeterSource=murph`.
Recorded rows keep `stripeMeterStatus=skipped` so they cannot be backbilled by
the removed Stripe meter path. The hosted allowance owner reads web-owned spend
and the local credit projection for admission, projection, and notices.

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

#### Full local test-mode Checkout

The local hosted signup and usage-credit flows use real Stripe Checkout against
Stripe's test environment; they do not use an in-process fake checkout service.
To complete either flow without moving real money:

1. Configure test-mode Stripe values in `.tmp/.env.hosted-local-stripe`,
   `apps/web/.env.local`, or shell env:
   - `STRIPE_SECRET_KEY=sk_test_...`
   - `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY=price_...`
   - `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY=price_...`
   - `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY=price_...`
   - `HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_5_USD=price_...`
   - `HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_10_USD=price_...`
   - `HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_20_USD=price_...`
   - `HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_25_USD=price_...`
2. Install and log in to the Stripe CLI once with `stripe login`.
3. Run root `pnpm dev` without `MURPH_DEV_SKIP_STRIPE_LISTEN=1`; the dev
   orchestrator starts `stripe listen` and injects the captured
   `STRIPE_WEBHOOK_SECRET` into the web process.
4. Use a real hosted onboarding invite for subscription Checkout, or sign in as
   an active paid Pulse/Edge member and open **Add usage** in Settings. The
   dev-only `/join/<inviteCode>?preview=checkout` URL is only a UI preview;
   pressing its checkout button still calls the real checkout API.
5. On the Stripe-hosted Checkout page, use Stripe's interactive test card
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
- `POST /api/internal/hosted-runtime/owner-released` is the payload-free
  completion handoff. Web accepts a zero-byte body and either no query or the
  exact signature-bound `immediateRecheckRequested=1` positive edge, binds the
  user through the signed request plus normal nonce protection, and emits the
  existing `runtime_recheck_requested` Temporal signal. Without the edge, Web
  signals only for current runnable mailbox lag; a persisted default or
  retention wake is not itself signal authority. The edge means the completed
  invocation newly committed an unserviced schedule and carries no wake data.
  Known future mailbox retry continuations remain deferred. Cloudflare calls the
  route at most once, with a timeout capped at two seconds, only after exact
  write-fence completion; failure is non-fatal and has no callback retry.

When you set `DEVICE_SYNC_PUBLIC_BASE_URL`, point it at the stable production
project domain or a custom domain. Do not use ephemeral preview deployment URLs
as long-lived provider callback or webhook bases.

### Vercel setup

Set these under `Settings -> Environment Variables` in the Vercel project that
deploys `apps/web`. Production is the minimum.

Provision `HOSTED_APP_SESSION_HMAC_KEY` in every hosted-web environment that
will serve authenticated traffic before deploying the strict v2 session code.
This is a deliberate secret-before-code hard cut: the deployment rejects all
legacy unsigned cookies, so existing users sign in again, and a missing or
malformed key fails session issuance, resolution, and revocation closed. Keep
the key out of Cloudflare Worker and runner environments; no Cloudflare deploy
is required for this cutover.

Before deploying, enable Vercel Authentication with Standard Protection (or
`All Except Custom Domains`) for the project. Do not use `All Deployments`,
which would also protect (and make private) the custom production domain,
while protecting every generated production URL,
including URLs for historical deployments that still accept legacy sessions.
With the secure `HOSTED_WEB_VERCEL_*` operator environment loaded, require this
check to pass before cutover:

```sh
pnpm --dir apps/web release:production:verify-deployment-protection
```

Do not proceed if the check fails. These Vercel management credentials belong
in the secure operator environment, not in the hosted app merely to satisfy its
production build. Keep deployment-protection bypass secrets and share links
out of the cutover verification path.

Freeze production deploys and rollbacks for the cutover. Record the exact
strict-v2 commit, deploy it, and prove the production alias points at that
commit with `apps/web/scripts/resolve-vercel-production-alias-sha.ts` and the
secure `HOSTED_WEB_VERCEL_*` operator environment. Wait the configured
`HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS` prior-function interval, then
resolve the alias again. If it changed, select a strict-v2 commit and restart
the full drain. A completion response from an old function can set a legacy
cookie during this window; rejection is intentional, and the user must retry
sign-in after the drain to receive a v2 cookie. Verify that retry, authenticated
browser-vault access, expiry, and logout before ending the freeze.

The first strict-v2 production deployment is the app-session rollback floor.
Do not roll back to an older build: it accepts the database-forgeable legacy
session protocol. For incidents after the cutover, deploy a forward fix or
roll forward to this floor or a newer strict-v2 commit. Record the commit, both
alias proofs, elapsed drain, and post-drain verification as rollout evidence.

- Enable Vercel OIDC so the app-local hosted-execution auth adapter can present
  workload identity to Cloudflare on dispatch and status requests.
- Set `CRON_SECRET` for the hosted cron routes under `/api/internal/**/cron`.
- To receive reply-latency texts, set
  `HOSTED_RUNTIME_LATENCY_ALERT_LINQ_CHAT_ID` to a pre-established dedicated
  operator chat, set `HOSTED_RUNTIME_LATENCY_ALERT_TIME_ZONE` to the operator's
  IANA time zone, and verify that line can exchange a normal reply before
  treating the alert path as live. With both values absent the channel stays
  disabled; exactly one value or an invalid non-empty time zone fails the cron
  visibly.
- Configure the hosted public-origin envs and `HOSTED_WEB_CALLBACK_SIGNING_*`
  values exactly as described above.
- Set `HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS` and, if needed,
  `HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER` as an advisory
  balancing target rather than a hard admission limit.
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
historical migration set ending at
`20260707170000_drop_stale_linq_recency_columns`; keep
`DATABASE_URL` available for app runtime traffic. Vercel predeploy and GitHub
postdeploy may use separate dedicated PlanetScale login roles, but both login
roles must be able to assume the canonical `postgres` schema-owner role. Both
migration runners set that role at connection startup and verify that it owns
the Prisma migration ledger before executing DDL. If an unpinned migration
login creates objects under itself, reassign all of that login's objects to
`postgres` before retrying; do not grant per-table exceptions or introduce a
second schema owner. Because a successful
predeploy migration cannot roll back automatically if a later deploy step
fails, normal production Prisma migrations must stay backward compatible with
the currently deployed app and avoid old-code-breaking changes such as required
columns, validating `CHECK` constraints, drops, renames, `SET NOT NULL`, or
column type changes. Those changes need an
expand/backfill/switch/final-cleanup sequence: add the new nullable shape first,
backfill or dual-write as needed, switch application reads/writes in a later
deploy, then add validating constraints or clean up the old shape only after
the replacement deployment is live and the prior production function window
has drained.

The exact
`20260727040000_relax_hosted_usage_credit_detached_direct_proof` migration is a
narrow predeploy exception to that default. It replaces only the two existing
usage-credit detached-payer checks with a backward-compatible relaxation:
fulfilled direct payments may retain PaymentIntent and Charge lookup proof
without a Checkout Session, while payer-owned rows, other payerless terminal
states, and ciphertext clearing retain their existing requirements. Running it
before the application serves is necessary because the new application can
create that sessionless fulfilled shape. The migration guard permits only its
proved constraint drop/add operations and still rejects any additional
incompatible DDL.

Production `DATABASE_URL` must use PlanetScale's transaction-mode PgBouncer
endpoint (normally port `6432`); `DIRECT_DATABASE_URL` remains the direct
Postgres endpoint for migrations and other session-scoped administration. The
hosted web Prisma module creates one `pg.Pool` per module runtime, immediately
registers it with Vercel Fluid Compute, and passes that same pool to
`PrismaPg`. The adapter owns external-pool disposal so `$disconnect()` retains
its existing cleanup contract. Keep session-persistent setup such as connection
`SET` hooks out of this path because transaction pooling can move consecutive
transactions between backend connections. The default pool limit is 15 clients
per module runtime, with five seconds for connection acquisition and 30 seconds
for idle retirement; tune those values only from measured pool and database
pressure. Connection failure logs expose only a fixed failure category and
numeric total, idle, and waiting counts.

That module permits one jittered retry only for the two ambiguous transient
failures that prove the database did no work. A `pool_checkout_timeout` means
the statement never reached Postgres. A `transaction_start_timeout` is Prisma's
`P2028` raised before it invokes the transaction callback. When the local pool
is already full or has waiters, either failure is returned immediately as
backpressure instead of re-entering the same queue. `P2028` also covers
transactions that opened and later expired; the wrapper tracks callback entry
and never replays a transaction that may have run. Failures that may have
reached Postgres, such as closed connections, TLS faults, or an unreachable
host, are reported and rethrown untouched.

Pool pressure is reported before it becomes a failure. `Hosted web database pool
pressure.` logs the same total, idle, and waiting counts when the pool is full
before the prospective first waiter queues, or whenever later callers are
already waiting. It is rate limited to once per ten seconds per pool; a pool
with idle capacity logs nothing. `Hosted web database slow transaction
acquisition.` measures only the wait before an interactive callback begins,
while `Hosted web database slow transaction hold.` measures only callback time
with a connection. Batch-array transactions use `Hosted web database slow batch
transaction.` for total wall time because Prisma does not expose a callback
boundary there. Each emits only a duration at five seconds or more.

`Hosted web database pool configured.` records the effective limit once per
module runtime and whether it was `configured` or inherited as the `default`.
That limit is per module runtime, not a global cap, so the real ceiling is this
number multiplied by the live Fluid instance count. Leaving
`DATABASE_POOL_MAX` unset deliberately keeps the inherited default visible
without silently changing capacity. Use the new pressure, acquisition, and hold
measurements to re-baseline representative ingress, runtime-log, device-sync,
signup, and Stripe workloads before choosing an explicit per-instance value.

Destructive contract cleanup belongs under
`apps/web/prisma/contract-migrations` and runs through the
`Hosted Web Contract Migrations` GitHub workflow after Vercel reports a
successful production deployment. That workflow only accepts Vercel-originated
completed production deployment statuses, checks out the exact deployed commit,
verifies it is reachable from `origin/main`, waits
`HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS` seconds for prior production
function executions to drain, then verifies the configured Vercel production
alias still points at that commit before exposing the database secret. It can
also be manually dispatched with `deployed_sha` set to the current Vercel
production commit; the same drain and alias proof still apply before SQL runs.
It requires
`HOSTED_WEB_VERCEL_TOKEN`, `HOSTED_WEB_VERCEL_PROJECT_ID`,
`HOSTED_WEB_PRODUCTION_BASE_URL`, and `HOSTED_WEB_DIRECT_DATABASE_URL` in
GitHub Actions; `HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS` defaults to
`300` and is capped at `600` unless the workflow timeout is raised. The workflow
does not use GitHub Actions concurrency for this lane; the final alias check and
the contract migration advisory lock make stale or duplicate runs skip safely
without letting stale events replace valid pending runs. After those gates, it calls
`pnpm --dir apps/web release:production:contract-migrate` with explicit opt-in.
The shared production migration URL resolver strips Prisma-style
`sslcert=system`, `sslkey=system`, and `sslrootcert=system` markers before
handing Postgres URLs to raw `pg` clients, while preserving real SSL file paths.
The historical
`20260720233000_hosted_group_usage_funding_invariants` contract migration is
retained for audit history but omitted by the runner because the later
`20260727040000_relax_hosted_usage_credit_detached_direct_proof` Prisma
migration now owns both constraints on fresh and upgraded databases. It must
not run after promotion or it would tighten fulfilled direct payments back to
requiring a Checkout Session.
The merged
`20260715120000_delete_orphaned_linq_invite_deliveries` Prisma migration is an
unchanged historical first pass because production may already have recorded
it. The
`20260715150000_delete_orphaned_linq_invite_deliveries_after_drain` contract
migration repeats the same narrow orphan predicate after promotion and the
prior-function drain; that post-drain pass is the final historical-cleanup
authority.
The permanent Linq invite-delivery data-producer rollback floor is
`e67aedb61fd021f50cadae147b92006fef43b97e`, the merge of PR #668 and the
first `main` commit with both the live account-deletion cleanup and the delayed
invite-dispatch fence. Freeze deploys and rollbacks before promoting the
cleanup deployment, then record that deployed commit, this floor SHA, both
production-alias proofs, the elapsed drain, and the contract-migration outcome
before ending the freeze. After the contract migration is recorded, do not
roll Vercel below this floor. Rerunning the existing workflow is not a repair
for rows recreated by a below-floor rollback because the recorded migration ID
and checksum make its SQL skip. A below-floor emergency rollback therefore
requires a roll-forward, a fresh promotion-and-drain proof, and either a new
timestamped cleanup migration or explicit operator SQL before the deletion
guarantee is restored.
Rollback floor: after contract cleanup drops an old schema shape, the oldest
safe Vercel rollback target is the first deployed commit that no longer reads or
writes that dropped shape. Rolling back below that floor requires restoring or
re-expanding the database shape first, or deploying a forward fix. Cloudflare
`container_rollout=immediate` is not applicable to this Vercel-only lane; the
bounded Vercel drain wait plus final alias check owns the old-function window.
The group-join confirmation expansion migrations install two temporary
legacy-facing triggers: one stamps eligibility on new join-code member rows
inserted by warm old functions, and one clears Linq participant authority when
those functions clear a home chat. The membership expansion also adds the
nullable join-origin field used to keep web and group-chat-reaction copy stable
across retries. Rows written by warm old functions leave that field null and
use the neutral confirmation. The
`20260711230000_drop_group_join_compatibility_bridges` contract migration
removes both only after the consumer-capable production deployment is live and
the guarded prior-function drain and alias proof have completed.
The first assistant-personality causal release adds nullable causal-sequence
state, a nullable `assistant_input_lookup_key` projection on conversation
mailbox rows, and nullable Humor, Push, and Detail projection watermarks. Deploy
the compatible Cloudflare/runtime consumer before the Web producer. Web writes
a server-keyed blind lookup derived from the existing deterministic input id for
new conversation messages, never the raw id, and hard-rejects callbacks that
cannot resolve the callback member plus a derived candidate key to one live
conversation-lane `conversation.message` row. There is no numeric sequence
fallback and no mailbox wire, `sourceRef`, or event-id change. The automatic
post-deploy contract lane waits for old functions, applies the causal-sequence
constraint only when no unconsumed sequence-less preference row remains, and
then seeds all three personality watermarks to the member's current causal
barrier. The seed intentionally includes null projection values because pre-fix
Web values may differ from canonical vault values and cannot be backfilled
safely. Web emits sparse causal writes and exposes personality controls
unconditionally. The first compatible FIFO runtime and this Web hard cut are
permanent rollback floors; a rollback below either requires a separately proved
migration or a forward fix. The hard-cut build rejects the retired direct-vault
causal-sequence action after old Vercel functions drain. Keep Web at this floor
during any runner rollback.
The `2026062100_hosted_computer_single_member_profile` migration is an explicit
greenfield computer-use hard cut: deploy it only as part of a coordinated
hosted web plus Worker cutover with hosted computer-use traffic paused during
the skew window.

### Hosted phone-call private-content migration

The phone-call private-content rollout is an expand-and-scrub hard cut with no
plaintext dual-write. Deploy the additive migration first: it adds nullable
`brief_encrypted` and `result_encrypted` columns and makes the legacy brief JSON
nullable, so the previously deployed web remains compatible. The replacement
web encrypts every new brief/result before the guarded database write, reads
ciphertext first, and falls back to legacy JSON only when ciphertext is null;
this keeps both old calls and new calls usable while the scrub runs.

Freeze production deploys and rollbacks before promoting the replacement web,
then record its exact commit. Preliminary count-only dry runs may start once
that deployment is live, but no applying backfill is safe yet: an invocation
of the previous web can still finish later and require or write plaintext.
Prove the production alias points at the replacement commit with
`apps/web/scripts/resolve-vercel-production-alias-sha.ts` and the secure
`HOSTED_WEB_VERCEL_*` operator environment, then wait the configured
`HOSTED_WEB_CONTRACT_MIGRATION_DRAIN_SECONDS` prior-function interval.
Resolve the alias again after the drain. If it changed, select the replacement
or a newer compatible commit and restart the full drain.

Before the final alias proof and prior-function drain, only count-only dry runs
are safe; do not use `--apply` because it scrubs plaintext that a warm previous
function may still need. Only after that final alias proof, run
`pnpm --dir apps/web privacy:backfill-phone-calls -- --batch-size 50` through
the production environment wrapper shown by the script's `--help`. Review the
count-only dry run, add `--apply`, and repeat bounded batches while `hasMore` is
true or `selectedRows` is nonzero. Rerun the dry run and record the zero-row
result as the authoritative scrub proof. Apply encrypts and round-trips missing
ciphertext, proves any existing ciphertext equals the legacy value, and scrubs
plaintext in one compare-and-set write; conflicts are safe to rerun. Output
never contains row ids, member ids, plaintext, or ciphertext. Record the
replacement commit, both alias proofs, elapsed drain, batch summaries, and
final zero-row dry run before ending the deploy freeze.

Live Retell consultation decrypts under one 10-second deadline spanning token
exchange and KMS, while honoring an earlier caller abort. This path does not
retry provider calls and fails closed without falling back to legacy plaintext
when ciphertext is present.

The rollback floor begins when the replacement deployment writes its first
encrypted-only phone-call row. Keep that deployment live throughout the drain
and authoritative scrub. From that point, do not roll back to a build
that requires `brief_json` or reads only legacy result JSON; redeploy this
compatible build or a forward fix. If the deployment fails before receiving
phone-call traffic, the additive schema remains safe for the prior build. The
legacy columns remain nullable in this rollout; remove them only in a later
contract migration after the zero-row proof and the prior Vercel function
window has drained.

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
- `/api/internal/hosted-runtime/latency-alert/cron` scans existing Web-owned
  latency facts every five minutes. It does not signal Temporal, wake
  Cloudflare, or participate in message processing.
- Hosted Stripe reconciliation now commits local billing facts plus inline
  `member.activated` hosted mailbox input first, then performs activation-path
  managed-user crypto provisioning. Later successful invoices for an already
  active member must not append a new activation welcome or trigger another
  Resend welcome email.

## Main routes

Public product routes:

- `GET /changelog` renders the newest dated edition.
- `GET /changelog?edition=YYYY-MM-DD` renders one older dated edition at a stable canonical URL;
  item links generated by the changelog feed include the owning edition and anchor.
- `GET /api/changelog` returns the bounded product update feed.

Browser-facing wearable connection start/completion routes:

- `POST /api/connect-sources/:sourceId/start`
- `GET /device-sync/connect/complete`
- `/connect` keeps Apple Health outside those browser authorization routes and
  links to the approved Murph iOS app, where HealthKit permission is owned.
- A verified WHOOP completion explains the Apple Health relay path and links to
  the Murph iOS app; messaging returns ask Murph to finish that setup in chat.

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
- `POST /api/internal/device-sync/reconcile`
- `POST /api/internal/hosted-execution/usage/record`
- `POST /api/internal/hosted-execution/plan-usage/tool`
- `POST /api/internal/hosted-execution/subscription/tool`
- `POST /api/internal/hosted-mailbox/fetch`
- `POST /api/internal/hosted-mailbox/payload/fetch`
- `POST /api/internal/hosted-mailbox/email-ingress`
- `GET /api/internal/hosted-runtime/status`
- `POST /api/internal/hosted-runtime/log`
- `POST /api/internal/hosted-runtime/owner-released`
- `GET /api/internal/hosted-workspace`
- `POST /api/internal/hosted-workspace/checkpoint`
- `POST /api/internal/computer/runs`
- `POST /api/internal/computer/runs/:runId/act`
- `POST /api/internal/computer/runs/:runId/os-control`
- `POST /api/internal/computer/runs/:runId/pause-for-user`
- `POST /api/internal/computer/runs/:runId/finish`
- `GET /api/internal/hosted-onboarding/stripe/cron`
- `GET /api/internal/hosted-runtime/latency-alert/cron`

The old staged-payload and deleted import completion/release callback routes
are gone. Cloudflare no longer round-trips through broad mirror CRUD routes,
deleted sharing CRUD, local-vault import callbacks, or an outbox drain route. It
still uses narrow signed hosted-web callbacks for execution-time device-sync
runtime snapshot/apply, device connect-link starts, direct hosted usage
recording, member-bound plan-usage reads, mailbox/workspace runtime status plus
log callbacks, and the payload-free runtime owner-release recheck handoff.

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

Authenticated Settings usage-credit surfaces:

- `POST /api/settings/billing/usage-credit/checkout`
- `POST /api/settings/billing/family/members/:memberId/usage-credit/checkout`
- `GET /api/settings/billing/usage-credit/purchases/:purchaseId`
- `POST /api/settings/billing/usage-credit/purchases/:purchaseId/expire`

The onboarding lane is intentionally thin:

- Linq or the public landing page can start phone-bound signup.
- Privy verifies login, linking, and security-sensitive identity operations;
  successful hosted completion issues a strict opaque v2 app session whose
  database row stores a dedicated-key HMAC over its bearer, session id, member,
  Privy identity, and expiry. Legacy unsigned cookies are rejected.
- Hosted onboarding Checkout uses subscription mode. `invoice.paid` remains
  the normal positive entitlement source, with one metadata-gated exception: a
  valid Pulse Trial Checkout completion can activate Pulse in `trial` phase.
  The separate authenticated Settings usage-credit flow uses one-time payment
  mode and never changes entitlement.
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

- Hosted onboarding Checkout uses Stripe subscription mode. Current one-time
  Checkout uses the fixed usage-credit catalog for eligible personal, hosted
  group, and Family-member destinations.
- The launch tiers are monthly Stripe subscription prices; annual checkout is disabled for now.
- `invoice.paid` is the paid activation and paid-cycle source of truth.
- `checkout.session.completed` normally binds refs only, except for the
  Pulse Trial offer (`pulse_trial_7d`) when metadata, member ownership, and
  the expanded/retrieved subscription prove an active policy-bound trial.
- `customer.subscription.*` does not newly activate access and cannot promote
  a Pulse Trial to paid before the accepted paid invoice.
- Subscription chargebacks, disputes, and refunds suspend hosted access pending
  manual review. Matching usage-credit financial reversals are intercepted
  before subscription handling. Live financial-state changes append capped
  signed `refund_adjustment` or `dispute_adjustment` entries against unused
  credit, with positive entries restoring only value previously revoked.
  Reconciliation failures remain in the durable Stripe retry lane and never
  silently suspend the subscription.
- No-card Pulse Trial signup is the default checkout-stage path when billing is
  configured and messaging setup is complete. Set
  `HOSTED_AUTO_PULSE_TRIAL_ENABLED=0` only to force card checkout fallback.
- Card-based Pulse Trial checkout fallback is gated by
  `HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED=1`.
- `/ops/trials` is the operator-only manual Pulse Trial extension surface. Enter
  exactly one hosted member ID and Preview before Apply. Preview reads the
  member's current local billing record and exact Stripe subscription without
  mutation. Apply checks the same short-lived opaque proof under the shared
  hosted-member Stripe mutation lock, adds exactly seven days, and reconciles
  the local trial and usage-period window in that operation.
- `/ops/usage` is the operator-only allowance inspection and recovery surface.
  It derives personal-member and synthetic-group message activity from retained
  canonical mailbox rows, derives all-time priced AI cost from immutable usage
  rows, and labels the mailbox retention boundary. The table and reset reuse the
  runtime's canonical allowance gate. A row reset verifies the displayed
  current-period and usage-credit versions, then atomically clears current
  included spend and the block while releasing only that capacity epoch's
  logical notice claim. It preserves immutable usage, purchased credit, billing
  state, mailbox rows, and delivery history, and refuses to race an in-flight
  notice dispatch. After commit it signals the existing runtime recheck; a
  rejected or bounded-timeout wake is returned as a committed partial result
  with a wake-only retry. The table reads its decision and reset version from
  one repeatable database snapshot, and derives blocked/available only from
  that canonical decision rather than the potentially stale persisted marker.
  Historical notice status is displayed independently from current admission.
  A later crossing reuses the logical claim key but receives a fresh durable
  delivery ID and provider idempotency key. Generic runtime and webhook
  delivery fences keep deterministic durable IDs for latency and receipt
  correlation.
- A live `trialing` Pulse Trial extends from its current Stripe trial end. A
  lapsed `paused` no-card Pulse Trial restarts for seven days from Preview time.
  The proof expires after 15 minutes. Active Family sponsorship and paid,
  scheduled, canceling, canceled, incomplete, past-due, unpaid, foreign, or
  otherwise mismatched direct billing are displayed as ineligible and are never
  mutated. The route does not search for members, process cohorts or batches,
  or clean up provider subscriptions.
- Stripe reads and writes use one 80-second attempt. Apply gives the member lock
  at most 25 seconds to acquire and the locked transaction at most 190 seconds.
  The provider update uses no proration and carries a proof-derived idempotency
  key and metadata marker. A retry after Stripe success reconciles local billing
  instead of adding another seven days.
- `/ops/email` is the operator-only member email composer. It accepts up to 100
  explicit hosted member IDs plus one plain-text subject and body. Preview
  resolves verified email first and falls back to the stored Stripe checkout
  email, while returning member eligibility only and never returning an email
  address.
- Send re-reads current member suspension and recipient state and requires the
  exact 24-hour signed Preview. Unknown members, account-deletion-suspended
  members, and members without a recipient stay skipped. Ready recipients are
  submitted as separate emails in one strict Resend batch with a Preview-bound
  idempotency key, so an ambiguous response can be retried without duplicate
  delivery. Logs contain aggregate counts and safe provider status only.
