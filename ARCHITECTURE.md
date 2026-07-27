# Murph Architecture

Last verified: 2026-07-26

## Accepted-Message Targeting

Exact-message replies and reactions share one accepted-message targeting
primitive. The model sees only an existing `AssistantInputEvent.inputId` as a
`Message ref` beside eligible accepted Linq iMessage input or Telegram input
with a valid numeric provider message target. Linq SMS, RCS, and unknown
service types expose no ref. One resolver binds that ref to the current
delivery-context ordinal, reloads the stored event, rechecks route,
conversation, audience, group-actor, provider-target, and action-specific
capability authority, and returns only the accepted input id. Provider message
ids stay inside the local delivery boundary. Both targeting tools are
invocation-scoped root tools: the resident App Server may expose them to the
active root turn, but descendant or foreign resident threads fail before the
accepted-message resolver runs.

`murph.select_reply_target` annotates a normal response segment;
`murph.react_to_message` keeps the existing reaction effect and outbox
operation. The delivery owner re-resolves the selected input immediately before
each effect and clones its reply context instead of mutating shared input. Every
`---` bubble from one response segment inherits the same selected target.

Intentional replies persist a true-only `nativeReplyRequested` marker on each
normal message intent. The marker participates in strict parsing, persistence,
fingerprints, equality, and dedupe. It distinguishes an explicit native reply
from the contextual `replyToMessageId` already carried by automatic Linq
replies, so unmarked automatic model replies remain flat. Existing explicit or
manual low-level provider reply calls keep their prior behavior. This adds no
provider-id map, database projection, service, API, queue, or feature flag. The
full contract lives in `agent-docs/product-specs/shared-message-targeting.md`.

## Hosted Group Self-Awareness

`apps/web` owns hosted groups, memberships, join policies, vault-share grants,
and the one nullable encrypted projection snapshot column on each existing
`HostedVaultShare` row. A personal hosted runtime may read its
callback-authenticated member's current memberships through the signed group
tool control route. That membership read derives only the member's own group
labels, role, requested and active self-granted scopes, and an authorized
first-party permission URL; it does not expose another member's identity or
sharing state or persist a copy in the workspace. Private self-leave atomically
removes the non-owner membership and its shares under Web ownership. It does
not append a runtime cleanup wake. Other permission mutations remain on the
authenticated group join page or route-bound group-chat offer flow.

`murph.group action="read_shared"` is the only hosted assistant path for group
standings, shared facts, and diagnostics. Its runtime adapter is synchronous and
performs no I/O when constructed. This path adds no pre-model roster, grant,
snapshot, device, projection, configuration, or attribution read; existing
accepted-input and route-binding work is unchanged. Web is contacted only after
the model invokes the tool.

Challenge kickoff and later interactive identity repair stay inside that same
model-triggered `read_shared` request. At request time, the runtime adds only
the bounded, route-authorized current-turn Linq sender handles already visible
in the prompt. Web matches those handles against verified phone and email blind
indexes selected by the existing group query. A handle appears only in the
matching member's bounded `currentTurnHandles` array and only when it resolves
to exactly one current membership; the same row carries the group-scoped
`participantId`. The model may bind a challenge participant only when an exact
current `Sender:` handle appears in one row. Scheduled and detached reads carry
no handles. Those handles are never persisted as membership or shared-data
authority, and this adds no pre-model roster work, standalone Web query,
decrypted contact roster, or compatibility branch. The legacy `read_current`
wire is unchanged, and assistant-engine still removes the global member id and
legacy roster handle before any group summary reaches the model.

Each synthetic hosted group runtime may additionally keep one assistant-authored
`group-room-model` derived knowledge page. A twice-weekly managed automation
installed only on authenticated non-direct Linq/iMessage or Telegram routes
reuses the existing isolated, exact-skip background-maintenance lane and a
bounded seven-day tail of committed transcripts from those same authenticated
group-chat channels. It fully rewrites the one page only when the evidence
materially improves a compact list of room canon, likely person-specific comedy
preferences, successful Murph formats, retired material, and open callbacks.
One dedicated owner reads, replaces, or deletes the fixed page. Generic
knowledge show, list, search, append, upsert, and generated index surfaces
exclude it. Every mutation passes the digest returned by the immediately prior
show and compares that digest under the same fixed-page lock, so a concurrent
rewrite cannot be lost. Replacement validates the normalized body and complete
6 KiB advisory envelope before writing; ordinary prompts never truncate an
accepted page. Raw `Sender:` handles remain transient evidence attribution and
cannot be persisted in the page.

Ordinary authenticated hosted group-chat turns read that fixed page directly
from the same group vault and append a bounded rendering to dynamic turn
context. An explicit current-room remember, correction, retirement, or forget
request may fully rewrite the page only through a dynamic tool admitted for
current accepted input on that authenticated route. Group email neither receives
the page nor contributes maintenance evidence, and its spoofable sender cannot
receive the mutation tool. Silent consolidation receives that same dynamic tool
only from the immutable managed-automation id, runs in a fresh one-shot Codex
thread with workspace access denied and network disabled, and has no generic
knowledge or shell write surface. Ordinary prompt reads fail open, but mutation reads
distinguish a genuinely missing page from malformed, unreadable, or wrong-type
fixed-slug state; conflicts stop both explicit and scheduled replacement. The
rendering is quoted as fallible data and
explicitly tells the model to skim it lightly: most turns should use none of it,
and at most one naturally relevant tip should shape a reply. Current
conversation, safety rules, authoritative tool results, and explicit canonical
room style settings always outrank it. This adds no database table, mailbox
kind, roster service, cursor, vector index, per-participant page, or pruning
workflow; the admitted committed transcript is evidence and the single page is
the only durable room-intelligence owner.

Built-in managed automations additionally carry one immutable owner scope from
their exact current seed identity. Member seeds may reconcile and execute only
on personal/direct routes; authenticated-group seeds may do so only on live
non-direct Linq/iMessage or Telegram routes. Reconciliation archives every
nonterminal wrong-owner record, and claimed occurrences revalidate the current
seed and live route before lifecycle hooks, evidence, provider/model work,
tools, delivery, and commit. Caller-supplied unscoped seeds retain their prior
compatibility behavior, and mutable tags, slugs, titles, or instructions never
acquire this authority. Dynamically generated experiment-lifecycle seeds stay
on their existing separately owned path until that owner exposes an exact
identity resolver.

No built-in member-facing group social automation currently ships. The removed
Sunday superlatives ID remains only as a permanent retirement tombstone:
reconciliation archives an old persisted record with that exact ID, and a
claimed occurrence fails closed before lifecycle or model work. This guard
cannot install or configure an automation. Future group features can use the
existing explicit `authenticated-group` owner scope; any feature-specific
activity, evidence, identity, or participant policy must be designed with that
feature rather than embedded in the generic ownership boundary.

Web then captures the current roster and exact active grants, decrypts the
bounded encrypted snapshots owned by those share rows, and returns every member
with every requested scope as `not_granted`, `granted` plus `missing`, or
`available`. Health projection delivery conditionally replaces the complete
encrypted snapshot on the exact active share generation. Revoke and regrant
clear it transactionally, and regrant rotates the share id. The explicit
`device-sync-status.v0` grant instead authorizes one live bounded Web derivation
of public source labels, coarse state, and honest timestamps; device facts are
never stored in the share snapshot.

No shared projection lands in a personal or group workspace. Legacy
`vault-share.delivery` and `vault-share.revoke` mailbox rows are skipped before
payload fetch or decryption, and v2 restore plus legacy materialization exclude
`derived/vault-share/**` and `vault-share/**`. Challenge logic starts from
knowledge-page participants recorded as `in`, joins the `read_shared` matrix by
the group-membership-scoped `participantId`, treats a real zero as data, and
names missing participants instead of ranking absence as zero. The model never
receives the global hosted member id. The full behavior, privacy shape, and
consumer-first cutover live in
`agent-docs/product-specs/group-challenge-data-diagnostics.md`.

## Hosted Assistant Ask

Assistant Ask is one typed request/reply primitive over the existing encrypted
hosted mailbox. `assistant.ask.requested` carries one bounded question to an
authorized target runtime, and `assistant.ask.completed` returns one bounded
answer to the bound caller runtime. The first adapter is a private member asking
a joined group Murph. `apps/web` derives the exact group runtime, membership
generation, origin, expiry, and private return route from the signed caller and
web-owned rows; the model supplies only the question and an optional visible
group label. Web rechecks membership before the group read and completion
append. After Temporal accepts each pointer-only mailbox signal, Web starts the
same payloadless, no-retry direct `ensure-processing` latency hint used by Linq;
Temporal remains the only durable wake and reconciliation owner. The target
child receives the server-bound requester membership `participantId`, which
must exactly match the `read_shared` member used for first-person references;
display names, handles, and member order are never identity fallbacks. The
paired mailbox rows are the only durable operation state, and the answer remains
untrusted data when the private runtime composes its follow-up. A joined-group
Ask request and its legacy private completion are safe to admit through the
runtime's narrow pre-checkpoint system prefix because the detached read has no
resident write or delivery authority and the completion can only use the
existing output-only delivery surfaces. One shared import policy applies decoded
adapter validation to every import in that pre-checkpoint pass, including
follow-up imports and foreground reruns, so consented-member requests and
reviewed completions remain on the ordinary checkpoint path. This starts the
separate read or private continuation without publishing the routine idle
snapshot early. Each joined-group completion that predates pending personal
input owns one foreground-causal assistant pass and queues its response through
the ordinary idempotent outbox. A progressed safe causal pass re-enters that
same bounded pass loop so another already-imported safe item cannot fall back to
the idle checkpoint; newly arrived personal input always runs first, and no
progress, retryable failure, cancellation, or mailbox-budget exhaustion stops
the drain. The cutoff uses the input's occurrence time from the bounded
accepted-input batch already owned by a fresh turn. When no fresh batch exists,
the cutoff reads the existing complete pending-input index; missing, incomplete,
or invalid index evidence fails closed without repairing or compacting state on
the reply path. A typed `cannot_answer` bypasses provider paraphrase and queues
the fixed unavailable-evidence response exactly, so it cannot be restated as an
expiry or execution failure.
That ordering ends at durable intent creation: the outbox retains its
established same-turn predecessor boundary, so a cross-turn carrier retry does
not freeze later live conversation. No Ask-specific coordinator, receipt state
machine, or second queue owns this ordering.

The reverse `consented_member` adapter lets an authenticated group Murph ask
one current member's private Murph under a separate exact grant. Web/Postgres
owns an immutable, group-visible natural-language permission encrypted with the
existing hosted member private-field secure-box under the synthetic group
runtime, plus an append-only per-membership grant generation. The permission row
id and encrypted field are bound into AAD; plaintext is opened only after the
exact group or member authority has been established. A current member creates
that grant only by adding the exact Like reaction to the exact server-authored
consent message;
membership never implies the grant, and the Like cannot create membership. The
group model may select only a current opaque `grantId` returned beside that
member and permission by `read_current`. Web binds every hidden identity and
revalidates the group, personal runtime, membership generation, grant
generation, permission digest, origin, expiry, and runtime fence at admission,
before the personal read, and before disclosure completion. Accepted-input
delivery also revalidates the same authority in the existing Linq egress
transaction that claims provider dispatch. It carries the completion mailbox id
as its causal anchor, so a revoked, expired, mismatched, or unanchored queued
answer is terminal before provider entry. Leave/rejoin and revoke/regrant
therefore invalidate old work. One
trusted accepted-input or scheduled-automation invocation owns at most one
consented-member request per exact grant; exact replay reuses it, a changed
question for that grant conflicts, and another current grant in the same
invocation remains independent without creating an implicit roster fan-out API.
The initial turn of a claimed canonical scheduled group occurrence reuses the
ordinary group runtime. Its existing scheduled group-tool factory attaches the
same bounded group port only after route authority resolves a non-direct thread,
and the notification retains it only with runtime-minted occurrence authority.
Ordinary notifications and manual, direct, unknown-audience, or local cron runs
do not receive that group capability.
A scheduled Codex turn starts every needed member ask, then uses ordinary shell
waits and exact replay to poll each accepted `ask_member` call until it returns
completed or unavailable. The existing request expiry bounds the loop. Web
returns a completed result only after the ordinary cron owner revalidates the
current canonical automation and non-direct route immediately before the tool
call, and Web revalidates the exact request and completion, member, grant,
permission, personal runtime, origin, expiry, and runtime fences. An unavailable
result ends that request without an answer. Scheduled completion never wakes the
group runtime, starts another provider turn, creates a group outbox delivery, or
holds a callback open while the member runtime works. The
reviewed answer remains untrusted data rather than consent for an external
action, and the ordinary scheduled turn may use only tools independently
authorized by their existing owners. It never gains access to the grantor's
personal runtime or connected accounts.
Candidate and reviewer provider usage flows through the existing
hosted usage ledger with deterministic request, attempt, stage, and provider
ordinal identity; usage recording is best-effort and never controls disclosure.

The target runtime keeps its resident foreground Murph as the sole
model-authored canonical-content writer and outbound sender. Beside it, at most
one `executeReadOnlyAssistantAsk` call may start a separate one-shot Codex App
Server process. The trusted group target adapter supplies the authorized root
and bounded committed conversation evidence; the model cannot choose either.
The native `murph-group-read` permission profile then exposes the live group
read: exact workspace roots are read-only, `.runtime/**`, `.codex/**`, and
retired vault-share projection roots, and environment files are denied; tool
network is off, shell commands inherit no secrets, and the child receives only
the consent-aware lazy `murph.group/read_shared` dynamic tool, with no mutation
or delivery authority.
Thread-start attestation must confirm the exact profile, roots, empty working
directory, empty instruction sources, and approval policy before model work.
The child never shares the resident process, provider thread, interruption
domain, or route grant. Before checkpoint, invocation return, fence loss,
workspace replacement, or shutdown, the runtime aborts and awaits the exact
owned child before releasing the workspace. Further asks remain pending in the
same mailbox; there is no second queue, projection, table, workflow, container,
or general agent registry.

For a consented member target, the private read-only child receives the exact
permission context and produces a candidate from the member workspace. One
separate fresh-context outgoing reviewer then receives only that immutable
permission, the question, and the candidate; it has no member workspace,
history, application tools, network, or delivery authority and returns only `allow` or
`deny`. There is no incoming reviewer and no rewrite loop. An allowed answer is
placed on the bound group completion and delivered as the exact reviewed bytes
without another model turn. Denial or a candidate-declared cannot-answer yields
fixed non-disclosing copy. Invalid review output, provider failure, or stale
authority discloses nothing and follows the existing retry, expiry, or terminal
lifecycle. A denied candidate never becomes durable operation state. This adds no
fan-out, scheduler, policy engine, result table, or second service.

## Hosted Connected Apps

Connected apps expose exactly three assistant tools: account management, semantic tool search, and execution. `apps/web` owns the Composio API key, durable per-member Tool Router session id, short-lived member-bound connect intents, account verification, server-owned built-in service tool allowlist, server-held OpenWeather custom auth for the allowlisted weather tools, agent-approved calendar-create write allowlist, and branded OAuth completion UX. The hosted runner reaches that authority only through the existing signed `web-control.worker` boundary; Composio credentials, session ids, OAuth state, OpenWeather credentials, and connected-account provider tokens never enter Codex env or prompts. Composio owns provider schemas and raw execution results, while Murph applies a session-level read-only/non-destructive policy, explicit multi-account selection for connected-account tools, accountless execution only for server-allowlisted built-in service tools, one generic result-size bound rather than provider-specific tool or result adapters, direct custom-auth execution only for allowlisted OpenWeather read tools, and a separate direct-execute path only for agent-approved primary-calendar event creation with unsupported write arguments rejected before provider execution and failed or ambiguous provider outcomes marked non-retryable.

Hosted group runtimes execute as synthetic thread-container members, not as any participant's personal account. Turn planning derives that scope from the existing conversation audience and makes it part of the thread contract. Group turns omit personal browser, phone, Family, wearable-connect, and connected-account management authority; connected-app search and execution remain only for server-allowlisted accountless service tools. The web control plane independently rejects personal Family, wearable authorization, and connected-account operations for thread-container members. Group-owned management, sharing/join flows, newsletters, and explicitly room-routed automations remain separate authorities; a personal Settings page never configures a room. One structured automation write creates the single group newsletter and stores its delivery choice as a system-owned tag: current-chat editions use the ordinary bound-route conversation outbox, while email editions alone receive the one-shot prepare/send capability. Email preparation derives the group from the signed runtime member rather than a model-supplied group id and persists the private authorization proof plus HTML on the existing assistant outbox parent; once that parent is sent it is a pruning-protected immutable occurrence manifest, and terminal recipient evidence for that occurrence is retained with it, so safe recipient retries copy its payload and proof instead of creating a second body under the same message identity. Because newsletter email `From` identity is spoofable, group-email replies may converse and read current group context but cannot mutate automations, join policy, group presentation, or other durable room controls; those actions require the authenticated group-chat route.

For retained group-participant activity reporting, an authenticated non-direct
Linq or Telegram mailbox wake may carry the internal member id already accepted
by Web ingress. That optional encrypted fact is group-only, immutable
admission-time analytics identity; it is not model input, display data, or
runtime entitlement authority. Direct wakes reject it. The growth projection
uses current blind-index resolution only for legacy wakes and unregistered Linq
participants, falls back to the existing keyed opaque sender identity when no
legacy registration remains, and omits valid group-email wakes because that
channel has no authenticated per-sender attribution.

External conversation directness is three-state authority. Explicit direct evidence and the local no-route fallback permit private-member context; explicit non-direct evidence permits synthetic group-container context; an external audience with unknown directness is unverified and receives neither authority. One conversation-scope resolver owns that classification. Stored directness applies only to its stored audience, and an allowed session rebind clears it when the audience changes without fresh directness evidence. Unverified inbound conversations receive a deterministic audience-safety reply without starting the provider, unverified notifications skip before every model or exact-text delivery path, and provider planning rejects unverified audiences as a final boundary assertion.

Hosted automation writes use a narrow root-turn tool backed by an invocation-scoped automation port. The already-bound member or synthetic-group runtime vault remains the sole owner of canonical automation records; the tool adds no service, credential, transport, or second record owner. An authenticated hosted conversation may edit, pause, archive, or reactivate any automation in that vault even when the record stores an older route. New records and explicit retargets persist only the trusted current route instead of model-supplied locators or directness; ordinary edits preserve the stored route. Scheduled automation occurrences enter the same conversation turn planner, prompt stack, thread policy, skill surface, and dynamic-tool assembly as attended turns. The stored automation instructions are the user request; occurrence and delivery facts are trusted turn context, and send-or-skip JSON is only the delivery envelope. Tool availability still follows the ordinary invocation's actual ports, audience, accepted-input evidence, and effect-owner checks rather than the trigger origin. A detached `assistant.notification.requested` system event without a valid occurrence is not a scheduled or user turn: it uses an isolated output-only formatter with no conversation history, private context, resume mutation, or tool and network surface, while the platform retains delivery ownership. That formatter runs through the existing one-shot App Server process path so its restrictive launch config cannot rotate the resident ordinary-turn process or terminate valid detached enrichment. Unauthenticated group-email replies remain read-only because their audience does not authorize durable room controls, not because they use a separate assistant profile. Explicit arbitrary-route authoring remains a local operator capability. For scheduled Linq execution, the persisted route is only a bounded routing hint: before model or provider work, the existing web egress owner resolves the concrete destination and its direct/group fact. A known group route never falls back to a personal home; a personal or legacy-unknown route may use the owner's authorized current-home fallback. Unresolved authority remains retryable without a marker or manual-repair protocol.

Scheduled non-direct Telegram execution follows the same hint-only rule without Linq fallback: the signed Web route owner must assert the exact channel, synthetic container member, and thread before group tools or model work. That exact authority is persisted on the ordinary conversation outbox and reasserted against the same Web owner immediately before each Telegram provider effect. Missing ownership is retryable; changed or mismatched ownership fails closed without a repair queue or second route store.

### Canonical Automation Support Lifecycles

The vault automation record is the only owner of a support automation's schedule, status, route, optional finite `activeUntil`, exact plan-support `supportKind`, and reserved `system:support-series:<seriesId>` ownership tag. An automation may have at most one support-series tag. Once assigned, ordinary patch or upsert operations cannot remove or replace it; legacy unowned records may receive their first owner. Exact-series reconciliation atomically archives every active member outside the desired automation-id set while leaving user-paused members paused, and namespace reconciliation rejects duplicate ownership or one desired id assigned to two series. Plan-owned experiment, habit, and supplement support revalidates the immutable owner and its active status before provider work, immediately before delivery, and before commit. The active automation's typed support kind is the exact persisted support consent for habit and supplement plans; experiment support also requires its matching live `assistantSupport` switch. Execution re-reads canonical state immediately before delivery, archives an elapsed record when `now >= activeUntil`, and never sends after that boundary. A one-shot `activeUntil` must be later than its scheduled instant. Required-send retries remain eligible only while that finite window is open.

Automation evidence distinguishes intent, dispatch, and receipt. Enqueue state, generated transcript, provider transcript, and a delivery attempt prove intent only. Provider acceptance or a runtime `sent` state proves dispatch, not handset receipt or reading. Only channel delivery/read evidence or a later member reply that refers to the message proves receipt. Silence without receipt evidence must not become ignored support, non-adherence, or refusal.

### Provider-Neutral Wearable Sleep Pattern Read Model

`packages/query` derives one provider-neutral sleep-pattern summary from canonical wearable sleep evidence; it does not create a second persisted sleep owner. The default 28-day window reports coverage and missing dates without zero filling, excludes explicitly identified naps, and retains legacy records with unknown sleep type under an explicit caveat instead of guessing from titles. Duplicate and overlapping windows are suppressed deterministically. Session duration uses elapsed UTC instants across DST, while bedtime, wake, and midpoint use each night's canonical IANA time zone or an explicit validated reporting-zone fallback; clock fields are omitted when neither exists. Per-field sample counts stay visible and variability is withheld below its minimum sample count.

The summary keeps total sleep distinct from session duration and leaves provider-reported awake minutes labeled as awake minutes rather than inferring WASO or awakening count. It surfaces provider and time-zone mixing, local-date mismatches, late-arriving records, nap-only dates, unknown legacy types, overlap suppression, latest sleep end and record time, latest-night age, and per-source staleness both relative to the newest provider and to the absolute as-of date. Assistant guidance must carry these caveats forward and must not turn missing or stale device coverage into a fact about how the member slept.

## Hosted Labs Discovery

`apps/web` is the sole credential, provider-egress, and normalization owner for
read-only Labs discovery. It reads `JUNCTION_API_KEY`, targets the fixed
production US Junction origin, and projects live provider-declared panels,
biomarkers, catalog prices, ZIP coverage, and patient service centers into the
strict `@murphai/hosted-execution/labs` contract. The authenticated Labs
browser API at `POST /api/labs` and the signed hosted-runtime callback at
`POST /api/internal/hosted-execution/labs/tool` call the same stateless service;
neither path introduces a database, cache, sync job, search index, search
history, or ZIP persistence. Junction's catalog and location read APIs require
GET query parameters, so the Web owner sends the bounded catalog term or ZIP
only to the fixed Junction origin and never records or logs the full outbound
URL. The browser and Cloudflare boundaries remain semantic POST bodies.

Cloudflare carries only an optional semantic Labs port over the existing signed
`web-control.worker` boundary. `packages/assistant-runtime` passes that port
into `packages/assistant-engine`, which registers the read-only `murph.labs`
dynamic tool only for a verified private direct turn when the capability is
present. Group and unverified contexts do not receive the tool. The assistant
and browser receive only bounded normalized facts with provider provenance and
check time; the provider credential, authorization header, raw body, and raw
error remain inside Web.

The authenticated, unlinked `/labs` page is a second consumer, not another
catalog owner. It supports live search, offering detail, and a ZIP-based
location list. Ordering, payment, booking, eligibility, requisitions, results,
custom panels, maps, and navigation exposure remain absent. Provider amounts
are current catalog prices rather than quotes, and a returned collection site
is not an appointment or proof that a selected offering can be collected
there. The behavior and deploy contract live in
`agent-docs/product-specs/labs-discovery.md`.

## Hosted Clinical Records

`apps/web` is the Clinical Records credential and provider-egress control plane.
It owns the versioned Epic directory, short-lived connect intent, single-use
SMART state/PKCE session, encrypted patient/token authority, retrieval
generation, and operational status. `/records/connect` keeps the member-bound
claim in the URL fragment, removes it from the visible URL before interaction,
and sends it only in the fixed provider-start body; `/records` projects the
safe connection and latest-run status and owns disconnect UX. A private
current-user assistant turn can create the same short-lived first-party link
through the existing Clinical Records runtime port and signed Web control
boundary. That tool accepts no member, provider, patient, recipient, URL, or
scope argument, so provider selection and SMART consent remain browser-owned.
The initial lane permits one retrieval
generation per unique member/provider connection; later retry, reconnect, or
refresh requires a bounded raw-evidence retention lifecycle. The Epic beta
requests only Patient read, laboratory Observation search, and DiagnosticReport
search, with no offline-access scope. Each retrieval run also freezes the exact
adapter-owned query plan in additive operational JSON. Stable `queryScopeId`
and deterministic `sliceId` values distinguish repeated resource-type queries
and bounded history windows, but they are acquisition identity only and never
participate in canonical FHIR identity. The hosted runner receives only a
credential-free descriptor and bounded raw FHIR pages through the three signed
retrieval operations; Cloudflare proves and forwards the active attempt, lease
generation, and workspace version before web revalidates the fence shape and
bound member. Postgres stores no raw FHIR body. Raw-first page integrity and
FHIR import decisions remain with `packages/clinical-records` and
`packages/importers`, canonical writes remain with `packages/core`, and the
active hosted runtime reaches that composition through `packages/vault-usecases`.
Accepted pages are atomically staged by that vault owner in one bounded,
private, portable `.runtime/operations/clinical-records/**` checkpoint so
foreground preemption resumes without replaying completed provider pages. The
checkpoint is non-canonical and is removed when import or terminal rejection
is captured; final raw paths remain absent until full semantic validation.
The full behavior and rollout contract lives in
`agent-docs/product-specs/clinical-records-intake.md`.

Member-scoped hosted runner operations validate the existing active runtime write fence at the Cloudflare route that owns the read or effect. The fence binds the claimed member, attempt, and lease generation before private-content decryption, artifact access, signed web callbacks, or durable mutation. Runtime clients attach the current lease through their existing transport boundary; member-scoped identity and authority are never derived from Cloudflare container ids. The pre-binding container-fatal sink is the sole log-only exception.

## Hosted Computer Authentication

`apps/web` owns both Kernel login transports behind the existing durable
computer handoff. The agent selects `managed_login` for Kernel Hosted UI and a
durable profile/domain auth connection, or `login` for the existing Live View
takeover. Managed Auth connection ids and flow state remain Kernel-owned and
are rediscovered from the member's deterministic profile plus the
server-observed domain; Murph does not duplicate them in Postgres. A
checkpointing handoff serializes profile-writer transfer between the normal
task browser and the Managed Auth browser. Saved credentials, health checks,
and automatic reauthentication are enabled for managed connections, session
recording is disabled, and account deletion removes connections before the
profile. Completing a direct Live View login leaves the awaiting task browser
as the sole profile writer so the public Done request can return without waiting
for profile checkpoint and replacement. Only a later conversation-authorized
resume may atomically claim the completed handoff as the sole `checkpointing`
provider owner. That owner stops the browser to save the profile, creates and
durably publishes its replacement, and atomically consumes the claim while
returning browser control to the assistant. An ambiguous failure retains the
claim for bounded stale-owner recovery; overlapping resumes cannot call Kernel.

## Hosted Phone Calls

Outbound hosted phone calls are a web-owned Retell side effect reached through
one bounded hosted runtime port. The assistant may expose
`murph.create_phone_call` only when a hosted phone-call port is present, and
the tool accepts only a compact call brief with an E.164 destination, explicit
goal, timezone, success criteria, and user-approved shareable facts. Cloudflare
may call only the signed `web-control.worker` callback for
`POST /api/internal/phone-calls` with the active runtime write fence; Retell API
keys, from numbers, and agent ids/versions remain in `apps/web` env and never
enter runner env, prompts, diagnostics, or workspace state. Transfer numbers are
resolved server-side from verified hosted member identity when the brief allows a
live transfer. `apps/web` stores one member-bound `HostedPhoneCall` row per real
call for request-key idempotency, provider call id, status, bounded call brief,
and final analysis. Briefs and results are encrypted before persistence with the
control-domain hosted secure-box lane and AAD bound to the member, table, row,
field, and scope; only provider/status/timestamp identifiers remain operational
metadata. During account deletion, the member is suspended before `apps/web`
processes a bounded batch containing every durable Retell provider call id,
stops active calls, and deletes each provider object before clearing its local
id. The `HostedPhoneCall` row remains the retry owner on any ambiguous provider
or local-write failure, and the destructive account transaction fails closed
while any provider id or active unbound reservation remains. Nullable legacy JSON columns are read only when ciphertext is absent
and exist solely for the bounded migration scrub. Retell reaches `apps/web` only through signed raw-body
function/webhook routes for `ask_murph`, `call_ended`, and `call_analyzed`;
Murph does not persist raw Retell transcripts, request bodies, recordings, or
call audio.

## Hosted Account Deletion

Before canonical member removal, `apps/web` inserts one foreign-key-free,
KMS-encrypted external-cleanup receipt in the same transaction. The receipt is
the sole post-delete owner of the minimal Cloudflare runtime, Stripe customer,
and Privy identifiers; target completion is independent, retries use the
existing retention sweep, and terminal convergence deletes the receipt.
Account deletion first locks and suspends the owner plus every owned thread
container, and every relationship writer that can add a runtime, Stripe, Family,
or Privy target shares that member lock and rejects suspended owners. The final
deletion transaction locks the same owner first and rejects any target-set
change before persisting the receipt or deleting local rows. A searchable,
non-reversible Privy lookup key on an incomplete receipt blocks identity
re-creation and lets retries prove that a newly bound identity cannot be
deleted.

Immediate provider attempts share one five-second abortable deadline. Retention
attempts share one fifteen-second abortable deadline, use bounded four-receipt
concurrency, and delete Cloudflare runtime targets through a four-worker pool.
Cloudflare authorization acquisition and provider fetches are inside the
deadline; queued targets are left for the next retry after it expires.

Cloudflare completion requires an explicit `deleteAllCompleted` result in
addition to alarm, SQL-state, and R2 completion. A legacy Worker response
without that capability remains pending. Deploy Cloudflare before web and keep
the capability-bearing Worker as the rollback floor once web can create these
receipts; the database migration must precede the web deploy.

## Hosted Assistant Personalization

`apps/web` remains the canonical projection and mutation owner for hosted tone,
voice, model, and reasoning preferences; canonical tone, voice, and personality
truth converges into the current runtime's `bank/preferences.json`. The
assistant-accessible `murph.personalization` tool
reads model availability as context but mutates only tone and voice through one
active-runtime-write-fenced, runtime-bound, signed `web-control.worker` callback
with strict read/update contracts. The
validated fence identity is the only member identity forwarded and signed for
the web callback: it is the person member in a direct runtime and the synthetic
thread-container member in a hosted group runtime. No participant identity or
model-selected target crosses this boundary. New `conversation.message` mailbox rows also store a nullable
server-keyed lookup of their existing deterministic assistant input id; the raw
id is not persisted there, and this adds no mailbox wire, `sourceRef`, or
event-id field. For an update, the runtime forwards the terminal
provider-accepted input id only after the accepted ids revalidate as one
same-conversation, same-reply-anchor, exact-successor batch. Inside the mutation
transaction, web resolves the
callback member plus a keyed lookup of that id to one live conversation-lane
`conversation.message` row and uses the row's canonical causal sequence.
Missing, legacy, mismatched, or ambiguous identity fails closed with no numeric
sequence fallback. A person-runtime mutation additionally requires that exact
input to be a direct conversation wake; explicitly authorized direct email is
accepted, while non-direct Linq or email fails closed. A synthetic
thread-container mutation requires that exact input to be a non-direct Linq
wake whose current route authority is still bound to the same container; group
email and stale, direct, missing, or cross-room authority fail closed. Tone and voice changes continue to
append the existing `member.preferences.updated` mailbox event inside the web
transaction and converge into canonical vault preferences through normal
runtime handling. Hosted `murph.assistant_style` set/reset operations use a
separate strict personality action on that same signed, input-bound callback;
local mode continues to mutate the canonical vault directly. Web resolves the
accepted input's causal sequence inside the transaction, applies Humor, Push,
Detail, and the conversational-only Unhinged dial independently against nullable
per-dial projection watermarks, and
atomically updates the display projection plus watermark. When at least one
requested dial applies, it also appends a sparse
`member.preferences.updated` event with `causalOrigin: "turn"` and the original
intent sequence. A newer sequence advances that dial's watermark even
when its visible value is unchanged; an older sequence is a field-local stale
no-op; the same sequence plus the same value is an idempotent retry; and the same
sequence plus a different value is a later command from the same accepted turn.
The runtime uses Web's requested effective results as an invocation-only
overlay, while `show` still begins from canonical vault state; the mailbox event
remains the only durable path into `bank/preferences.json`.

Authenticated hosted Linq group turns register the same `murph.personalization`
and `murph.assistant_style` tools against the room runtime. The container's
`HostedMember` projection fields and canonical room vault therefore own Tone,
Voice, Humor, Push, Detail, and Unhinged for that group. Saved room tone and personality
enter later attended and scheduled hosted group turns, and saved room voice
enters later generated voice
output. They never read, inherit, or mutate a speaker's private Murph
preferences. Group email may apply the room's already saved style but cannot
mutate it. Model and reasoning controls remain unavailable to group runtimes and
continue to use their separate relation-derived resolution.

Model and reasoning
changes remain exclusively owned by `murph.assistant_configuration`. The
runtime may request an update only from eligible user input in the active
bounded exact-successor provider batch and
forwards only that batch's terminal input id; inside the mutation transaction,
web binds that input id to the callback member and one live conversation
mailbox row before re-deriving access and Sol eligibility. A confirmed change
applies to the next separately accepted provider turn, including a follow-up in
the same active invocation, without passkey approval, a mailbox event, or a
vault copy. The running turn keeps its starting target. Murph preserves the
same provider-native Codex thread and sends both the selected model and
reasoning effort on that next turn's `turn/start`, matching Codex's native
model-switch lifecycle instead of rebuilding context from a fresh thread.
Only the authoritative
web response updates an ephemeral invocation-local projection; web remains the
sole durable owner, and a later invocation rereads the preference there. Idle
maintenance attributes compaction usage to the model actually bound to the
warm thread, not a future preference, and skips provider work when that model
cannot be priced. The
runtime and web control plane
accept only the input-bound update shape; approval-shaped configuration
callbacks are rejected. The personalization response
returns only the effective enum values (normalizing absent stored style to the
shared `formal`/`upbeat` presentation defaults), read-only model availability,
and truthful saved/unchanged state so the assistant can confirm what actually
happened. The personality response additionally reports each requested dial as
saved, unchanged, or superseded so a delayed callback cannot echo stale intent.
No vault-only setter or second personalization store exists for hosted writes.
Personal Settings remains a fallback for a person's direct Murph only; it is
never presented as a way to configure a group room.

Conversational subscription changes use a separate input-bound capability from
the read-only `murph.plan_usage` projection. The projection keeps its
thresholded `recommendedAction` separate from an opt-in
`subscriptionActionQuote`: the recommendation is advice based on usage, while
the quote is current server-owned terms for an explicit member request and is
neither a recommendation nor consent. Callers that send the original empty
request receive the original response shape with the quote field omitted.
Assistant runtime advertises
`murph.subscription` only for a private personal turn with current accepted
member input, and it attaches that accepted input id rather than accepting one
from the model. Cloudflare carries the bounded action over its signed
`web-control.worker` transport without Stripe credentials or billing truth.
Web binds the input to the callback member and a live conversation message,
then atomically claims the first subscription action on that existing mailbox
row. The claim is bounded by mailbox retention: an exact retry may continue,
while a different action for the same input fails closed. This proves current
authority and provenance but not the meaning of the member's text. Assistant
policy requires the explicit exact choice. Web then re-derives current
eligibility and delegates only continue-Pulse,
start-Pulse-now, or upgrade-to-Edge choices to the existing billing services.
Pulse activation keeps its existing Stripe-hosted invoice or Customer Portal
handoff when payment is required; a pending Edge change uses Customer Portal
without a separate invoice lookup. This path adds no subscription table,
scheduler, trial-ending webhook, custom checkout, App Clip, or automatic model
change.

## Module Map

Only five packages are published to npm: `@murphai/contracts`, `@murphai/hosted-execution`, `@murphai/gateway-core`, `@murphai/murph`, and `@murphai/openclaw-plugin`. All other `packages/*` entries remain workspace-private owner packages. When a public package still needs one of those private workspace packages at runtime, the release flow bundles that private dependency into the public tarball instead of publishing it as a standalone npm package.

## Package Boundary Rules

- Treat each workspace package `package.json` as a small public contract, not as a mirror of the internal file tree.
- Keep `exports` narrow and semantic. Prefer a few intentional entrypoints such as `"."`, `./runtime`, `./helpers`, or another owner-level seam over file-shaped paths like `./usecases/foo` or `./assistant/bar`.
- If a package starts needing many unrelated subpath exports, split ownership into a new package or a clearer owner surface instead of growing a long `exports` list.
- Compatibility shims are temporary migration tools only. Hard-cut them once callers move, and do not leave pass-through files or re-exports around as permanent API.
- Do not re-export another package's broad surface just to make imports shorter. Callers should depend on the real owner package when that owner already exists.
- Keep root barrels and public entrypoints behavior-oriented. Internal helper modules, test-only seams, and source-layout details should stay private unless there is a deliberate owner-level reason to publish them.
- When tightening a package boundary, update the matching package-shape or boundary guard tests in the same change so future drift fails mechanically instead of relying on memory.

- `packages/contracts`: canonical Zod contracts, shared event-envelope/lifecycle parse and revision-collapse helpers, TypeScript types, generated JSON Schema artifacts, the canonical static lookup-ID family catalog/classifiers consumed by query and vault-usecases, and the shared vault-family registry/layout/query-source metadata consumed by core, query, and inboxd
- `packages/clinical-records`: workspace-private pure Clinical Records Intake contract owner for raw FHIR retrieval manifests, explicit completed-resource-family declarations, canonical FHIR base/patient/page hashing helpers, facet-free resource-level FHIR external references, and one-decision-per-resource `upsert | retract | review` import plans; it does not own OAuth, provider credentials, raw-file writes, assistant behavior, or canonical vault mutation
- `packages/hosted-execution`: shared hosted control-plane contracts, HMAC signing/verification helpers, vendor-neutral env readers, route builders, computer-use request schemas, phone-call start contracts, and side-effect codecs; it no longer owns Cloudflare worker-host topology or proxy-client inference, and app-local adapters now own deployment-specific transport, hostname, and token policy
- `packages/hosted-orchestrator-temporal`: workspace-private Temporal worker package for hosted runtime orchestration. It owns the per-user workflow, the global device-sync scheduled-wake reconciler workflow, pointer-only signals, Activity retry boundaries, Temporal Schedule/client helpers, and the worker process entrypoint used by the root Render Background Worker Blueprint. Its production build pre-bundles Workflow code for `workflowBundle` startup, while local/dev startup keeps `workflowsPath`; the production worker also sets an explicit shutdown grace policy bounded by Render's shutdown-delay window. It must not store raw webhook payloads, mailbox bodies, prompts, transcripts, provider responses, provider tokens, dirty resource bodies, or workspace snapshot contents in Temporal workflow state.
- `packages/runtime-state`: workspace-private shared hosted email/env/loopback/id helpers plus pure hosted bundle identity types/equality on the root package, a worker-safe `@murphai/runtime-state/assistant-generated-deliveries` exact-ref contract, an explicit `@murphai/runtime-state/node` subpath for hosted bundle codec/materialization, an explicit `@murphai/runtime-state/node/assistant-state-fs` subpath for assistant runtime-state write/audit/repair permission policy, explicit `.runtime` taxonomy/path resolution (`operations` vs `projections` vs `cache/tmp`), assistant runtime path/security helpers, process scoping, versioned JSON helpers, and SQLite-backed Node-only migration seams
- `packages/core`: workspace-private canonical mutation owner for live local-vault evolution, with current-format canonical reads/writes failing closed on non-current `formatVersion` values; it also owns the shared raw-attachment staging/manifests and canonical event attachment metadata used by document, meal, workout, and measurement writes, the dedicated `addActivitySession` and `addBodyMeasurement` seams for workout-session and body-measurement persistence, provider-agnostic wearable storage repair primitives for proven legacy/debug telemetry bloat, the verified raw-to-gzip transition and streaming gzip read/amendment path for closed monthly integration-ingest shards, and the shared event-spine envelope assembly used by generic events and health-event writes over the single `ledger/events` seam. Public bulk event import accepts legacy payload batches plus explicit upsert/retract decision batches and reconciles strict ISO `externalRef.version` values monotonically at that owner: it orders same-identity decisions by source revision within a batch, ignores retrieval-local provenance for source-semantically equal replay, rejects equal-version conflicts, supersedes newer same-kind values, tombstones and replaces newer kind changes, and tombstones newer retractions. An unseen retraction is persisted as an invisible deleted source marker in the same event ledger, preventing stale resurrection without a parallel watermark store. Blood tests stay canonical `kind: "test"` records behind a projected user-facing view.
- `packages/importers`: workspace-private ingestion adapters that parse external files or provider API snapshots, normalize them behind registry-based adapters, and delegate all writes to core; the clinical FHIR adapter validates each raw page exactly once for file integrity, declared resource family, manifest patient plus FHIR-base binding, same-base root-reachable pagination, and FHIR modifier semantics before emitting one upsert, retract, or review decision per resource
- `packages/device-syncd`: workspace-private local device OAuth/webhook/reconcile runtime with an authenticated localhost control plane, optional separate public callback/webhook ingress, a reusable shared public-ingress core for future hosted/tunneled callback surfaces, the canonical `@murphai/device-syncd/client` control-plane client/contracts surface for workspace or bundled callers, and durable local operational state under `.runtime/operations/device-sync/**` split explicitly into connection identity/config, credential authority state, and observation/reconcile state while normalized provider snapshot imports still flow through importers/core. Provider-owned modules keep auth, refresh, scheduling, webhook-preflight/admin specifics, and bounded product-needed resource windows; shared ingress/config surfaces stay provider-agnostic, and the provider registry/config/env/job-schema/hint/serialization seams now derive from one shared provider-manifest registry.
- `packages/messaging-ingress`: workspace-private shared stateless messaging-provider ingress package that owns provider webhook parsing/verification, target grammar, supported-message extraction, summary helpers, and sparse raw minimization for transports such as Telegram and Linq without taking on polling drivers, hosted policy, or runtime persistence
- `packages/inboxd`: workspace-private inbox capture ingestion/runtime package that owns the first-class append-only inbox-capture and inbox-attachment-retention ledgers, raw inbox attachment bytes, and bounded text projection while keeping inbox-only cursors, source-specific checkpoints, capture indexes, and audio/video transcription job state in a rebuildable local SQLite projection under `.runtime/projections/inboxd.sqlite`, with inbox daemon/config JSON state under `.runtime/operations/inbox/**`. The current inbox-capture v2 ledger record is the sole committed metadata owner; new captures do not retain a duplicate raw envelope. Message text is bounded to 20,000 characters inline and 64 MiB total; a longer body is one immutable hash/size-verified content artifact under the capture's raw directory, so routine ledger scans do not reread sender-controlled historical bodies. The explicit repair path can prove a legacy envelope equivalent, write any required text content, append its v2 replacement, and receipt-guard delete it atomically. Static hosted callers consume the narrow `@murphai/inboxd/retention` and `@murphai/inboxd/checkpoint` entrypoints so capture persistence remains outside the runner's pre-listen bundle closure. Image attachment bytes are normalized before canonical inbox storage so downstream assistant evidence refs see the bounded canonical image rather than the connector-original image bytes; image inputs that cannot be normalized to an allowed static raster WebP are left unstored. Raw inbox image/audio/video bytes expire after 14 days unless protected by active work or explicit durable save/pin evidence; expiration preserves attachment descriptors and parser derivatives through `ledger/inbox-attachment-retention/**` and projects `retention_expired` to readers instead of treating missing bytes as corruption. Canonical inbox raw metadata also drops size-like provider fields so original attachment or raw-message byte sizes do not survive in the ledger. Inbox is a projection/enrichment surface for search, display, audio/video transcript evidence, raw attachment paths, and debugging context; Codex admission does not stage hidden runtime-only inbox rows. It consumes `@murphai/messaging-ingress` for stateless Telegram/Linq ingress semantics while continuing to own polling connectors, local capture persistence, and the optional inbox-plus-parser daemon composition helpers layered on top of parser-owned runtime contracts
- `packages/parsers`: workspace-private local-first audio/video attachment transcription (local whisper.cpp when installed, plus a config-driven remote transcription HTTP provider used by hosted execution), parser-service helpers, parser-owned runtime/store contracts for media transcription, and one versioned `result.json` bundle per derived attempt under `derived/inbox/**`; it also owns the strict bundle decoder and explicit legacy-attempt compactor, and does not own inbox daemon orchestration or depend upward on `@murphai/inboxd`
- `packages/query`: workspace-private read helpers, export-pack generation, query-local event display-identity derivation, the semantic wearable day-summary and provider-neutral sleep-pattern read models over imported device evidence, the rebuildable local query projection over canonical vault data under `.runtime/projections/query.sqlite` that now backs both `readVault()` and lexical search, the stable reference-graph readers for `bank/library/**`, the pure parser/search/index helpers for derived knowledge pages under `derived/knowledge/**`, and the read-side adapters that consume shared MetricPoint contracts from `@murphai/health-metrics` plus shared health registry projection metadata, event lifecycle/revision collapse helpers, and static lookup-ID family classification from `@murphai/contracts` instead of maintaining duplicate query-local copies. Experiment progress-card sentiment accepts an injected snapshot of canonical biomarker desired directions and keeps that health interpretation separate from experiment-hypothesis agreement.
- `packages/health-metrics`: workspace-private neutral MetricPoint contract owner for health metric definitions, source metadata, unit normalization, display formatting, and selection policy reused by query projections and browser-vault exports
- `packages/vault-usecases`: workspace-private CLI/headless vault usecase orchestration owner over `packages/core`, `packages/importers`, and `packages/query`. It owns command-shaped service interfaces, shared CLI-style input normalization, lazy runtime loaders, assistant-safe vault path helpers, and the neutral `@murphai/vault-usecases/vault-services` factory used by CLI, assistant, daemon, setup, hosted runtime, and inbox-service callers that need one composed vault service surface without importing owner internals. It composes the compact Health Commons desired-direction lookup into experiment progress-card snapshots without making query depend on the filesystem-backed Health Commons runtime. It must stay a thin composition layer: canonical record schemas and static lookup-ID family classification stay in `packages/contracts`, canonical writes stay in `packages/core`, imports stay in `packages/importers`, query projections and event display identity stay in `packages/query`, device runtime and control-plane composition stay in `packages/device-syncd`/`packages/cli`, inbox daemon behavior stays in `packages/inboxd` and `packages/inbox-services`, and assistant/session state stays in the assistant runtime packages.
- `packages/health-commons`: workspace-private public Health Commons owner for protocol pages, biomarker pages, source pages, exact protocol revisions, generated catalogs, and future aggregate outcome summaries consumed across local and hosted surfaces
- `packages/assistant-engine`: workspace-private headless assistant execution runtime that owns provider-turn execution, tool/runtime assembly, assistant state/outbox/status/store surfaces, assistant automation, the single assistant input spine, assistant-specific vault/inbox/knowledge tool surfaces, hosted computer-use dynamic tools, Murph-managed package skill assets under `skills/**`, attachment prompt-bundle audit support, and active-outbox reconciliation for assistant-owned one-time delivery staging under the exact flat assistant-runtime generated-delivery directory. The stable assistant prompt may route to those package-owned skill files through `$MURPH_ASSISTANT_SKILLS_ROOT`; local and hosted runtime env setup stamps that var to the canonical package-owned skill root. Hosted native Codex skill rendering stays disabled because rendered runner-local paths can break hosted prompt-cache stability. It consumes neutral vault usecase services, runtime loaders, and assistant vault path helpers from `@murphai/vault-usecases`, and consumes provider-target normalization plus hosted provider-preset/config helpers from `@murphai/operator-config` instead of owning duplicate copies.
- `packages/operator-config`: workspace-private operator and setup configuration surface that owns persisted operator defaults, hosted assistant config, assistant backend target normalization, hosted provider-preset/config helpers, setup/runtime-env helpers, device/channel readiness helpers, and CLI/shared command contracts
- `packages/assistant-cli`: workspace-private CLI-only assistant surface that owns the daemon-aware assistant wrappers, assistant command registration, foreground terminal logging, and the Ink chat UI
- `packages/setup-cli`: workspace-private CLI-only onboarding and host-setup surface that owns the setup wizard, host provisioning helpers, AgentMail setup helpers, and assistant/channel/wearable onboarding flows
- `packages/gateway-core`: published transport-neutral gateway boundary package that owns the shared gateway contracts, route helpers, projection/snapshot logic, opaque ids, and event-log helpers used by hosted and future transport adapters
- `packages/assistantd`: workspace-private local assistant daemon package with a bearer-authenticated loopback-only control plane bound to one vault; it fronts steady-state local assistant session/message/status/automation entrypoints directly through `@murphai/assistant-engine` and no longer exposes a local gateway projection/control API
- `packages/assistant-runtime`: workspace-private headless hosted assistant execution surface that exposes one-shot inbox/bootstrap/assistant/outbox/device-sync runtime behavior behind explicit runtime context, owns the canonical hosted runtime launch spec for semantic env splitting, forwarded env profiles, platform-only runtime config, typed resolved config, typed parser toolchain validation, commit timeout, runtime-env projection, and hosted runner executable PATH entries, consumes `@murphai/assistant-engine` and explicit `@murphai/operator-config/*` owner subpaths instead of the umbrella config root, now treats the durable operator `hostedAssistant` config as the only persisted hosted assistant source of truth, consumes shared messaging ingress contracts from `@murphai/messaging-ingress` rather than defining provider semantics itself, stages hosted conversation mailbox input into `AssistantInputEvent` records, may defer intermediate foreground checkpoints, may hot-service only the exact assistant wake projected by the current foreground assistant phase once before the idle floor without publishing a snapshot, and keeps dirty hosted runtime state dirty until the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint succeeds, exports sanitized pending assistant-runtime issue records through the injected runtime platform instead of persisting raw hosted diagnostics in Cloudflare, and expects hosted semantic behavior such as channel readiness and device-sync enablement to arrive as typed runtime config rather than being rediscovered from ambient env in lower layers while Cloudflare's container runner binds image-owned native parser paths inside the container
- `apps/web`: hosted Next.js integration control plane for Vercel-style deployments, backed by Postgres/Prisma for device OAuth sessions, short-lived hosted device connect intents, opaque public device-connection ids plus blind-index ownership mapping, typed durable connection summaries, sparse sync signals, token-audit history, hosted member core/identity/routing/billing/email-authorization slices, hosted legal consent event/grant state, hosted onboarding webhook receipts, hosted Stripe receipt/retry state, the canonical hosted AI usage ledger plus monthly allowance aggregate, append-only purchased usage-credit entries plus their bounded member projection, an anonymized hosted assistant-runtime issue sink with retention metadata and no member relation, hosted product-feedback rows for explicit assistant-captured structured product feedback, encrypted hosted mailbox rows, signed hosted user crypto root-envelope rows/audit events, hosted workspace checkpoint metadata, hosted computer runs/handoffs with one member-scoped Kernel profile name for browser automation, and redacted hosted runtime logs/status; `apps/web` is the canonical owner of hosted product and control facts, including legal consent, product-feedback intake, device-sync control-plane authority, and hosted computer-use browser lifecycle/checkpoint state, while Temporal owns hosted execution wake orchestration and the app-local Vercel OIDC adapter remains for browser/session/status/deletion calls into Cloudflare. Nullable hosted-member model and reasoning preferences are web-owned, billing-gated control facts: active personal members may select Luna or Terra, only an active paid Edge personal member may select Sol, the common reasoning set is `low`/`medium`/`high`/`xhigh`, and Terra plus low are represented by absent overrides. Synthetic thread-container members remain non-configurable and derive a Sol invocation override from the existing thread-container relation without persisting a preference or changing the reasoning default. The signed hosted-workspace read projects eligible personal-member non-default values or that derived thread-container Sol override to Cloudflare for the next invocation; the running Codex turn keeps the target it started with, and neither the vault nor the hosted workspace snapshot stores a second preference. Monthly and valid in-window trial allowance remain measured and noticed, with requested-model and served-model attribution retained in the usage ledger. Subsequent usage-bearing work is denied when included capacity and purchased credit are both exhausted; the crossing operation may finish, and its accepted input remains durable and pending. Included capacity is consumed before carryover credit. Credit grants, usage debits, and the compact balance/version projection serialize under the beneficiary member while base allowance stays separate. Web derives the Settings view and read-only `murph.plan_usage` result from that same owner without persisting a forecast or granting the runtime billing authority; synthetic thread containers return a bounded unavailable result instead of exposing personal plan facts. The personal top-up producer permits only active direct paid Pulse or Edge members to buy the server-owned $5, $10, or $25 offer for themselves through one-time Stripe Checkout. The purchase stores payer and beneficiary separately for later composition, but group funding and group checkout authorization are not implemented. Only verified Stripe-event reconciliation can grant credit; a browser return cannot. A new grant clears the current block when capacity becomes positive and requests the normal runtime recheck through the durable event owner so pending accepted work can resume. Inactive, suspended, malformed or expired trial entitlement, and separate daily Linq anti-abuse gates remain enforceable. The app-local GCP KMS adapter owns web-side root wrapping plus authority signing. Hosted billing may store an encrypted unverified Stripe checkout email on the email-authorization slice for settings prefill plus transactional welcome and cancellation-feedback delivery, but it must not use that fact for account lookup, direct-public sender authorization, or email-linked channel state until Privy verifies the email. Hosted signup activation, settings email sync for members less than two weeks old, or first paid activation with a stored Stripe checkout email may send a best-effort plain-text-only Resend welcome email using env-only sender/API-key configuration and a per-member idempotency key; Stripe reconciliation may also send a best-effort plain-text-only internal signup notification to env-configured recipients using the same Resend API key/sender, a separate durable per-member attempt marker, and a separate per-member provider idempotency key. Stripe subscription cancellation reconciliation may send a retryable plain-text-only Resend feedback/refund email to the verified or Stripe checkout email recipient after a cancellation billing write, with retry ownership held by the existing Stripe event receipt until completion, a receipt-local sent marker suppressing provider resends after success, and provider replay defense held by a subscription-scoped Resend idempotency key. Later successful payments must not re-run activation welcome side effects, and email send paths must not persist provider payloads or expose recipients in logs. Inbound hosted conversation traffic should append one canonical `conversation.message` mailbox item, with provider/channel detail carried inside the payload instead of minting provider-branded top-level message kinds. Its hosted device-sync persistence stays provider-generic, and the signed device-sync scheduled wake sweep command selects due-reconcile candidates and appends bounded `device-sync.wake` mailbox handoffs for the Temporal global reconciler. Dirty webhook freshness is not scheduler input: web persists dirty state, appends one bounded `device-sync.wake` mailbox handoff when a connection moves clean-to-dirty, and the runner drains and acks dirty-pending rows through signed runtime callbacks when device-sync work runs. Hosted provider registration should reuse the shared `device-syncd` provider-manifest assembly path instead of maintaining an app-local provider list.
- `apps/cloudflare`: hosted execution plane for ensure-processing requests (callback-signed from the Temporal orchestrator, or Vercel OIDC-authenticated best-effort direct ingress wakes from `apps/web`) plus Vercel OIDC-authenticated browser-vault session, deletion, status, and web-owned Telegram usage-limit notice requests, plus the signed deploy-smoke callback used to verify the managed container image, with per-user coordination via container-enabled Durable Objects, active write-fence wake/replace behavior, encrypted hosted workspace snapshots, legacy encrypted artifact objects, encrypted runner-secret blobs, short-lived DO-local coordination metadata, derived gateway projections, and a native Cloudflare container image that runs one-shot inbox/parser/assistant/device-sync execution through `packages/assistant-runtime`; it owns execution coordination, configured env profile selection, user-secret allowlisting, image-owned native parser tool paths, Worker-owned provider credential injection through runner HTTPS egress interception, and adapter transport details such as local loopback URL rewriting, while runtime launch semantics and profile key sets come from `packages/assistant-runtime`. Web applies its hosted access-and-usage decision before exhausted runnable mailbox work reaches Temporal or the runner. Cloudflare receives no billing or credit projection, cannot grant usage, and performs no Stripe call. Web preserves hosted conversation input before admission, and allowance accounting runs after usage exists. Cloudflare/runner #587 or newer is the permanent rollback floor while Web omits the retired callback route. Cloudflare carries the signed plan-usage read as a transport-only runtime port and cannot select a member, billing action, or usage interpretation; it owns opaque runtime blobs only, not canonical hosted product facts outside the encrypted workspace snapshot, and it may verify signed ingress/runtime root envelopes and unwrap its P-256 recipient wrap without holding GCP KMS decrypt authority; foreground runtime work may defer intermediate checkpoints, the active invocation remains dirty until the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint succeeds, RunnerContainer never records pending checkpoint intent, and activity expiry is cleanup-only
- Hosted deployment topology has one generated Cloudflare config/deploy owner
  and two manual protected-main targets: `production` and `preview`. The
  `preview` target is a separate trust boundary, not a mode inside production:
  its Web database, crypto context and keys, callback authority, Temporal
  namespace/task queue, Worker, and R2 resources must be isolated and
  environment-scoped. Deployment context selects the Vercel OIDC audience, and
  preflight rejects cross-context crypto/OIDC or production Web/resource
  aliases before provider mutation. The preview target adds no second runtime,
  state owner, or Wrangler environment tree.
- `packages/cli`: the published `@murphai/murph` package plus the `murph` and `vault-cli` binaries, an incur-backed typed operator surface over core/importers/query, quick workout capture as a workflow facade over canonical `activity_session`, `body_measurement`, and `workout_format` primitives, env-gated `route estimate` routing through a CLI-owned Mapbox implementation for distance/duration, temporary address or hiking-POI lookup, and optional approximate elevation, env-gated `research scout` routing through a CLI-owned Exa Search client that accepts only compact tag profiles and does not persist provider output, CLI-owned device-sync control-plane composition over the localhost HTTP/device-daemon boundary, Codex App Server-backed assistant session orchestration, optional env-routed client access to `packages/assistantd` for steady-state local assistant open/send/update flows plus session/status/outbox/runtime inspection and serializable automation control, CLI-owned command/UI/client helpers for the selected vault, one shared bound assistant/vault tool catalog with turn-scoped profiles for canonical memory, canonical automation, assistant runtime inspection, and derived knowledge, saved self-target inspection, bounded vault text reads, deterministic inbox document-preservation helpers, and vault query/write operations across assistant turns, outbound Telegram/Linq/AgentMail email channel adapters, an onboarding/setup wizard that can reuse or discover existing AgentMail inboxes before provisioning, and local host setup commands for macOS and Linux. Programmatic assistant, vault/inbox, and setup surfaces stay in workspace-private owner packages such as `@murphai/assistant-engine`, `@murphai/operator-config`, `@murphai/assistant-cli`, and `@murphai/setup-cli`; the release flow bundles those private owners into the public CLI tarball when needed instead of publishing them as standalone npm products.
- `packages/openclaw-plugin`: published OpenClaw-compatible bundle package in the default Claude bundle layout (`skills/**`) that teaches OpenClaw to use Murph's existing `vault-cli` surface against the operator's configured vault via OpenClaw's built-in `exec` tool, keeping the integration skill-first, vault-first, and free of any second Murph assistant runtime inside OpenClaw
- `fixtures/` and `e2e/`: deterministic fixture corpus and end-to-end smoke flows

### iOS address-book advisory names

The iOS companion owns the optional system Contacts prompt and produces one
bounded, replace-all projection of explicit international phone numbers to
safe first names plus optional last initials. Contact values are request-local
on the device. Web converts each phone through a dedicated non-exportable GCP
KMS MAC key into a member-scoped token and stores only that token/version plus
the encrypted label. Postgres and the ordinary hosted content-encryption keys
therefore do not contain the authority needed to enumerate phone numbers.
This is not zero knowledge: the live Web principal with MAC authority can test
candidates, and provider/runtime processing may pair a live roster handle
with a label.

One CAS projection row owns revision, replay, and enabled state; child rows own
the tokens and encrypted labels. Full replacement, explicit deletion,
permission-loss deletion after the companion next reconciles in the foreground,
and account deletion use that one lifecycle. An enabled projection remains
active until one of those deletion paths runs. The only consumer is the existing
route-authorized group participant read. It consults the human group owner's
projection for at most 16 canonical phone participant handles, independently
of each participant's durable `hasOwnMurph` activation result, and exposes a
match only as current-turn `unverifiedOwnerContactLabel` presentation text. It
is never identity, membership, consent, routing, profile, invite, or signup
authority, and it cannot override a registered participant's Murph identity.
Failures omit the optional overlay without changing the truthful live roster.
The full boundary and rollout contract is
`agent-docs/product-specs/ios-address-book-advisory-names.md`.

### Automatic meal-photo capture

The iOS companion is the only owner of photo-library observation and on-device meal classification. A member explicitly enables the feature, and the companion considers only photos created after that opt-in; the hosted system never receives or scans the rest of the library. Foreground enrollment uses the member's Privy identity token, while background uploads use a dedicated renewable bearer that grants only meal-photo upload and self-revocation. `apps/web` stores only hashes of that bearer and installation UUID plus an encrypted idempotency secret, validates a bounded metadata-free JPEG, and stages the bytes through the internal Cloudflare control client. Each upload attempt owns a distinct staged object. Before the metadata-only mailbox append commits, web locks the hosted member and any active sponsorship membership/group rows, then rechecks the same enrollment, active member access, and launch consent. The first accepted mailbox item chooses the canonical object for exact duplicate attempts; losing or failed attempts delete only their own unclaimed object, while ambiguous commit cleanup first reconciles against the mailbox. Postgres, Temporal, and the hosted mailbox receive metadata only.

`apps/cloudflare` encrypts each staged JPEG into a private per-user R2 object. Object deletion derives the user-namespaced R2 path directly and does not require the user's encryption context to remain available. The metadata-only `meal-photo.captured` mailbox item wakes `packages/assistant-runtime`, which verifies the object's length and digest, imports one idempotent photo-only meal through `packages/core`, and schedules object deletion only after the workspace checkpoint succeeds. The R2 lifecycle rule makes staged meal-photo objects eligible for asynchronous deletion at 31 days, one day beyond mailbox recovery retention; successful imports still delete staging immediately after the checkpoint, and 31 days is not a guaranteed physical-deletion deadline. Neither the enrollment row nor R2 is canonical meal truth; the member's encrypted hosted workspace remains the canonical record.

That same canonical import ensures one ordinary Murph-managed automation for the member at 9:00pm local time; meal capture has no second automation opt-in and no meal-specific scheduler. Enrollment requires an existing active private iMessage or Telegram thread or a verified email target so that postcondition is deliverable, and each accepted upload carries that Web-resolved direct route in its private mailbox envelope. The first import uses the envelope route to create the automation, while later imports idempotently reuse the same automation record without another service lookup. A direct email occurrence re-resolves the bound member's current verified address through the existing signed Web-control boundary immediately before provider work, so replacement or revocation never leaves the saved address as delivery authority. Reconciliation authorizes runnable conversation or model work normally even when system lag is also present; a blocked model wake can still admit the existing import-only system mode. System-only import checkpoints the ordinary cron wake created by canonical import and then runs the ordinary post-checkpoint staging cleanup. An accepted meal capture is member-wide engagement under the existing 28-day automation policy, equivalent to a direct inbound interaction, so ordinary due automations may resume; AI-usage authorization remains unchanged. At runtime the ordinary automation agent reads one bounded batch of same-occurrence retry evidence followed by the oldest captures that still retain photos, sends a dated catch-up for a late import, includes supported calorie and macro totals by default while still suppressing numbers in eating-disorder-risk, intuitive-eating, or number-sensitive contexts, and invokes the automatic-capture-only `meal remove-photo` command. The retained photos are the only work queue. A no-photo meal whose removal revision was recorded at or after the current scheduled occurrence remains part of that occurrence's retry, preventing a mid-turn provider or partial-cleanup failure from losing the closeout without adding another state owner. `packages/core` owns the audited mutation: it preserves structured meal truth, replaces retained JPEG bytes with a privacy tombstone, updates the raw manifest atomically, and rejects non-capture meals or changed evidence.

### Clinical Records retrieval

Clinical retrieval ownership is intentionally split across existing layers.
`apps/web` owns provider directory facts, encrypted OAuth credentials, same-base
FHIR pagination, opaque cursor/request replay, run state, and the signed
read/fetch/outcome routes. Its durable system-mailbox handoff is exactly
`{runId, generation}` and uses the existing per-user Temporal workflow.
The member/provider unique connection owns one initial retrieval generation,
which bounds immutable raw-evidence directories until a future retention owner
can preserve canonical raw references across refreshes.
`apps/cloudflare` supplies only the typed signed-web-control transport adapter.
`packages/assistant-runtime` performs finite preemptible background iteration,
resuming from the vault-owned operational checkpoint after preemption. The
versioned runtime contract accepts either the current resource-family descriptor
or explicit query slices; query-aware raw pages and completion state remain
grouped by query/slice through the checkpoint and v3 raw manifest. Existing v2
manifests and v1 checkpoints remain readable. Each run pins its retrieval
protocol at creation: existing nullable-protocol rows remain legacy for their
entire lifecycle, while new runs emit `query-slices-v2`. Query-aware page
requests, opaque cursors, durable request claims, and terminal outcomes bind
the frozen query-scope and slice identities so they cannot be swapped across
the same resource type. Epic's active policy expands 24 primary query scopes
from 17 unique granted FHIR resource permissions. Fifteen scopes use one
whole-family slice and nine freeze one newest-first 90- or 365-day initial
window at run creation. Supporting dependency reads remain registration-only;
resource families without a canonical mapper still enter the patient-bound raw
evidence and explicit-review path. Then
`@murphai/vault-usecases/clinical-records` revalidates the web-owned current run
immediately before atomically committing immutable raw pages and the retrieval
manifest, and again before lazily invoking
`@murphai/importers/clinical-records` and core canonical writes. Raw FHIR page
bodies live only in the user vault's bounded operational checkpoint, final raw
evidence, and encrypted hosted workspace snapshot; they never enter assistant
session state, Postgres, Temporal state, the mailbox pointer, hosted logs, or
model context.

Current hosted external-data lookup boundary: `apps/web` owns read-only product label lookup on `/api/foods` and `/api/supplements`, authenticated by the shared server-to-server `MURPH_DATA_API_KEY`. The shared labels database is configured by `MURPH_LABELS_DB_URL`, and both `/api/foods` and `/api/supplements` require it; `MURPH_SUPPLEMENT_DB_URL` is not a runtime fallback. Deployments must configure `MURPH_LABELS_DB_URL` before serving label lookup routes. The `foods` table stores USDA/FDC rows, and the `supplements` table stores DSLD, DailyMed, and official brand-site label rows; each row carries `data_origin`, `data_origin_id`, `data_origin_url`, `data_origin_priority`, optional `serving_grams`, and a `canonical_key` used to dedupe alternate records for the same label/product at query time. `data_origin` is the source type, such as `usda_branded`, `dsld`, `dailymed`, or `brand_site`, not a brand name. Query results use source-qualified ids such as `fdc:<id>`, `dailymed:<id>`, or `blueprint:<handle>` when a source prefix is needed, while API payloads expose provenance through `dataOrigin` and `dataOriginId` and include the stored source label JSON for search and exact lookup results. Product contaminant observations from sources such as PlasticList, NYC DOHMH, King County, and Pure Earth live in `product_tests`, with concentration limits and broad screening guidance in `contaminant_thresholds`; source-only observations keep source product identity without creating label rows, and label responses attach contaminant summaries only for rows linked to the exact selected `food_id` or `supplement_id`, including bounded raw observations plus threshold-exceedance alerts where comparable. Daily-exposure guidance can be scored at read time from the selected label's `serving_grams`, but the lookup layer never infers contaminants from names, brands, ingredients, tags, categories, or fuzzy matches. Hosted runtime callers reach label lookup through the fixed internal `murph-data-api.worker` host; `apps/cloudflare` injects the data API key during allowed `/api/foods` and `/api/supplements` `GET` egress and bounded batch-search `POST` egress, and `packages/cli` exposes those paths through `food search-labels`, `food search-labels-batch`, `supplement search-labels`, and `supplement search-labels-batch` without local key access.

The public projection of that database is Murph Safe at `/search` and the
read-only Murph Product Data API under `/api/public/v1`. Wire contracts belong
to `@murphai/contracts`; one web-owned service maps bounded database records to
those contracts. Browser search posts to the public route, while the
server-rendered detail page calls the same service directly. The public catalog
excludes generic food origins, never returns raw labels wholesale, and links
tests only by the selected row's exact foreign key. Public search uses bounded
SQL candidate sets; detail reads cap stored label transfer and aggregate DTO
size. One Vercel-aware singleton pool is shared by public and private label
readers. Vercel custom firewall rules sit in front of public search and detail,
and the production build verifies their exact active configuration.

Each product-test observation may preserve evidence and sampling context,
sample or lot identity, result bounds and qualifiers, analytical limits, and
the raw reported product identifier. Only checksum-valid GTINs enter the
canonical UPC field. Private label lookup and the bounded public product-detail
contract expose the same additive metadata so a regulatory finding or sampled
package is not presented as a timeless product claim. One-time acquisition,
reconciliation, and remap tooling is operational research rather than deployed
application code.

## Trust Boundaries

- Canonical vault storage is file-native under the vault root.
- Human-facing truth lives in Markdown documents such as `CORE.md`, journal pages, and experiment pages.
- Canonical markdown writes now reduce to one shared `packages/core` document seam with three target shapes only: singleton documents (for example `CORE.md` and `bank/memory.md`), slugged documents (for example `bank/automations/*.md`, `bank/experiments/*.md`, and registry-backed bank records), and dated documents (for example `journal/YYYY/YYYY-MM-DD.md`). Typed singleton JSON documents such as `bank/preferences.json` remain canonical too, but they stay out of the markdown seam on purpose.
- Experiment storage is a closed ownership boundary: direct `bank/experiments/<slug>.md` files are the only canonical experiment documents, direct `bank/experiments/outcomes/*.json` is the only reserved machine-output lane, and query/assistant readers do not recurse beneath the experiment bank. Durable experiment media belongs to capture-owned `raw/captures/**`. The explicit dry-run-first repair accepts a supported legacy media file only when its boundary-safe, byte-exact full `bank/experiments/...` path appears in exactly one direct canonical experiment document. Basenames, relative or encoded paths, substrings, case or Unicode normalization variants, and multiple-document owners do not qualify; any residual alternate spelling blocks apply. The repair copies and verifies each candidate through the capture owner, replaces only those proved full-path literals with the canonical capture path, then atomically quarantines and verifies both the inspected note bytes and legacy media bytes before replacement or deletion. Concurrent edits, unsupported files, or incomplete proof leave the legacy source in place.
- Canonical mutation concurrency is resource-scoped. Core mutations must acquire the exact canonical file resources they intend to read or rewrite before any read-modify-write work starts, hold those locks through commit or rollback, and only fall back to the coarse vault-wide canonical write lock for legacy or unclassified flows. Disjoint exact-path writes may proceed concurrently, while any shared singleton file or shared monthly JSONL shard remains an intentional serialization point until its storage shape changes.
- Machine-facing truth lives in append-only JSONL ledgers for inbox captures, events, display-grade metric samples, explicit raw/debug samples, and audit records, with inbox capture intake canonicalized first through `ledger/inbox-captures/**`. Device observation events distinguish raw sample, compact summary, and derived-fact grain so dense telemetry admission does not depend on default query/search visibility.
- Raw imported artifacts are immutable once copied into `raw/`, and they now live under owner-scoped directories derived from the owning canonical record or import session (`kind` + `id`, plus a partition only for batch families such as device/sample/workout imports). Dated media captures use the same owner-scoped raw path under `raw/captures/**` while staying durable as tagged note events rather than a separate medical record family. Each raw import directory keeps a `manifest.json` sidecar that records the same explicit owner metadata used to resolve the on-disk path, while normalized device/provider API snapshots continue to live under `raw/integrations/**`. Lookup-backed generated-image captures may also write a portable retry lookup in the compact index at `derived/captures/generated-image-lookups.json`; those capture events are immutable after creation except for `deleteEvent`, so the lookup can resolve the original event shard and raw media without scanning while still treating a tombstone as deleted. `raw/inbox/**` media bytes are the scoped privacy exception: image/audio/video bytes can be retention-expired after 14 days by an append-only retention ledger, while documents/PDFs and explicit promoted owner paths remain durable.
- Raw-artifact repair helpers must stay explicit and proof-driven. `packages/core` keeps tested wearable storage repair primitives that may compact legacy payload-bearing wearable receipts, tombstone derived canonical-record artifacts, report legacy dense sample-debug ledger candidates without deleting them in v1, and tombstone dense raw provider timeseries only when an operator explicitly asks for dense raw pruning or the hosted device-sync runtime runs its bounded post-drain retention step. Each repair must prove manifest byte/sha state, preserve durable product facts, update raw manifests when raw tombstones are written, and emit metadata-only `vault_repair` audit entries; the hosted path must use the named core dense-prune primitive with recent dense raw excluded, bounded file/byte budgets, and metadata-only runtime logs. There is no separate hosted cron, generic raw delete API, or content-addressed raw store for this repair lane.
- Wearable provider timeseries should not be retained as full provider sample arrays by default. Product, assistant, and CLI wearable summaries consume compact summary observations, derived facts, or display-grade metric samples; any timeseries-derived product fact must come from an explicit importer/projector step that reduces provider samples in memory and persists only compact evidence. Dense raw retention remains a legacy/debug cleanup lane for already-written high-volume timeseries roles; sparse or higher-sensitivity resources such as weight and glucose need a separate product/debug policy before any default ingestion or pruning.
- Audio/video transcript outputs under `derived/inbox/**` are rebuildable and never canonical health facts, but their parser manifests may be retained as derivatives after raw inbox audio/video bytes expire. PDFs, documents, CSVs, and other inspectable files stay as raw inbox paths for the assistant and tools unless a user or importer explicitly creates durable promoted artifacts.
- `bank/library/**` is the stable health reference layer for durable shared entities such as biomarkers, domains, protocol variants, and source artifacts.
- Model-authored compiled knowledge pages under `derived/knowledge/**` are the separate non-canonical, rebuildable personal wiki layer that synthesizes local vault evidence and saved research notes without becoming a second source of truth. `derived/knowledge/index.md` is the content catalog, `derived/knowledge/log.md` is the append-only write log, and `derived/knowledge/pages/*.md` stores the assistant-authored pages themselves.
- Inbox runtime state is split between a rebuildable local projection under `.runtime/projections/inboxd.sqlite` and durable daemon/config JSON state under `.runtime/operations/inbox/*.json`; the projection remains rebuildable from canonical inbox capture records, raw inbox envelopes, and inbox attachment retention records.
- AgentMail inbox ids, outbound email thread bindings, and channel credentials remain non-canonical local/runtime concerns; AgentMail API keys stay in operator environment variables and never belong in the vault.
- Query runtime state is local-only under `.runtime/projections/query.sqlite`, is rebuildable from canonical query-visible vault evidence, and remains strictly read-only relative to canonical writes. Dense provider telemetry does not enter the default query/read/browser/assistant model: generic `ledger/samples/**` shards are explicit import/debug ledgers, `readVault()` and `readVaultTolerant()` materialize sparse canonical product records plus display-grade `ledger/metric-samples/**`, and browser-vault metrics come from compact `query_metric_points` rows rather than hydrated sample entities. Dense metric rows remain lookback-bounded, while sparse lab history uses a dedicated all-history browser projection derived only from collapsed live canonical test events; it preserves structured result facts needed for measured-biomarker history without adding raw reports, notes, raw references, or external identifiers to the browser replica. `readVaultRawTolerant()` is the explicit repair/debug source hydration path and bypasses default projection filtering. In `readVault()`, `family: "sample"` means display-grade `kind: "metric_sample"` product facts only; it must not be used as a signal that generic raw sample telemetry is back in the default read model.
- Durable local runtime state is split explicitly: `.runtime/operations/**` holds non-canonical operational state, `.runtime/projections/**` holds rebuildable indexes/projections, and `.runtime/cache/**` plus `.runtime/tmp/**` stay ephemeral. Canonical vault evolution is a separate seam in `packages/core`: `vault.json`, `CORE.md`, and any future canonical record-shape changes stay there, and non-current `formatVersion` values fail closed while `.runtime/projections/**` stores remain rebuildable and never carry canonical migration authority. `vault.json` itself stays minimal and instance-owned: it stores only `formatVersion`, `vaultId`, `title`, `timezone`, and `createdAt`, while layout paths, shard patterns, and id-prefix policy remain code-owned runtime contract details. Portability is a second explicit axis on top of that taxonomy: runtime paths are either `portable` or `machine_local`, and operational state defaults to `machine_local` unless a more specific classification says otherwise. Device sync runtime state is machine-local under `.runtime/operations/device-sync/state.sqlite`, and Murph's daemon launcher state/logs plus separate private managed control-token and encryption-secret files live under `.runtime/operations/device-sync/`; the control bearer may rotate with daemon lifecycle, while the encryption secret is stable for stored OAuth credential decrypt. Encrypted provider tokens, OAuth sessions, and webhook/reconcile cursors never belong in the canonical vault. Portable operational examples include canonical write-operation receipts and inbox promotion ledgers that must move with the vault's recovery/idempotency context. In the hosted lane, `apps/web` Postgres is the canonical owner of hosted member identity, routing, billing, email authorization, legal consent events/grants, device-sync authority, the hosted AI usage ledger, usage-credit purchases and append-only entries plus their bounded member projection, the anonymized hosted assistant-runtime issue table, hosted product-feedback rows, encrypted hosted mailbox rows, hosted workspace checkpoint metadata, hosted computer-use profile/run/handoff state, and redacted hosted runtime logs/status. Cloudflare may use narrow signed web callbacks for execution-time device-sync snapshots, computer-use commands, and product-feedback recording, but it is not a second product control plane or a durable device-sync/browser mirror. Hosted onboarding billing refs, legal consent rows, queued Stripe receipts, webhook receipts, mailbox rows, workspace checkpoint metadata, hosted computer-use rows, hosted AI usage rows, usage-credit purchases and entries, hosted product-feedback rows, and anonymized assistant-runtime issue rows in Postgres are operational or idempotency state only, not canonical health truth. Mailbox import watermarks, assistant channel enablement state, outbox truth, turn revision, and runtime timers live inside the encrypted hosted workspace checkpoint owned by the restored local runtime, not in web-visible run rows.
- Local assistant runtime state is non-canonical under `vault/.runtime/operations/assistant/**`, including sessions, transcripts, outbox/receipt artifacts, diagnostics, status, and other execution residue. Durable user-facing memory, typed preferences, compiled wiki pages, and scheduled prompt configuration do not live in assistant runtime state; they live under `bank/memory.md`, `bank/preferences.json`, `derived/knowledge/**`, and `bank/automations/*.md`. The canonical preferences singleton owns stable user intent such as workout unit defaults and desired wearable providers. The hosted mailbox owner serializes one immutable per-member causal sequence across conversation and system lanes at append; preference work carries that sequence through local pending or accepted-input state, while the bounded canonical companion `bank/assistant-preference-mutations.json` retains only each sparse field's last-applied sequence. The preference value document stays strict and contains no runtime mutation metadata. An older or equal event terminally no-ops only its stale fields while non-stale siblings apply, so post-commit replay needs no event receipt, reservation lifecycle, or capacity policy. Conversational commands from one accepted turn may apply at the same sequence in command order. Tokenless legacy pending work is sequence zero: it drains, but cannot overwrite a field already touched by any legacy conversational or sequenced mutation. The web projection and wall-clock timestamps never decide this order. The canonical assistant-input selector admits a bounded, cursor-ordered compound batch from one conversation and one provider-native reply anchor only when each positive mailbox causal sequence is the exact successor of the previous one. Foreground starts at the oldest fresh input in the current wake and never pulls older pending backlog ahead of it; background starts at the oldest replyable pending input. Any boundary change, sequence gap, legacy sequence-zero input, or 50-input bound ends the batch and leaves the remainder pending. For web-owned tone/voice updates and local `murph.assistant_style` commands, the runtime forwards the terminal provider-accepted input id from that validated batch; web resolves its live member-owned conversation row and derives the causal sequence. Exact-successor proof prevents the terminal input from crossing an intervening Settings mutation. Actual wearable OAuth/account/runtime state remains device-sync-owned operational state. Session persistence stores one canonical Codex App Server assistant target plus separate resume-state metadata rather than duplicating provider config across multiple runtime records, and turn execution resolves boundary defaults, persisted session target, and per-turn overrides through one explicit execution-plan seam before Codex request shaping. Provider-native resume state is the continuity authority when present: onboarding/bootstrap overlays must not clear a valid provider resume handle, and flat-prompt native-resume providers such as Codex receive Murph's system/bootstrap instructions only on bootstrap turns rather than as repeated resumed-turn user content. Active same-conversation input otherwise follows one lifecycle: the initial hosted mailbox compound batch is frozen against broad rediscovery before Codex starts, but an exact staged input notification may join the live Codex turn when it is the next positive causal-sequence successor and preserves the conversation, delivery route, native reply anchor, account/audience, and group actor. A projection-pending input is a causal barrier until the existing projection-completion notification retries it; terminal projection failure remains replyable through the normal fallback. Duplicate staging and projection-completion notifications at or behind the newest queued or committed frontier are ignored before successor proof. After the provider acknowledges `turn/steer`, Murph journals and checkpoints the accepted live input before any hosted tool effect or final delivery may proceed; any missing input, gap, boundary change, or missed live window remains pending for a normal later turn. Final-delivery and hosted-tool effect keys use the newest accepted causal input as their stable anchor while answered-mailbox evidence retains the full set. Input with a strict active-turn target fails closed when that target is no longer live, and Murph does not replay a completed provider response by synthesizing another provider request inside the same assistant turn. Murph may replay recent raw transcript turns plus bounded sanitized tool/provider audit entries during bootstrap or fallback continuity, and rely on provider-native resume or compaction for continuity, but that runtime context still must never be treated as canonical health memory or vault truth.
- Assistant-generated one-time delivery staging has one flat runtime-owned ref shape: `.runtime/operations/assistant/generated-deliveries/<filename>`. The assistant may create and adopt a direct single-link regular file there only when the same turn establishes the delivery obligation and calls `send_vault_file` with a semantic provider call id; generated-file calls run on the existing serialized dynamic-tool chain, and missing call identity fails before adoption. Runtime parents are tightened to `0700`, the file to `0600`, and the friendly source is transferred to its deterministic owned ref with atomic no-clobber link/unlink plus exact interrupted-link recovery. This non-canonical private residue is included in encrypted hosted checkpoints while an exact filename/type/size/SHA-256 descriptor is active and is omitted from portable support bundles with the rest of `.runtime/**`. Quiescent pre-checkpoint cleanup first validates the complete flat inventory and outbox state, then removes only terminal, changed, or orphaned owned files; an orphan hardlink removes only its runtime link, while an active hardlink, nesting, unsafe names, symlinks, special entries, or untrusted live inventory fail closed. `exports/assistant-deliveries/**` remains ordinary vault data and receives no ownership, deletion, or packaging-exclusion semantics. The reader-compatible phase-one release is the rollback floor while any persisted outbox or checkpoint can contain the runtime ref.
- Hosted `murph.assistant_style` resolves the selected turn's Humor, Push,
  Detail, and conversational-only Unhinged sequence at mutation time through the signed Web personalization port.
  Web binds the terminal provider-accepted input id from the validated compound
  batch to the callback member and its live mailbox row; persisted assistant-input
  files are never numeric authority. Missing or ambiguous authority fails the
  hosted write closed without blocking the ordinary reply.
- Storage-policy hard line: if a datum is user-facing, queryable, or something future product features will build on, it belongs in canonical vault records or explicit derived materializations, not in assistant runtime. `vault/.runtime/operations/assistant/**` is for execution residue, replay/continuity artifacts, and operator diagnostics only.
- The hosted gateway plane is a derived operational model over inbox captures, assistant bindings, sent outbox deliveries, and approval state. Hosted Durable Objects may materialize hot gateway projections and short-retained event logs for transport-facing reads, but those projections are never canonical health truth and must remain rebuildable from canonical vault evidence plus non-canonical runtime state. There is no local gateway projection/control surface; assistantd stays focused on local assistant control.
- Hosted execution state for `apps/cloudflare` stores encrypted hosted workspace checkpoint refs plus legacy encrypted artifact objects, runner-secret blobs, and per-user coordination metadata. The live v2 snapshot ref is a direct R2 presigned PUT, single-object encrypted `tar.zst`; the Worker only handles JSON start/complete metadata and never receives the snapshot body. Legacy full/base workspace bundles and legacy layered `{base, hot}` or working `{base, delta}` refs remain restoreable during migration, but production foreground execution no longer creates layered or working checkpoint refs and v2 snapshot production does not create artifact sidecars. The v2 direct-R2 workspace snapshot includes canonical `vault/**`, durable operational runtime continuity under `vault/.runtime/operations/**` except explicit unsafe/process-local exclusions, the hosted operator-home directory marker, and only the Codex rollout JSONL files under `.codex-hosted/sessions/YYYY/MM/DD/` that are explicitly referenced by live assistant session resume state with no separate continuity manifest. They do not persist the operator config file; hosted assistant defaults are recreated from trusted platform runtime env after restore so executable assistant selectors cannot be carried forward by workspace snapshots. Hosted Codex config may enable Codex-native memories for operator context during maintenance/root sessions, but generated Codex memory artifacts are not product truth and remain outside the broad checkpoint surface unless an explicit allowlist/inventory is added. Foreground assistant turns do not publish a separate Codex continuity artifact or snapshot pointer; provider-native continuity is durable only through the normal idle workspace snapshot path. Live correctness barriers, including `system_mailbox_receipt`, `assistant_runtime_commit`, `provider_cleanup`, outbox, mailbox import, and active-turn checkpoints, stage local runtime state and terminal evidence without publishing hosted workspace snapshots. `canonical_runtime_commit` uploads exact hosted canonical write receipts to supervisor-owned artifacts and publishes a bounded receipt-log ref through a status-only workspace checkpoint that retains the prior snapshot ref. Restore replays those receipts over the prior snapshot and marks affected context domains dirty; the next idle snapshot becomes authoritative and omits the receipt-log status. `packages/core` `WriteBatch` is the canonical mutation contract for vault writes and emits the exact hosted canonical write receipts. `idle_shutdown` is the only live hosted workspace snapshot producer; its abortable maintenance first replaces valid closed raw integration-ingest months with verified deterministic gzip without changing the one-file-per-month shape, then the v2 snapshot path checks the runtime write fence before direct R2 upload so stale invocations abort before upload. Restore repairs only an exact independently valid raw/gzip interruption residue before foreground work and fails closed on every non-identical closed pair. Excluded local runtime state includes assistant JSONL event logs, device-sync control/token stores, parser executable-selector config, rebuildable local projections under `vault/.runtime/projections/**`, ephemeral cache/tmp state, secrets, quarantine/repair payloads, locks, pid/socket files, operator config, arbitrary Codex auth/credential/cache/tmp/log/history/key/cert/socket/lock files, Codex prompt-history files, Codex SQLite metadata, unreferenced Codex sessions, archived Codex sessions, and local incur CLI defaults. Hosted snapshots keep assistant diagnostics snapshots, status snapshots, runtime budgets, and pending anonymized issue records for continuity while leaving append-only event logs local; routine diagnostic info events are not mirrored into runtime events, and warning/error diagnostics stay in the small recent diagnostics snapshot tail. Hosted Codex continuity diagnostics are derived from assistant session resume state and may expose only counts, byte totals, and keyed hashed rollout-relative names when the hosted log fingerprint secret is configured; they must not expose raw Codex home paths, filenames, prompts, or credentials. Restore sanitizes native Codex resume metadata when the referenced rollout file is absent, does not match the saved Codex thread id, or is not a regular file under `.codex-hosted`, then prunes restored `.codex-hosted` contents back to surviving session-referenced rollout files. Large raw files under `vault/raw/**` are inside the encrypted v2 tar.zst instead of separate artifact refs. Browser-vault snapshots are a separate encrypted hosted sidecar for dashboard use only and now contain a typed dashboard projection bundle rather than a hosted clone of canonical vault entities or a generic read-model payload; workspace checkpoints do not write browser-vault replica refs. Web-owned Postgres stores signed wrapped hosted domain-root envelopes in `hosted_user_crypto_envelope` plus append-only `hosted_user_crypto_audit` rows; plaintext root keys are never stored, web wraps use GCP KMS AAD, authority signatures are verified before use, and the signed worker crypto-context callback returns only ingress/runtime envelopes for Cloudflare's P-256 recipient unwrap. The worker-facing HTTP surface is intentionally narrow: signed Temporal `POST /internal/users/:userId/runtime/ensure-processing`, Vercel OIDC-authenticated browser-vault session, user-data deletion, status, and web-owned Telegram usage-limit notice routes, plus the signed deploy-smoke callback and public `GET /` / `GET /health`. The per-user Durable Object keeps only execution coordination and other opaque runtime metadata in SQLite rather than a canonical queue-history model; the web-owned hosted workspace pointer is the latest checkpoint fence and any Cloudflare bundle cache stays process-memory only. There is no staged dispatch-payload control plane or CRUD seam anymore. Execution-time web callbacks are narrow and signed: the runtime may fetch mailbox rows, fetch signed ingress/runtime crypto context, read/checkpoint hosted workspace state, write redacted runtime logs/status, start a device connect-link, fetch/apply/ack hosted device-sync runtime authority including dirty-pending and dirty-ack state, record bounded hosted product feedback, record hosted Codex auth state, or record hosted usage directly into web-owned Postgres. Temporal owns accepted message-webhook, Cloudflare Email ingress, due-reconcile device-sync scheduled wakes, billing/manual, and browser-vault execution wake orchestration by pointer-only signal after the owning web mutation commits; Vercel Workflow may retry Stripe webhook reconciliation by Stripe event id after local signature verification and receipt recording, but it is not the hosted runtime wake scheduler. Device-sync webhook freshness is dirty-state owned: web persists trace/audit plus per-connection dirty state, appends one bounded `device-sync.wake` mailbox handoff on clean-to-dirty transitions, and completes trace acceptance in the same transaction. The runner pulls and acks dirty rows through signed callbacks. Temporal owns the global device-sync due-reconcile cadence by starting a short-lived reconciler workflow that calls a signed web scheduled wake sweep; that web command reads canonical due-reconcile facts, records due-reconcile wake markers, appends bounded `device-sync.wake` mailbox handoffs, and returns count-only summaries to Temporal. Dirty/stuck rows may be included only when they are due-reconcile candidates; dirty state remains the durable work source, not a separate scheduler queue. Temporal signal failures after post-commit clean-to-dirty webhook handoff are logged instead of failing provider ingress; there is no Vercel mailbox-lag cron or dirty-sweeper backstop, and a DB-backed pending handoff table remains future hardening for exact workflow-start failure journaling. Missing managed crypto now fails closed outside the explicit activation-time provisioning path, and ciphertext envelopes still decrypt by envelope `keyId` through the configured keyring.
- Browser-vault replica refresh is normal hosted runtime work, not a detached container side path. Web owns browser-session freshness backstops for missing, unreadable, age-expired, generation-mismatched, or client-known-outdated replica refs and represents refreshes as low-priority system-mailbox runtime work after the browser response; source-hash freshness belongs to the assistant runtime because it can restore and hash canonical query sources. The shared browser-replica contract owns one current projection generation carried by both the encrypted payload and its published ref. Missing or mismatched generations remain readable for deploy compatibility but are always stale; any projection-shape or interpretation change that makes old sidecars incomplete must bump the shared generation instead of adding route-specific checks. Cloudflare stays a thin runner. The assistant runtime builds the replica from the restored `vaultRoot`, uses a stable canonical query-source hash that excludes mtimes and runtime paths, checks the hash again before publish, and may publish an empty current replica when query-visible content was deleted. Replica writes must use the runtime browser-vault store under the active write fence, and the old container `/internal/browser-vault-refresh` path is removed; deploy-skew callers receive an explicit removed response instead of executing a half-removed write path. Browser-vault replica writes remain capped at 50 MiB; oversized or wake-interrupted refreshes degrade without blocking foreground assistant work, outbox delivery, runtime-owned idle checkpoints, or runner alarms. Web and Worker/runner skew stays fail-soft by serving readable stale replicas, while generation-bump deploys converge Worker and warm containers immediately so retries publish the current marker.
- Any inbox-to-canonical promotion idempotency must be stored in or derivable from canonical vault evidence, not `.runtime/` alone.
- General assistant/session state belongs under `vault/.runtime/operations/assistant/**`, including local transcript files, per-turn decision receipts, replay-safe outbound intent journals, pending anonymized assistant-runtime issue records, bounded local diagnostics/runtime event logs, diagnostics snapshot counters and recent warnings, persisted assistant status snapshots, and runtime automation execution state plus run history. Hosted assistant provider usage, including the requested and served model reported by Codex App Server, is recorded directly through the hosted runtime platform into the web-owned usage ledger instead of becoming assistant runtime state. Durable user-facing memory belongs canonically in `bank/memory.md`, typed preferences such as workout unit defaults and desired wearable providers belong canonically in `bank/preferences.json`, and durable scheduled prompt configuration belongs canonically in `bank/automations/*.md`; capture-scoped rebuildable audit artifacts stay under `derived/inbox/**`, while durable compiled knowledge dossiers live under `derived/knowledge/**`.
- Assistant tone, voice, and personality values remain canonical in the active runtime's `bank/preferences.json`: a person vault configures that private Murph, while a synthetic thread-container vault configures the room Murph. Nullable `HostedMember` assistant-style columns are the authenticated web mutation projection; only person-member rows feed personal Settings. Web emits strict sparse `member.preferences.updated` deltas, and the hosted system mailbox applies every delta in mailbox order; preference events are never latest-wins snapshots, and an older retry blocks newer deltas so sibling settings cannot be lost. The scheduled preference-handoff backstop selects active people and active synthetic rooms through the same owner-or-current-participant access derivation before its bounded limit, then rechecks canonical runtime access before signaling.
- Assistant input follows one spine for local and hosted execution: source adapter -> `AssistantInputEvent` -> `AssistantInputSource` -> scanner/active turn -> accepted-input journal -> Codex. Source adapters may project accepted input into inbox for search, attachments, UI, and diagnostics, but inbox projection success is not the gate that decides whether Codex can see a decoded conversation message. `AssistantInputEvent` may carry bounded prompt-readiness facts such as attachment descriptors and minimized channel source metadata; prompt construction must read those first and use inbox capture/envelope data only as projection enrichment.
- Provider transcript history and channel-native delivery history should stay with upstream adapters when possible; Murph stores local assistant transcript copies, minimal manual aliases, explicit conversation bindings, fixed auto-reply channel enablement state, timestamps/turn counts, provider session references, runtime automation run history, compact system-emitted turn receipts, idempotent outbound intent state, diagnostics counters/warnings, and persisted status snapshots under `vault/.runtime/operations/assistant/**`. Assistant runtime directories must stay private (`0700`) and assistant runtime files must stay private (`0600`). Secret-bearing provider headers for persisted sessions live only in private sidecars under `vault/.runtime/operations/assistant/secrets/**`; the general session JSON keeps only public headers, diagnostics/runtime-event writes redact inline secret material before persistence, and `assistant doctor --repair` can tighten permissive assistant runtime modes in place. Inline secret findings indicate stale local session data rather than a supported migration path. Fresh sessions may inject a small canonical memory block from `bank/memory.md`, and assistant turns now use one shared CLI-first Murph runtime surface plus a small helper-tool layer across manual and message-triggered automation turns. Codex App Server is the hard-cut assistant adapter: it reaches the canonical `vault-cli` surface through native local CLI/filesystem/env authority, defaults to unsandboxed execution plus no approval friction, and is trusted as a local operator path. Assistant-engine keeps one Codex App Server process warm across ordinary turns for the warm container or Node-process lifetime; each ordinary turn is an RPC into that process. Prompts, session/thread/turn ids, delivery routes, and invocation-scoped automation or device authority stay in request data rather than process launch identity. Those capabilities are exposed only through narrow typed tools on the current root turn and are absent from the App Server and descendant shell environments. Process replacement is limited to owner shutdown, process exit, proven unhealthy or poisoned protocol state, explicit operator shutdown, explicit workspace invocation abort/preemption, or a genuine process-level configuration change that Codex cannot accept through RPC. An explicit abort synchronously stops the exact owned App Server before the container job slot can be reused; ordinary turn and invocation completion do not. Codex App Server owns provider-native web-search behavior; Murph normalizes Codex `web.search` events into assistant trace and status output without carrying a separate Murph-side search provider or web-read tool layer. Accepted inbound channel messages are therefore treated as operator-authorized actions for the bound vault and may use the assistant runtime, canonical `memory`, canonical `automation`, self-target, and vault query/write surface. Murph owns transcript policy, turn orchestration, and tool/runtime planning, while canonical vault records remain authoritative on conflicts.
Assistant-engine intentionally keeps one Codex App Server slot warm across
ordinary turns during each warm Node runtime/container lifetime. Overlapping
turns fail busy instead of spawning parallel app-server processes. Owner
shutdown may stop an idle process; active turns must first use the turn
interrupt/abort path. The warm process is spawned from a stable temp directory,
never the workspace path:
hosted restores delete and recreate the workspace between invocations, so an
app-server anchored there would hold a dead cwd inode and fail its next
thread-start config load. Threads receive the current workspace through the
explicit per-thread `cwd` param instead.

Detached MultiAgent V2 work is a bounded path, not a process-memory queue.
Before the root reply, Murph retains a durable accepted input, canonical fact,
or raw source and gives each child its exact source words, ids, or refs. A
loaded skill may assign one independent canonical record family per child; all
writes remain idempotently attributable to that source. Work that needs a
user-facing result in the current reply remains in the root turn. A child
terminal event is only an advisory lifecycle receipt, so canonical readback
confirms a write before Murph reports it as finished.

Hosted configuration admits one root plus at most three concurrent children
per session. Each child is a one-shot leaf with one bounded family: no
interaction with the root or another child, reuse, nested spawn, or background
terminal is allowed. Root completion and later ordinary turns leave valid
detached work alone. Before publishing a workspace snapshot, the runtime waits
for every exact resident child and checks every touched root and child for
background terminals. The lifecycle owner retains the full child set for each
root until that boundary clears, so one sibling's completion cannot evict
another. A routine checkpoint wake only interrupts that boundary wait and
leaves the App Server plus all resident evidence warm. A timeout or unsupported
lifecycle stops the exact process and fails the boundary closed. Explicit
workspace invocation abort/preemption also interrupts the wait and
synchronously stops the exact process before workspace or job-slot ownership
can be reused.

- Low hosted usage is not a proactive message. Web's existing mailbox allowance check projects an optional coarse low-capacity bit for an allowed conversation batch; the runtime binds it to the accepted input sidecar, and assistant turn context asks Murph to mention it naturally after answering the current request. No balance, price, contributor, or internal accounting reaches the runtime. The hosted developer-policy addition changes the stable assistant contract: every existing native-resume hosted conversation starts one new provider thread on its first turn after deployment, using the existing bounded committed-transcript fallback, and later turns resume that new thread. Exhaustion remains a deterministic notice because denied input cannot start a model turn. Its target is derived after the foreground checkpoint from durable provider-accepted assistant input events: direct Linq and Telegram inputs retain their exact origin; group Linq inputs additionally require exact external-thread route authority. Every accepted input must resolve to the same route, the newest accepted message supplies the reply target, and missing, mixed, or invalid provenance fails closed. The runtime does not keep a parallel mailbox route projection, and a thread-container crossing never falls back to a member home route.

## Control Flow

1. Operators, automations, and future agent layers call `vault-cli` or package APIs.
2. CLI commands stay thin, validate input, and delegate vault/query/importer orchestration through `@murphai/vault-usecases` service/usecase modules that compose `packages/core`, `packages/importers`, and `packages/query`; inbox and parser flows continue through their owning packages. Canonical mutation flows for experiments, journal pages, providers, events, vault summary updates, and inbox journal/experiment-note promotions must route through typed `packages/core` mutation ports; CLI may keep command UI, device-daemon composition, and read-side lookup/orchestration, but it must not parse/stringify canonical frontmatter or assemble canonical write batches for those write paths.
3. Inbox capture appends the typed `ledger/inbox-captures` fact as the sole canonical intake metadata record, persists only needed raw attachment bytes from Telegram, Linq webhook chats, and AgentMail email connectors, indexes attachments, and enqueues audio/video transcription jobs in rebuildable local runtime state. PDFs, documents, CSVs, images, and other inspectable files are handed to the assistant through raw inbox paths and metadata while those bytes are available; expired raw inbox media projects as `retention_expired` with descriptors, hashes, message relationships, and retained parser derivatives preserved. Generic event/audit projections happen later only when a promotion or user-visible flow needs them.
4. Parser workers or parsed-pipeline wrappers consume only those media transcription jobs and publish one rebuildable, versioned result bundle per attempt.
5. Attachment prompt bundling can materialize a normalized capture bundle and image-routing eligibility metadata as rebuildable audit artifacts; live model routing/apply is removed/disabled for this hard cut.
6. Importers may parse and normalize external inputs but must never write canonical vault files directly. Provider connectors normalize upstream payloads into shared device-batch payloads and still rely on `packages/core` for canonical persistence.
7. `packages/device-syncd` owns provider OAuth state, reconnect/disconnect control, scheduled device backfills, and optional webhook fan-in; its control routes must stay loopback-only plus bearer-authenticated, any public callback/webhook ingress should stay isolated from `/accounts/*` and `/providers/*`, polling-first providers remain first-class citizens, provider credentials stay outside the vault, per-account jobs should be serialized to avoid rotating-refresh-token races, and canonical health writes still flow through `packages/importers` and `packages/core`. Provider timeseries sync must stay product-needed, bounded by resource/day windows or cursors, and avoid volatile `now`-shaped snapshots for routine scheduled imports; dense/raw-only streams should be treated as freshness hints or explicit debug imports rather than default vault storage. Its provider-agnostic public OAuth/webhook handling should live in a reusable shared ingress layer so future hosted control planes and local tunnel setups do not fork provider callback logic, while provider-owned modules keep webhook preflight/admin specifics and any provider-specific secrets off generic ingress/env types. Hosted runner startup may read only the boot-safe provider config projection; full provider manifests, importer adapters, and SDK clients stay outside the runner's static boot closure, enforced by the device-sync package's static source-graph test and the final runner-bundle metafile guard. `packages/cli` may start, reuse, and stop that daemon for the active vault, but it should treat the localhost HTTP control plane as the stable boundary rather than reaching through to provider state in-process.
8. Codex App Server-backed assistant chat and outbound channel flows may persist local session metadata, local transcript files, explicit delivery bindings, auto-reply channel state, terminal auto-reply handling evidence, runtime automation execution state, accepted-input journal entries, and derived gateway conversation/message/event projections under `vault/.runtime/operations/assistant/**`, but they must not treat that state as canonical health truth or bypass canonical write boundaries for health data. Durable user-facing memory and scheduled prompt configuration belong in canonical vault records, not assistant runtime. Saved assistant session bindings are monotonic routing facts: lookup may enrich missing channel, identity, participant, or thread fields, but it must fail closed rather than silently rebinding an existing session to a different audience; conversation continuity keys therefore isolate direct, group, and indeterminate audiences even when the provider thread identifier is unchanged. During the audience-key rollout, the store alone recognizes the prior key format: positively direct Telegram sessions migrate in place, while legacy email or Linq sessions whose transcript audience cannot be proved are explicitly reset and their legacy lookup key is retired without deleting the old session record. The first production deploy that can write an `audience:` key must use immediate container rollout and prove the deployed runner-bundle fingerprint before processing user turns; after the first audience-scoped key is written, that bundle is the hard rollback floor because an older resolver can recombine direct and group history. This compatibility path is removable only after old runner bundles have drained and the assistant index contains zero keys without an `audience:` segment. One-off outbound retargeting belongs on the explicit delivery-target override path instead of mutating the saved binding. The local `packages/assistantd` daemon is now an allowed loopback-only bearer-authenticated control boundary for this runtime, but it stays bound to one vault and does not become a second canonical write owner. Current outbound adapters include Telegram, Linq, and AgentMail-backed email; email auto-reply is intentionally limited to positively classified direct threads or signed hosted group routes that resolve to a current grantor and must preserve the inbound AgentMail inbox identity for replies, while Linq replies reuse the inbound chat id thread binding for the local webhook-driven conversation. A signed hosted group email route is not authenticated sender proof and cannot expose private assistant style settings. Generated voice memos are modeled as assistant response media that stores only bounded ElevenLabs transcript/config metadata plus a channel transport reference: Linq attachment ids for pre-uploaded native iMessage voice memos, or Telegram delivery-time generation descriptors for native Telegram voice messages. Raw generated audio bytes are never persisted in Murph runtime state. Assistant automation admits channel input through `AssistantInputSource` and writes terminal reply/deferred/suppression evidence after accepted input is committed; inbox capture remains useful projection evidence but is not the Codex-admission gate. Hosted mailbox imported watermarks prove import only, so a Cloudflare deploy, Durable Object reset, or runner restart after import checkpointing must still replay assistant handling from assistant input plus any available raw capture evidence until terminal auto-reply evidence exists. Once conversation work is terminal locally, the runtime retains its pending-index entry and may publish the exact mapped mailbox item id only with an `idle_shutdown` checkpoint whose snapshot contains that terminal evidence or durable reply intent. In the same successful snapshot transaction, Web stamps only those same-user imported conversation rows and derives the largest contiguous stamped replay floor; a gap therefore stops `consumed_seq` even when a later item is terminal. A later server floor lets the runtime remove the retained local entry without scheduling another reply. Accepted Linq delivery additionally writes the same exact row stamp before checkpoint to close its delivery-to-checkpoint replay window, while Telegram and terminal no-reply paths receive their exact stamp at idle checkpoint. Deployed v1 pending indexes preserve their recorded IDs and recover omitted retained events only when terminal evidence already proves completion; v1-omitted nonterminal history is ambiguous and stays categorically nonreplyable. The first accepted v2 snapshot is a hard runner rollback floor because the preceding v1-only runner cannot read its cursor-bearing envelope. Restart catch-up semantics belong to ingress durability, not assistant scheduling: Telegram can replay provider backlog through update offsets, email only replays messages that are still unread, and local Linq webhook delivery has no backlog if the ingress process was down when the webhook arrived. Assistant automation must stay a pure consumer of persisted assistant input plus its own persisted receipt/outbox/terminal-evidence state, while each ingress path owns its own durable backlog, backfill, or always-on persister. Canonical prompt-backed automations must declare an explicit outbound channel route and always deliver their generated response instead of storing local-only undelivered summaries. Assistant turns now bind the real current user prompt, session id, and turn id on the host side, share one CLI-first Murph runtime surface, and use Codex App Server as the transport for reaching the same canonical `vault-cli` surface through native local CLI authority. Message-triggered assistant turns use that same full Murph runtime surface rather than a bounded read-only profile, so any accepted inbound channel message can inspect runtime state and canonical vault records for the bound user and vault. Assistant runtime receipt/outbox/diagnostics/status mutations stay serialized under one shared assistant-runtime write lock, and due canonical automations execute only while `vault-cli assistant run` is active for that vault.

Provider-native thread continuity is not a delivery ledger. Preserve a resumable Codex thread even when `finish_without_reply` or delivery-context filtering means its internal history differs slightly from the durable semantic transcript, and preserve it after authenticated private reads. Runtime-owned capability URLs belong only to the ephemeral delivery response: do not put them in the durable assistant transcript, fresh-thread replay, stale-resume fallback, or provider-native turn. Do not clear or abandon provider continuity as a privacy or delivery-reconciliation mechanism; enforce privacy at authority, output, logging, and snapshot boundaries instead.
Hosted group-email assistant replies use the assistant outbox as their single durability owner. The parent effect resolves authorized group members and creates privacy-blind, member-scoped child intents before it is considered sent; the no-send parent planner remains replay-safe through bounded response-body and partial child-intent persistence failures until that durable expansion completes, and stable per-member dedupe fills only missing children after a restart. Each child resolves only that member's current authorized address at delivery time. A deleted group or child whose recipient authority has changed before the provider call is durably abandoned with a typed authority-superseded reason, and transient failures proven to occur before provider entry remain retryable across the runner response boundary, while a lost internal response or liveness failure after the recipient-scoped provider request starts is terminal ambiguity. Successful siblings remain durable when another recipient fails, and an ambiguous child send is recorded terminally instead of replaying the whole group. Production Worker config embeds the prepared runner bundle and source fingerprints. Every warm or cold runner must report those exact fingerprints before a user workspace invocation is admitted, so a stale warm shell is replaced and a stale cold shell fails closed even before post-deploy smoke completes.

The hosted pending-input v2 index persists a capped exact-ack batch cursor in
the same workspace snapshot. It rotates later idle checkpoints without
deleting selected terminal entries until Web's contiguous consumed floor
covers them, so a blocked earlier sequence cannot starve later terminal rows.
That durable v2 envelope makes its producing runner a hard rollback floor once
the first matching workspace snapshot is accepted.

9. Query/export paths are read-only and must not mutate canonical vault state.
11. The hosted `apps/web` control plane accepts provider OAuth and webhook traffic plus authenticated browser and agent control traffic, keeps provider tokens away from browsers, records sparse routing and token-audit state, and owns the hosted member slices plus all hosted control-plane facts in Postgres. Hosted onboarding identity is anchored on the verified phone plus blind lookup keys in Postgres, while `HostedMemberIdentity`, `HostedMemberRouting`, `HostedMemberBillingRef`, `HostedMemberEmailAuthorization`, and `HostedWebSession` keep recoverable member facts and first-party browser app sessions on their owning rows; app-session tokens are opaque to the browser and stored only by hash. Privy is fresh proof for login, linking, and security-sensitive identity operations, while the Murph app session is normal hosted browser auth. The only human browser wearable-management surface is `/api/settings/device-sync/**`, and browser assertion routes such as `POST /api/device-sync/agents/pair` must still rely on short-lived signed assertions with consumed nonces. The companion (iOS) device-sync routes under `/api/device-sync/companion/**` authenticate with a Privy identity token in `Authorization: Bearer` through the same server-side Privy verification as browser sessions (no cookie fallback). Before minting a Junction SDK sign-in token, the companion sign-in route applies lifecycle intent against durable connection state through the shared device-syncd ingress path: known same-member passive repair sends `resume` and requires exactly one established row; fresh or unproven installation omits intent, under which durable state resumes exactly one established row or establishes only when zero provider rows exist; and terminal or ambiguous state rejects without mutation. Only a future visible hosted-health/Junction Reconnect action may send `connect`. The route returns the short-lived token exactly once without logging or persisting it. The companion health-metadata route accepts only bounded versioned Recovery/Strain records with client-hashed identity inside a 366-day history horizon and 24-hour future-clock allowance, caps pending payloads at 16 per connection, stores each accepted batch as one encrypted dirty payload on the active member-owned Junction runtime lane, and emits a value-free mailbox wake. That active connection is the ingestion authority; source rows are projection evidence used only to disambiguate multiple active Junction lanes, not a prerequisite for the zero-provider-row omitted-intent bootstrap. `device-syncd` validates the closed payload again, preserves Apple HealthKit as canonical provenance with only an unverified WHOOP-metadata hint, and canonical health writes still flow only through `packages/importers` and `packages/core`. The sole pre-login exception is `POST /api/device-sync/companion/auth-diagnostics`: it accepts only a small allowlisted auth-failure envelope, re-sanitizes the bounded provider message, writes one structured hosted warning, and applies per-client plus aggregate in-process throttles without persisting identity or contact data. Vercel WAF owns the cross-instance production rate limit for that route; the in-process window is a bounded fallback, not shared enforcement. Hosted onboarding Linq and Telegram webhook ingress verifies provider payloads in the route/service, stores sparse routing in hosted member owner tables, records quota counters where applicable, appends one canonical encrypted `conversation.message` mailbox item with channel-specific payload detail, and signals the per-user Temporal runtime workflow with no raw payload. Cloudflare Email ingress verifies either a signed reply alias for an active member or the fixed public sender route plus trusted sender authentication, stores the encrypted raw message, appends the same canonical mailbox item through a signed web callback, and signals the same pointer-only Temporal workflow through a signed web callback. Raw provider bodies, raw email messages, message content, verification headers, and provider secrets are not Workflow inputs. Cloudflare-bound hosted execution from exact message ingress and onboarding activation must first append encrypted hosted mailbox rows in the same transaction as the originating state mutation. Device-sync webhook freshness records trace/audit plus per-connection dirty state, appends one bounded `device-sync.wake` mailbox handoff on clean-to-dirty transitions, and completes trace acceptance in the same transaction. The runner pulls dirty rows through signed callbacks only when no fresh conversation input is pending. Hosted Linq, Telegram, and email ingress routes return success after durable classification/append or intentional ignore; post-append Temporal signal failures are logged as best-effort handoff failures instead of forcing provider retries. Device-sync webhook routes return success after durable trace/dirty acceptance; post-commit clean-to-dirty Temporal signal failures are logged as best-effort handoff failures, with no Vercel dirty-sweeper cron cadence and no dirty-row recovery sweep. The Temporal-owned global recovery reconciler is due-reconcile-only. Mailbox event-id dedupe and Temporal signal coalescing keep duplicate attempts safe, but web no longer runs a mailbox-lag cron backstop; a DB-backed pending-handoff reconciler remains future hardening for exact workflow-start failure journaling. Web does not own message-processing completion, assistant channel enablement state, same-conversation turn revision, outbox finalization, or internal runtime timers; those remain inside the restored local runtime checkpoint. Hosted device connection persistence stays provider-generic, hosted registry assembly should reuse the shared `device-syncd` config/factory seam, and provider-specific webhook-admin secrets must stay on provider-owned config rather than generic hosted env shapes. Hosted webhook receipts remain retry journals for receipt-local side effects only, not a second dispatch lifecycle owner. Stripe webhook ingress verifies the event and writes minimal receipt state synchronously, then starts a Vercel Workflow with only the Stripe event id; that workflow uses one event-id step to re-fetch Stripe, commit billing plus inline `member.activated` mailbox facts transactionally, perform the explicit activation-time crypto provisioning path after commit, and signal Temporal when activation appended work. Step inputs and outputs remain pointer-only, with member or activation ids re-derived inside the step when a Temporal signal follows a completed receipt. Raw Stripe request bodies, signatures, customer objects, and invoice objects are not Workflow inputs or step outputs. Billing remains monotonic: `invoice.paid` is the normal positive Stripe entitlement source, with one metadata-gated exception where `checkout.session.completed` can activate a valid Pulse Trial subscription in `trial` phase. Paid allowance still requires the paid phase from an accepted non-trial invoice, and hosted UI or API reads should follow eventual execution state rather than synchronous Cloudflare responses. Usage-credit Checkout is a separate one-time payment branch: reconciliation verifies the frozen purchase against live Session, line-item, PaymentIntent, Charge, Customer, currency, and mode facts before appending one grant. Browser return and status state never grants credit; an authenticated cancel return may re-fetch and idempotently expire only an open unpaid Session. Matching usage-credit refund or dispute events are intercepted before subscription handling; live re-fetched financial state appends capped signed `refund_adjustment` or `dispute_adjustment` entries under the beneficiary lock, while failures remain in the durable event retry lane and never suspend entitlement.
Established Linq direct messages and established external-thread group messages
resolve only a narrow blind-index/member-id preflight target and unwrap the
mailbox-payload ingress root before the planner transaction opens. The direct
preflight requires current active access and a complete active domain-root set;
the group preflight uses the already established route. Neither result grants
authority: the planner repeats route, identity, activation, access, and
participant checks in its transaction. New thread containers and members whose
roots or active access are not yet established remain on the transaction-owned
provisioning path.

For usage-credit Checkout, one `created` purchase row persists before Stripe
I/O and, together with the single purchase-status lifecycle and stable
purchase-derived idempotency key, permits identical creation retries for a
derived 30-minute window, and fences ambiguity through its frozen 90-minute
expiry. The financial movements described above use only signed
`refund_adjustment` and `dispute_adjustment` ledger entries; there are no
separate reversal or restoration kinds. Personal, hosted-group, and
Family-member funding use the same purchase lifecycle. Group funding resolves
the existing opaque join
code to the group's synthetic `HostedMember`, which remains the beneficiary;
it adds no group wallet, usage account, or separate funding code. The
authenticated contributor remains the payer. Family funding authorizes the
owner, active group billing, and selected active unsuspended direct member at
new-purchase creation, then freezes the Family group and member selectors in
the return scope. Exact request-key replay and Stripe reconciliation continue
against that frozen purchase even if membership later changes; a fresh request
must pass current Family authority again. Family funding adds no wallet,
ledger, or webhook branch. A deleted payer can detach only
from a terminal cross-owner purchase after the existing reconciliation-version
fence advances and encrypted provider references are cleared. That advance
makes payer-era preparation retry against the detached row, while retained
blind lookup keys keep later refund and dispute reconciliation possible.
Beneficiary deletion still removes its credit and purchase history in ownership
order.

Hosted app-session cookies use a strict v2 session-id plus bearer format. The existing token-hash field stores a dedicated web-key HMAC over the session id, bearer, member id, Privy identity, and expiry, so Postgres write access alone cannot mint or retarget browser authority; legacy unsigned cookies are rejected.

The companion Privy bearer rule above is the default, with one authenticated
extension bridge: `POST /api/device-sync/companion/imessage-mini-app/enrollment`
uses a verified Privy identity token to mint a random 24-hour, member-scoped
derived bearer. Enrollment fully validates its bounded body before identity or
authority reads, then takes the existing hosted-member and active-sponsorship
locks and re-checks active access plus launch consent before atomically rotating
one deterministic Messages-owned session row for that member in the same
transaction. Repeated enrollment mints a fresh bearer, invalidates the prior
bearer, clears revocation state, and remains bounded without touching ordinary
device-agent rows. Explicit revocation and expiry cleanup compare the exact
Messages lookup hash as well as the stable row id, so an already-authenticated
stale generation cannot revoke its replacement. Account deletion takes the
same member lock:
deletion-first enrollment fails closed, while enrollment-first deletion removes
the committed session. Only the credential's Messages-domain-separated lookup
hash enters the existing short-lived session store, so a rollback to the
historical unscoped device-agent hash reader cannot resolve it; current
device-agent authority also rejects its `hbds_imessage_` prefix. Every proof
action re-checks active access plus launch consent. Authenticated self-revocation
remains available after access or consent is lost. The containing app may share
only this derived credential through an explicitly addressed Keychain group;
Privy tokens remain host-private and never enter the extension or capability-less
message URL. The proof action is non-durable and does not create a second poll
source of truth.

Production companion auth diagnostics remain hidden until `MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED=1`; operators must install the exact-path Vercel WAF fixed-window limit before enabling that route in production.
The authenticated companion overnight PRV ingress is one strict derived-data
lane. After one explicit in-app enrollment, the iPhone keeps one continuous
WHOOP 5/MG BLE pulse-interval subscription and automatically evaluates a fixed
`00:00–08:00` local civil-time window. The schedule freezes the timezone rules
for that night, so a later timezone change cannot retarget an in-progress or
retained result. A fully traversed occurrence is bounded to 84...108
five-minute windows: typically 84, 96, or 108 for one-hour DST transitions and
ordinary dates, with intermediate counts such as 90 or 102 for half-hour
transitions. The phone reduces the stream into non-overlapping five-minute
windows and uses method
`prv-rmssd-5m-mean-scheduled-0000-0800-local-v1`. It sends the sole
`murph.companion.overnight-prv-rmssd.v1` envelope with exactly `schema`,
`methodVersion`, `nightDate`, `rmssdMs`, `completedWindowCount`, and
`acceptedWindowCount`. At least 48 windows must be accepted and at least half
of the completed windows must qualify; completed windows must remain within
the schedule-derived 84...108 bound.
Per-window accepted duration is phone algorithm policy, not another server
field or reconstruction.

The companion owns capture timing; no backend scheduler starts or stops a
night. To survive ordinary process loss without retaining raw telemetry, it may
atomically persist one schema-versioned, OS-protected scalar checkpoint for the
current scheduled night and an outbox of at most three already-derived strict
six-field envelopes. The checkpoint contains only the frozen schedule/night
identity, completed/accepted counts, accepted-RMSSD sum, and next window
position. The exact app-scoped CoreBluetooth peripheral UUID may persist beside
that checkpoint solely to restore the enrolled band; it never uploads or enters
logs. An incomplete five-minute window is discarded after a process gap. Raw
BLE packets, R-R intervals, packet timestamps, heart-rate samples, per-window
results, WHOOP account identity, and any other band identifier are never
persisted or uploaded; exact capture timestamps, duration, timezone details,
and coverage milliseconds are never uploaded or logged.

The local Connect WHOOP control enrolls only the CoreBluetooth band; it does not
send hosted `connectionIntent: "connect"` and cannot establish or reactivate a
Junction lane. A known same-member SDK repair sends `resume`. A fresh or
unproven installation omits intent and lets durable server state decide:
exactly one established Junction row resumes, zero provider rows may establish
the first lane, and terminal or ambiguous state rejects without mutation. Only
a future visible hosted-health/Junction Reconnect action may send `connect`.
Data ingress and retry-outbox drain carry no connection lifecycle authority.
Local band disconnect or sign-out disables BLE resume and clears the local
enrollment, checkpoint, peripheral UUID, and unsent outbox after band cleanup;
it does not silently mutate hosted connection state. iOS cannot resume the BLE
app after the member force-quits it, so one continually postponed local watchdog
notification tells the member to reopen Murph if stream callbacks stop; normal
backgrounding or locking the phone does not require a nightly action.

Web reuses the existing authenticated, consent-gated device-sync path and one
active member-owned Junction connection; data ingress never establishes or
reactivates a connection. It stages one compact encrypted
`companion_hrv_rmssd` dirty payload and wakes the existing hosted runtime. The
first accepted strict envelope owns `(connection, nightDate)` for 30 days;
exact retries are no-ops before first-admission freshness and connection gates,
while changed content conflicts. Web-owned Postgres retains only the bound
connection/member, a hashed receipt id, strict-envelope hash, and creation time.
Receipts are excluded from hosted workspace snapshots, lazily expire through
the indexed owner/connection/time path, and are capped at 64 per connection.
An expired admission must pass the current gates again.

The SHA-256 admission identity is verified across encrypted staging, the same
local retry row, Junction normalization, and canonical import. The hosted
payload remains the durable retry authority until canonical success; yield,
lease expiry, retryable failure, cold restore, or later disconnect does not
acknowledge or replace it. Only canonical success or the exact structurally
invalid terminal result acknowledges it. Runtime hydration continues to bind
the opaque hosted connection id to one local account before mutable provider
identity, with the existing fail-closed legacy consolidation rules.

The receipt's operational cardinality is connection plus `nightDate`; canonical
cardinality is independently vault plus source (`whoop`) plus `nightDate`.
Import writes one immutable summary-grain
`whoop-ble-overnight-prv-rmssd` observation for that
canonical identity, using a synthetic 12:00Z `occurredAt` derived solely from
`nightDate`, omitting event `timeZone`, and never reconstructing capture time.
The value is a beta wellness pulse-rate-variability estimate, not clinical ECG
HRV, WHOOP's proprietary overnight HRV, or WHOOP Recovery. It has no generic
`hrv` or biomarker alias. Apple HealthKit SDNN remains `hrv-sdnn`; the existing
provider resolver continues to emit at most one selected daily `hrv-rmssd`
point across WHOOP Recovery, Oura, and other provider evidence. The beta
companion series does not enter or alter that resolver.

Deployment is runtime/Cloudflare first with immediate container rollout,
runner-bundle fingerprint proof, and a compact import smoke; web is second and
iOS distribution last. Before the automatic client ships, web must implement
known-member `resume`, fresh-install omitted-intent inference, and future
explicit `connect` authority. The direct-BLE control sends no hosted lifecycle
intent. Separately, known same-member passive SDK repair uses `resume`, while a
fresh or unproven install omits intent so the server resumes exactly one
established row, establishes only when zero provider rows exist, and rejects
terminal or ambiguous state. Only a future visible hosted-health/Junction
Reconnect action may send `connect` and create or reactivate the lane; omission
can never reverse an explicit disconnect.
Before iOS distribution, a signed physical iPhone must complete a continuous
subscription and overnight WHOOP 5/MG capture-to-query test, including
background, disconnect/reconnect, force-quit watchdog, DST, and timezone-change
cases. Network/log inspection must prove the forbidden raw data is absent, and
paired-ECG validation must support the beta method. Once an iOS client can emit
the scheduled method, runtime and web support for it are the rollback floor.
Roll back in reverse order: stop iOS distribution, remove web acceptance only
after staged work drains, then remove runtime support.

12. The hosted `apps/cloudflare` execution plane accepts ensure-processing requests over its narrow internal HTTP surface — callback-signed from the Temporal orchestrator, or Vercel OIDC-authenticated from web ingress as best-effort direct latency hints for Linq and Assistant Ask request/completion mailbox appends whose trigger is recorded in orchestration latency diagnostics as `triggeredByWebDirect` derived from the authorizing credential — plus Vercel OIDC-authenticated browser-vault session, deletion, and user-status requests, with one additional signed deploy-smoke route for managed-container release verification. The ensure-processing adapter starts, wakes, or accepts pending processing for the exact active write-fenced runtime and returns after that intent is accepted rather than after runtime idle; Cloudflare alarms remain write-fence alarm cleanup rather than semantic schedulers. Browser-vault refresh is hosted runtime work represented by web-owned system-mailbox rows and orchestrated by Temporal, not a separate worker path. There is no Cloudflare Queue wake executor or fallback; duplicate delivery safety belongs to mailbox event-id dedupe, Temporal signal coalescing, exact Assistant Ask request/completion identity, idempotent continuation delivery, and Linq delivery-time `consumedAt` stamps. The direct Durable Object methods restore ephemeral local execution context from encrypted hosted workspace snapshots, inject a method-based hosted runtime platform into `packages/assistant-runtime`, and keep deployment topology app-local. Hosted is a thin containerized runner over the same local runtime input spine: it restores the workspace, stages mailbox conversation rows as assistant input, runs the local scanner/active-turn machinery, imports a bounded same-wake mailbox batch during initial selection or the required pre-scan refresh, freezes that batch before provider start while leaving later rows pending, imports late active-turn mailbox rows through an invocation-local foreground loop, steers same-conversation input into the live Codex turn when one exists, journals accepted input, may hot-service only the exact assistant wake projected by the current foreground assistant phase once before the idle floor while dirty without publishing a snapshot, and keeps the invocation dirty until the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint publishes the updated workspace. Mailbox payload decrypt is a narrow Worker-owned runtime write-fence capability: the container calls a mailbox decode hook through the normal `web-control.worker` virtual host, Cloudflare Container outbound interception dispatches it inside the Worker, the Worker verifies the runtime write fence and returns only a parsed hosted wake or blocked result, and the container does not receive ingress root keys, private JWKs, callback-signing private material, or root-fetch authority for mailbox import. The canonical runtime-to-worker authority model is normal internal virtual-host fetches plus runtime write-fence headers, with no public runner callback endpoint; generic side-effect authority is `attemptId`, write-fence generation, and bound user, while workspace version remains only checkpoint/restore compare-and-swap freshness. Provider egress for intercepted OpenAI, ElevenLabs, Exa, Mapbox, Linq, Telegram, hosted data API, and Workers AI transcription calls stays Worker-mediated through Cloudflare Container per-host outbound handlers for default provider/internal hosts, while the catch-all outbound handler remains an explicit open-internet passthrough for arbitrary hosted-agent HTTP/HTTPS egress and runtime-configured provider override hosts. Native child-process integrations for OpenAI, Exa, Mapbox, `murph_data_api`, and `workers_ai_transcribe` receive a signed Murph provider credential in the provider's native credential slot; Worker egress validates that credential's provider/user/runner identity against UserRunner's current active runtime state before injecting the real Worker-owned credential. Generated image turns use that OpenAI egress path for GPT Image 2, persist validated image bytes as canonical capture media under `raw/captures/**` when a vault is available, and use the write-fenced `results.worker/generated-images` effect only to upload the delivery copy to Cloudflare Images; Cloudflare Images credentials stay Worker-owned and are never forwarded into hosted runtime env. Generated voice memo turns store bounded transcript/config metadata only; Linq turns upload generated MP3 bytes into a Linq attachment during tool execution, while Telegram turns generate bounded MP3 bytes at final delivery and send them through Telegram `sendVoice` without persisting the bytes. ElevenLabs, Linq, and Telegram credentials stay Worker-owned sentinels in hosted runtime env. Hosted audio transcription is the same Worker-owned shape: the parser pipeline POSTs ffmpeg-prepared audio bytes to the fixed `murph-transcribe.worker/v1/transcribe` host, the Worker authorizes the signed `workers_ai_transcribe` provider credential, exact write-fence proof, or a provider-egress token, calls the Workers AI binding (`@cf/openai/whisper-large-v3-turbo`), and returns only bounded transcript JSON; Workers AI account context never enters the runtime env and the runner image ships no local speech model. Direct invocation mints runner-scoped provider credentials into the explicit supervisor-env projection, the runtime platform attaches exact write-fence headers or provider-egress tokens where the client path can carry them, and Worker secret injection strips runtime authority headers before upstream egress. The open-internet passthrough also strips runtime authority headers and never injects Worker-owned provider credentials. Intercepted providers validate exact write-fence headers, provider-egress token proof, or a runner-scoped signed provider credential; there is no tokenless active-user-fence provider authorization path. Delivery providers (Linq and Telegram) and ElevenLabs continue to require exact write-fence headers or a provider-egress token, so they can only be reached through the runtime's wrapped fetch that routes through the outbound-intent journal owning recipient binding and idempotency. ElevenLabs is constrained to `POST /v1/text-to-speech/:voice_id` with the MP3 output format, Exa is constrained to `POST /search`, and Mapbox remains constrained to allowed read-only GET allowlisted path families. The container supervisor pins Codex, native TLS, Node, Python requests, and curl CA bundle env to Cloudflare's runtime HTTPS-interception CA path, rewires the installed `codex` command to the native binary so the long-lived process is the native app-server, and direct invocation preserves those CA pointers plus Cloudflare-managed proxy env without accepting user overrides for transport settings. The outer native container shell may stay warm per user for the configured idle lifecycle; when Cloudflare reports `sleepAfter` activity expiry, RunnerContainer yields to any active foreground invocation or tears down an idle warm shell, and it never records pending checkpoint intent or posts a host-owned checkpoint job. The private container bridge is reached only through the container Durable Object's internal `containerFetch`, keeps a plain `/health` check plus validated `POST /internal/workspace-invocation`, rejects concurrent workspace invocations, exposes only an internal `POST /internal/runtime-wake` callback into the active invocation, and no longer carries a second per-shell bearer-token layer. The direct hosted invocation uses per-user warm workspace roots with invocation-local writable cache and temp roots. The per-user runner keeps only write-fence state, direct-R2 snapshot upload sessions, and other short-lived coordination state in Durable Object storage while writing v2 checkpoints as a single encrypted object through a presigned R2 PUT URL; the Worker never streams the snapshot body and there is no Worker request-body fallback. Gateway state here is projection or cache only, not a second durable authority. Broad worker control seams are intentionally gone: no generic user-env CRUD route surface, no dispatch-payload CRUD or staged dispatch control plane, no deleted sharing CRUD, no local-vault import payload CRUD, no broad pending-usage store routes, and no mutable gateway control routes. Narrow signed callbacks back into `apps/web` remain only where execution still needs them, such as device connect-link initiation, hosted device-sync runtime snapshot/apply callbacks against the web-owned authority, assistant-configuration reads and mutations against web-owned member preferences, product-feedback recording into web-owned rows, and direct hosted usage recording into the web-owned ledger. Missing crypto fails closed outside the explicit activation-time provisioning path, and platform-envelope key material must still fail startup immediately when malformed.

Reconciliation evaluates engagement and AI-usage authorization for runnable model work even when deterministic system lag is present. Authorized conversation/default work owns the foreground pass and imports system items before the assistant phase without letting a retryable system item starve fresh conversation. When model work is blocked, or system lag is the only work, the existing `system_mailbox` mode imports only the system lane and returns before assistant execution. It adds no queue, scheduler, cursor, or durable state owner.

Hosted Exa egress is narrower than the path allowlist alone: before injecting
the Worker-owned key, `apps/cloudflare` must validate the exact bounded
`vault-cli research scout` request shape, the `research paper` category, and
bounded non-identifying profile tags, and clamp the caller-supplied publication
window to a well-formed past-or-near-present range. The shared Exa
research-scout request recipe, query shape, and structured-output schema live
in `@murphai/contracts` so local CLI and hosted Worker validation cannot drift.

Hosted Linq typing events are verified and ignored. The Temporal mailbox
signal remains the only durable wake authority for hosted runtime work. For a
committed known-checkpoint Linq message, Web first verifies the checkpoint owner
and canonical participant-aware live access as part of the unconditional
Temporal pointer signal. Assistant Ask request and completion handlers likewise
append their encrypted mailbox item before signaling Temporal. Only after
Temporal accepts the applicable durable signal does Web
start one best-effort direct `ensure-processing` request to Cloudflare (Vercel
OIDC, fire and forget, no retries, no mailbox payload). Access denial, expiry,
or Temporal acceptance failure starts no direct wake. The direct request exists
only to cut wake latency and may be dropped at any time with no correctness
impact: accepted Linq reply delivery stamps the exact mailbox item with
`consumedAt`, while Assistant Ask has deterministic request/completion identity,
mailbox dedupe, and idempotent continuation delivery. The Durable Object write
fence coalesces runners that overlap in the same invocation. There is no other
Web-to-Cloudflare prewarm or nudge path.

Participant-derived thread-container authority is a seven-day lease over an
authoritative provider observation, reused by ordinary access, AI admission,
usage allowance, and newsletter projection. A non-direct Linq inbound may
advance only the already-existing, nonremoved relationship for the
server-resolved sender; it cannot create participant authority, clear a newer
removal, move `lastSeenAt` backward, or use a provider timestamp later than
server time. Owner-derived authority remains independent. Partial oversized
rosters therefore cannot turn an omitted or departed participant into an
unbounded subscription capability.

Hosted Linq participant-change webhooks are privacy-minimized provider-ledger
facts, not runtime work. A unique participant addition may set one nullable
coalescing bit only on an existing thread route; it does not retain the
participant identity, create authority, fetch the roster, append mailbox work,
or wake a runtime. The next normally admitted non-direct message takes the
canonical chat-ownership lock before the route row, consumes exact `true` in the
same transaction as its ordinary mailbox append, and carries one typed context
hint. The runner records that hint in the existing tolerant mailbox-to-input
sidecar rather than the strict persisted assistant-input event, projects it only
onto the transient input candidate, and renders the same fixed context for both
normal and captureless active-turn prompt paths. It exposes the hint only with
route authority and explicit group attestation, while the existing live roster
tool remains the sole decision-time participant source. Duplicate additions
coalesce, removals remain ledger-only, and any failed or raced append rolls
consumption back.

Hosted Linq group reactions use the same one-shot context boundary. A unique,
verified reaction for an active account-bound group route is checked against
the live roster and exact reacted-to message, then appends one actor-attributed
entry to an encrypted transient buffer on that route. The same nullable column
holds the newest ten entries in insertion order; older entries fall off without
creating a separately processed queue. Each entry keeps the canonical active
roster handle, reaction action/type, and bounded target text, but no provider
identifier, URL, or attachment metadata. It is optional lossy context, not
product truth, and creates no mailbox item or wake. The next normally admitted
group message consumes and clears the whole buffer under the existing chat and
route locks, carries it on that ordinary `conversation.message`, and exposes it
only through the existing tolerant mailbox-input sidecar as a clearly quoted
weak prompt hint. Corrupt context fails open, authority rotation clears it, and
a failed or raced mailbox append rolls consumption back. Append decrypt and
reseal share one 500 ms deadline, and consume decrypt has the same bound, so
optional crypto cannot inherit the general KMS deadline while holding locks.
When raising the consumed hint beyond the legacy 512-character contract, deploy
the hosted runner bundle before the web producer so every parser accepts the
new 5,129-character maximum before web can emit it. Once web has written the
new array shape, forward-fix web rather than rolling it back until those
transient slots have been consumed or cleared.

One case is actionable immediately: an affirmative added reaction from the
active participant is adapted into the existing `message.received` planner
input, using the reaction event as inbound identity and the reacted-to message
only as a reply reference. The synthetic text describes the actual reaction
without asserting agreement. That same planner owns private and group routing,
access, quotas, mailbox dedupe, and wake handoff. At the existing assistant
outbox-history boundary, the reply reference must exactly match a sent Murph
delivery on the same route before the reaction description can reach reply
generation. The turn context binds the reaction to that exact message and
treats a tapback as acknowledgment or appreciation by default, and as agreement
only when the target asked a single closed yes/no question or proposed one
specific action whose affirmative answer is unambiguous; a reaction alone never
establishes user facts, consent, or authorization.
Synthetic reactions stay in one-input automation groups, so an adjacent
ordinary reply cannot lend them trust or be suppressed with them. This keeps
the path independent of Linq's short provider-message retention while rendering
the exact same- or cross-session target from existing outbox truth.
Unmatched targets are terminally silent, and synthetic reaction identities are
excluded from message read receipts and provider-message cleanup. The reaction
path adds no mailbox kind, state, or lifecycle. Existing group join-offer
acceptance remains the earlier exact owner. Removals and nonaffirmative
reactions remain on the silent group context path above (or ignored outside
groups).

Hosted Linq unknown first-contact admission is a web-owned classifier gate on
the signup-link path only. It runs after cheap deterministic ingress filters and
before member/invite mutation, calls OpenAI through an env-only key with bounded
message metadata/text, reduces provider service metadata to a fixed enum,
persists only the event-id keyed terminal allow/block decision, stores no
classifier payload or response body, and fails closed without sending a reply
when enforcement is enabled and the classifier explicitly blocks. OpenAI
refusal and content-filter outcomes are terminal unsupported content blocks, and
first-contact budget exhaustion also blocks before side effects.
The legacy nullable rejected-message-text column is retained only as a
deploy-skew compatibility column during the expand/contract rollout; new Prisma
code ignores it and the migration scrubs existing values.
Classifier-path budget claims and decision recording commit together, and the
event-id decision write is duplicate-safe so webhook retries can observe the
same terminal decision without replaying a failing unique-constraint path.
Classifier-unavailable states, including missing keys, timeouts, ordinary
non-2xx responses, malformed output, non-completed responses, max-output
exhaustion, and OpenAI quota or credits exhaustion, intentionally fail open by
recording a deterministic allow decision so a legitimate first contact is not
permanently dropped. Active members, explicit thread routes, own messages, group
chats, local guard rejects, deterministic URL/STOP-style spam, and other
non-invite paths bypass the classifier.

Hosted signup-welcome admission is a separate line-owned outbound guard. Web
serializes only the affected member's durable row, reads each healthy assignable
`HostedLinqLine`'s UTC-day proactive-conversation counter, selects the preferred
line or a lower-volume fallback, and conditionally claims one slot before
appending activation work. Linq route owners take that member row `FOR NO KEY
UPDATE`: this still serializes them with activation and each other, while
remaining compatible with the foreign-key `KEY SHARE` taken when Linq, Telegram,
or another channel appends mailbox work after changing the shared routing row.
This avoids a second lock namespace and avoids a routing-row/member-row
cross-channel deadlock. Active-member targets guide selection but are
advisory: when every line is at its target, the preferred or least-loaded
daily-eligible line remains assignable and concurrent requests may create a
small overshoot. The
effective proactive limit is the lower of the hard 50-conversation ceiling and
the line's configured `maxNewConversationsPerDay`; the line row lazily rolls
its counter to the new UTC day. The conditional row update is the only atomic
shared-pool capacity gate. If a claim loses, activation retries it once for a
day-rollover race and then tries another eligible line inside the same request.
If no line has welcome capacity, web still assigns a healthy home line but
omits the participant-target welcome, preserving the member-initiated Text
Murph path. Same-line inbound first binds and existing-thread replies do not
consume this proactive budget. A degraded incoming line may fall back to a
different line only after the final member route agrees with the selected line
and that line's capacity is atomically claimed, because the fallback creates a
new participant-target chat; without capacity, web accepts the inbound event
but sends no fallback chat. For an unknown phone on a degraded incoming line,
web materializes the member identity before that final claim so concurrently
created route authority can be re-read. A rejected claim commits that inbound
identity but creates no home or pending route, invite, delivery, fallback chat,
or line-count increment; a later inbound resolves the same member and retries
normal routing. Member deletion cannot erase line-level capacity already
claimed that day.

Hosted runner progress reconciliation treats a runtime-kind write fence as the active
owner of execution and commit authority rather than mailbox-work truth. Exact
accepted wakes may coalesce under Cloudflare's active owner; durable mailbox lag
remains recovery truth but duplicate execution is prevented by the write fence;
accepted processing returns an owner recheck instead of a short
durable-lag polling loop; a same-version startup fence keeps its startup grace,
while an exact prior-version container that reports no active child is replaced
immediately by identity; concurrent replacement callers converge on the current
fence record instead of entering a timed race state; wake-unconfirmed active
children retry instead of being replaced, and alarm cleanup
failures are rethrown so the platform can retry instead of permanently deleting
the alarm. New v2 foreground leases restore from durable workspace snapshots and
legacy refs also cold-restore from durable bundles instead of trusting dirty
warm local runtime markers across leases. Encrypted hosted snapshots also carry
the exact query SQLite cache triplet so a fresh one-vCPU runner can reuse the
last projection; canonical vault files remain authoritative, source-manifest
validation rebuilds stale caches, and every other projection remains excluded.
The detailed contract lives in
`agent-docs/references/hosted-runtime-protocol.md`.

A valid `idle_shutdown` snapshot whose workspace-version compare-and-swap still
matches is committed even when web observes newer durable conversation input.
Web commits the checkpoint request's wake projection as part of that same CAS
prefix and returns the optional, transient `conversationInputAhead` observation. A live
default-mode runtime imports that input through the existing foreground path
immediately after checkpoint publication; a retention-only or shutting-down
runtime leaves the mailbox row to the durable web/Temporal reconciliation path.
The runner does not discard the
uploaded snapshot or create a second metadata-only shutdown snapshot. The old
`foreground_pending` checkpoint response remains parser/runtime compatibility
for an older web deployment only. If a shutdown-time import has already staged
new assistant input locally, that real dirty state is checkpointed with a due
`assistant` wake so the restored runtime cannot strand it. This is an ordinary
dirty-state checkpoint, not a synthetic wake-handoff snapshot.

After an exact successful runtime completion clears its write fence, Cloudflare
makes at most one signed, payload-free, best-effort callback to web with a timeout
of at most two seconds; a known future mailbox retry continuation skips it. A
completed invocation may attach one exact positive, signature-bound query when
it newly committed an unserviced default or retention schedule. Web otherwise
signals the existing payload-free `runtime_recheck_requested` Temporal workflow
only for runnable mailbox lag and never converts a persisted due wake into a
repeating level-triggered signal. The positive edge contains no wake data and is
not persisted; it asks Temporal to re-read durable facts and own either due work
or the exact future timer. Callback failure is non-fatal and is not retried by
Cloudflare. Active, unsupported, error, and timeout liveness
outcomes preserve the fence; only explicit inactive or mismatch proof, or exact
successful completion, may enter the corresponding identity-safe recovery or
clear path.

The hosted Temporal hard-cut target is documented in
`agent-docs/references/hosted-temporal-orchestration.md`. That ADR is the
canonical target for replacing Vercel Workflow nudge handoff and Cloudflare
semantic scheduling with pointer-only Temporal orchestration while keeping web
as reconciliation-facts/status owner, Cloudflare as execution adapter, and
Murph runtime as the owner of Codex and business logic. The completed execution snapshot and
subagent prompt record is `agent-docs/exec-plans/completed/TEMPORAL.md`.

## CLI Framework Notes

- `packages/cli` is built on incur. Model nested verbs with real mounted sub-CLIs such as `search -> query` and `query -> projection -> status|rebuild`; do not simulate nested commands with argv rewrites or positional action enums.
- Treat `murph` and `vault-cli` as different UX layers over the same command graph: `murph` is the single-active-vault product entrypoint, while `vault-cli` remains the raw explicit-vault contract for development, automation, and assistant/runtime integration.
- Treat output/discovery transport such as `--format`, `--json`, `--verbose`, `--schema`, `--llms`, `skills add`, and `--mcp` as incur-owned global behavior. Murph command docs should focus on domain semantics unless the repo intentionally constrains that surface.
- Keep the root CLI default-exported from `packages/cli/src/index.ts` and keep `packages/cli/src/incur.generated.ts` aligned with command-topology changes so typed CTAs and generated skill metadata stay truthful.
- Source-only CLI checks are useful for triage, but repo acceptance still depends on the built CLI path because package tests execute `packages/cli/dist/bin.js`.

## Source Of Truth

- Routing and hard rules: `AGENTS.md`
- Durable docs index: `agent-docs/index.md`
- Detailed architecture summary: `docs/architecture.md`
- Hosted Temporal hard-cut ADR: `agent-docs/references/hosted-temporal-orchestration.md`
- Completed hosted Temporal migration plan: `agent-docs/exec-plans/completed/TEMPORAL.md`
- Frozen baseline contracts: `docs/contracts/*.md`

## Current Verification Posture

The repository uses the current verification commands described in `agent-docs/operations/verification-and-runtime.md`, with ordinary Vitest output contained beneath one marked process-owned temp root that is removed at teardown and recovered conservatively after an abrupt stop. It also has a cross-platform repo-local host setup path (`pnpm onboard` / `scripts/setup-host.sh`) for macOS and Linux, a fixed-version release manifest that publishes five public packages while bundling private workspace owners into the relevant tarballs, a local device-sync runtime with service/http tests, and inbox/parser package tests that exercise runtime rebuild, audio/video parser workers, parser-toolchain discovery, and parsed-pipeline flows inside the local TypeScript workspace.
