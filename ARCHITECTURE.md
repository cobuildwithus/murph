# Murph Architecture

Last verified: 2026-08-07

## Accepted-Message Targeting

Exact-message replies and reactions share one accepted-message targeting
primitive. The model sees only an existing `AssistantInputEvent.inputId` as a
`Message ref` beside eligible accepted Linq iMessage input or Telegram input
with a valid numeric provider message target. Linq SMS, RCS, and unknown
service types expose no ref. One resolver binds that ref to the current
delivery-context ordinal, reloads the stored event, rechecks route,
conversation, audience, group-actor, provider-target, and action-specific
capability authority, and returns only the accepted input id. Provider message
ids stay inside the local delivery boundary. The current thread-kind binding,
not the one-off explicit-target override, is the provider-thread authority for
that recheck. Both targeting tools are
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
After an authenticated group join or sharing save, the page reuses the
dashboard auth owner's first-checkout decision: a member who still requires
checkout continues directly to `/join`, while an accessible member retains the
existing chat-channel or Home return. The group feature adds no onboarding or
billing state owner.

`murph.group action="read_shared"` is the only hosted assistant path for group
standings, shared facts, and diagnostics. Its runtime adapter is synchronous and
performs no I/O when constructed. This path adds no pre-model roster, grant,
snapshot, device, projection, configuration, or attribution read; existing
accepted-input and route-binding work is unchanged. Web is contacted only after
the model invokes the tool.

`murph.group action="read_chat_name"` is the on-demand provider-title primitive.
Web resolves the signed callback member's single encrypted thread-container
route only after the model invokes it, then performs one bounded Linq chat read
or Telegram `getChat` read. The model supplies no provider thread id. Linq's
synthetic comma-joined handle label is returned as no name rather than exposing
phone or email handles. The result contains only bounded untrusted display text
with `ok`, `none`, or `unavailable` status; it grants no authority and creates
no cache, retry, reconciliation, wake field, or new state owner. New-group setup
may pass the exact immediately preceding `ok` result into the model-facing
`offer_access` action.

`offer_access` is a semantic facade over the existing Web-owned access
operations, not a new service or state owner. Assistant-engine maps the model's
exact display name and projection scopes to the trusted runtime. The runtime
selects `post_join_offer` only for an exact interactive iMessage route and uses
`create_join_link` for SMS, Telegram, explicit standalone-link requests, and
scheduled group routes whose durable Linq binding lacks a service subtype. The
model receives normalized `native` or `link` presentation semantics plus only
the canonical presentation time needed for the bounded challenge recency rule;
Web continues to own group creation, consent copy, dedupe, join URLs, and
grants. A newly posted native offer remains native. When a covering active offer
suppresses another provider message, the semantic facade returns its
first-party URL as a freshly visible link instead of claiming a new card was
sent. Missing additive rollout evidence is handled but never recency-eligible.
An explicit native offer is suppressed only by a covering active offer, never
by the scopes already granted by current members, because access may be
intended for a provider-room participant who has not joined the hosted group
yet.

Challenge kickoff and later interactive identity repair stay inside that same
model-triggered `read_shared` request. At request time, the runtime adds only
the bounded, route-authorized current-turn iMessage or SMS sender handles
already visible in the prompt. Web matches those handles against verified phone and email blind
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

Immutable hosted memory consolidation remains an isolated one-shot automation
with its network-denied memory-write profile. Reminder availability uses no
model turn or separate automation: the existing hosted background automation
pass deterministically scans active private automations that explicitly store
`skip-when-busy`, `calendar-only`, and one exact Google Calendar or Outlook
account binding; exact-time automations are ineligible. When the stored snapshot
is missing or reaches its 23-hour refresh deadline,
host code derives the exact account and current seven-day provider request,
caps the result, reduces it to normalized busy timestamps, rereads the
automation, and performs a version-fenced suffix replacement. Complete empty
reads persist an empty snapshot so the same canonical `generatedAt` field also
bounds refresh cadence. The pass returns the earliest next refresh deadline to
the existing workspace checkpoint and Temporal timer owner, leaving one hour of
headroom before delivery rejects 24-hour-old evidence without adding another
scheduler or state owner. Foreground conversation admission aborts an in-flight
calendar read through the existing background-maintenance signal; runtime
shutdown remains the fallback cancellation signal. Ordinary
user-authored saves and instruction patches strip the engine-owned suffix.
Changing a reminder to an exact-time schedule atomically replaces
`skip-when-busy` with `fixed` and removes its source, account, and snapshot.
Scheduled delivery ignores it unless current policy/source/account
authorization remains exact and the snapshot is canonical, unexpired, and
covers a non-exact-time occurrence scheduled within 24 hours of generation. The
snapshot is host-only derived data and is stripped from the instruction prompt
before any model-backed notification turn. That snapshot is
a short derived-data lease: disconnect or provider revocation stops future
refreshes but does not synchronously cancel already-derived busy timestamps.
Policy removal or account replacement invalidates the lease immediately;
provider failure, incomplete pagination, malformed or older evidence, and
concurrent edits send normally. Raw calendar content never reaches a model,
memory, automation instructions, or logs, and normalized busy timestamps never
reach a model prompt.

Each synthetic hosted group runtime may additionally keep one assistant-authored
`group-room-model` derived knowledge page. A twice-weekly managed automation
installed only on authenticated non-direct Linq/iMessage or Telegram routes
reuses the existing isolated, exact-skip background-maintenance lane and a
bounded seven-day tail of committed transcripts from those same authenticated
group-chat channels. It fully rewrites the one page only when the evidence
materially improves a compact list of room canon, likely person-specific comedy
preferences, successful Murph formats, retired material, and open callbacks.
Silent consolidation targets a compact 2-6 KiB guide and treats 20 KiB as a
generous soft ceiling, never a write gate. When the page exceeds that ceiling,
is materially bloated with duplicate or stale detail, or approaches the
defensive 64 KiB serialized-page limit, the next evidence-supported rewrite
merges duplicates, summarizes old examples into durable patterns, and prunes
stale or completed detail while preserving explicit setup, current boundaries,
unresolved loops, and high-confidence room or participant patterns.
One dedicated owner reads, replaces, or deletes the fixed page. Generic
knowledge show, list, search, append, upsert, and generated index surfaces
exclude it. Every mutation passes the digest returned by the immediately prior
show and compares that digest under the same fixed-page lock, so a concurrent
rewrite cannot be lost. There is no separate authored-body byte cap. Replacement
validates the complete serialized fixed page against the defensive 64 KiB raw
file ceiling before writing. Ordinary prompts render the complete accepted page
without revalidating it against a wrapper-dependent byte ceiling. Raw `Sender:`
handles remain transient evidence attribution and cannot be persisted in the
page.

Ordinary authenticated hosted group-chat turns read that fixed page directly
from the same group vault and append a bounded rendering to dynamic turn
context. An explicit current-room remember, correction, retirement, or forget
request may fully rewrite the page only through a dynamic tool admitted for
current accepted input on that authenticated route. Group email neither receives
the page nor contributes maintenance evidence, and its spoofable sender cannot
receive the mutation tool. Silent consolidation receives that same dynamic tool
only from the immutable managed-automation id, runs in a fresh one-shot Codex
thread with workspace access denied and network disabled, and has no generic
knowledge or shell write surface.
Ordinary prompt reads fail open by withholding every unusable page body and
injecting only a compact trusted status for missing, inactive, or unavailable
state. Mutation reads still distinguish a genuinely missing page from malformed,
unreadable, or wrong-type fixed-slug state; conflicts stop both explicit and
scheduled replacement. The rendering remains quoted as fallible data. The
resident group-context principle uses the smallest relevant safe set, combines
several details only when shared history is essential, and applies room context
whenever it materially improves the current result without forcing callbacks or
roll calls. Current messages, explicit corrections, safety rules, authoritative
tool results, and explicit canonical room style settings always outrank it.
This adds no database table, mailbox
kind, roster service, cursor, vector index, per-participant page, or pruning
workflow; the admitted committed transcript is evidence and the single page is
the only durable room-intelligence owner.

Managed automations additionally carry one immutable owner scope from their
exact current seed or registered dynamic identity. Member seeds may reconcile and execute only
on personal/direct routes; authenticated-group seeds may do so only on live
non-direct Linq/iMessage or Telegram routes. Reconciliation archives every
nonterminal wrong-owner record, and claimed occurrences revalidate the current
seed and live route before lifecycle hooks, evidence, provider/model work,
tools, delivery, and commit. Caller-supplied unscoped seeds retain their prior
compatibility behavior, and mutable tags, slugs, titles, or instructions never
acquire this authority. The post-onboarding choice point is the one registered
dynamic member identity; dynamically generated experiment-lifecycle seeds stay
on their existing separately owned path until that owner exposes an exact
identity resolver.

The post-onboarding choice point is one ordinary managed one-shot. Answered
onboarding schedules it 21 local-calendar days after completion; maintenance
gives older eligible members one future same-weekday catch-up and keeps the
installed occurrence stable. A claimed occurrence revalidates canonical
onboarding state, then uses the ordinary scheduled-turn planner, current direct
conversation, and a vault-readable shell. Its exact immutable identity adds one
developer-level read-only policy, removes hosted dynamic mutation tools and
external network access, and selects a filesystem-read permission profile in a
fresh ephemeral one-shot Codex process. The fresh process replays the current
session's committed conversation history but never resumes or replaces that
session's ordinary provider thread. The ordinary save and ingestion rules are
suspended only for this occurrence. The automation asks one low-pressure
question or skips, and it cannot change goals, plans, memories, experiments, or
automations before the member replies.

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
`available`. A current exact-scope grant also returns its canonical activation
time as bounded authorization metadata; it is not causal consent proof. The
grant metadata and snapshot reads stay separate: an unsuspended member with
current health-data consent retains `granted` metadata while product access is
inactive, but Web does not select or decrypt that member's ciphertext and
returns `missing`. Suspension or health-data withdrawal still removes the grant
from this disclosure result. The challenge page may treat that grant as
best-effort social entry only when the
same participant/scope was recorded `not_granted`, the access tool returned an
eligible provider creation second inside the current native send attempt, the
grant activated within 24 hours after it, and the finalized metric, window,
and stakes are unchanged. Link delivery, idempotent replay, reused offers, and
every missing, older, late, or mismatched case require ordinary confirmation.
Health projection
delivery conditionally replaces the complete
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
Ask request and every accepted-input completion are safe to admit through the
runtime's narrow pre-checkpoint system prefix: the detached read has no resident
write or delivery authority, and every completion can use only the existing
output-only continuation or fixed fallback surface. Consented-member requests
still wait for the ordinary checkpoint boundary before starting private work,
but a completed reviewed answer no longer waits for a routine idle snapshot.
The existing causal cutoff, session binding, deterministic outbox key, and
provider-entry authority recheck own ordering and replay safety without a
second checkpoint gate. Each joined-group completion that predates pending personal
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

The `group_sender` adapter is a one-time first-party disclosure path, not a
grant shortcut. The group model supplies only one opaque Message ref from the
accepted inputs in the current group turn. Web reopens the exact encrypted
conversation wake under the synthetic group runtime, revalidates its live
non-direct route, resolves its author through the channel's canonical identity
index, and derives the exact authored text plus a fixed self-only permission.
The transport's optional `senderMemberId` remains attribution metadata and is
never runtime authority. The target must be an active personal runtime rather
than another thread container. A deterministic request id binds the group
runtime, accepted input, and fixed permission; admission, personal-read
preparation, completion, and final group egress all re-open the same authority.
Linq and Telegram repeat that disclosure check at their existing provider-entry
authority boundary; if it has become stale, the outbox durably supersedes the
reviewed answer with the fixed non-disclosing fallback before any provider call.
Textless, oversized, direct, email, stale-route, unresolved-sender,
cross-runtime, scheduled, or replay-conflicting requests fail closed. This path
creates no group, membership, permission, grant, queue, workflow, or table and
grants no future disclosure authority.

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

For a consented member or one-time current-sender target, the private read-only
child receives the exact permission context and produces a candidate from the
member workspace. One separate fresh-context outgoing reviewer receives only that immutable
permission, the question, and the candidate; it has no member workspace,
history, application tools, network, or delivery authority and returns only `allow` or
`deny`. There is no incoming reviewer and no rewrite loop. An allowed answer is
placed on the bound group completion as untrusted data. For accepted-input
requests, the caller group Murph runs one isolated output-only continuation with
the existing room history, resolves references such as “that”, and writes the
actual user-facing reply using only private facts present in the reviewed
answer. The final outbox intent retains the completion id, expiry, and route
proof for provider-entry revalidation. Denial or a candidate-declared
cannot-answer yields fixed non-disclosing copy without another model turn.
Invalid review output, provider failure, or stale
authority discloses nothing and follows the existing retry, expiry, or terminal
lifecycle. A denied candidate never becomes durable operation state. This adds no
fan-out, scheduler, policy engine, result table, or second service.

## Hosted Connected Apps

Connected apps expose exactly three assistant tools: account management, semantic tool search, and execution. `apps/web` owns the Composio API key, durable per-member Tool Router session id, short-lived member-bound connect intents, account verification, server-owned built-in service tool allowlist, server-held OpenWeather authority, server-owned fixed-write allowlist for primary-calendar creation and bounded Gmail/Outlook email sending, and branded OAuth completion UX. The hosted runner reaches that authority only through the existing signed `web-control.worker` boundary; Composio credentials, session ids, OAuth state, OpenWeather credentials, and connected-account provider tokens never enter Codex env or prompts. Composio owns provider schemas and raw execution results for its tools. Murph applies a session-level read-only/non-destructive policy, explicit multi-account selection for connected-account tools, and accountless execution only for server-allowlisted built-in service tools. The existing current-weather tools use direct custom-auth execution through Composio. One fixed web-owned One Call read accepts only bounded latitude and longitude, requests only official national alerts, and returns a small normalized alert projection. It adds no scheduler, state, cache, or user-defined weather threshold. The direct and scheduled alert guidance must not deploy until One Call 3 is active for the exact production key and a signed Web-control smoke read returns a normalized success, including a valid empty alert list. Deploy Web first when activation and assistant deployment cannot happen together. Primary-calendar creation and bounded Gmail/Outlook email sends share one exact server-owned direct-execute policy table. Every route pins its toolkit and provider version, requires agent approval plus an active owned account from that toolkit, rejects missing, blank, unsupported, or server-owned model arguments before egress, and forces provider-owned fields such as the primary calendar, sender, and Outlook Sent-copy behavior. Email sends additionally require current accepted user input in a private direct turn at the assistant runtime boundary; scheduled, group, maintenance, system-notification, and output-only turns fail closed before provider egress. Failed or ambiguous writes are non-retryable; ambiguous email outcomes are reconciled only against a narrow recent Sent-mail window matching the primary recipient, subject, and substantive body, and uncertain results remain unknown.

Hosted group runtimes execute as synthetic thread-container members, not as any participant's personal account. Turn planning derives that scope from the existing conversation audience and makes it part of the thread contract. Group turns omit personal browser, phone, Family, wearable-connect, and connected-account management authority; connected-app search and execution remain only for server-allowlisted accountless service tools. The web control plane independently rejects personal Family, wearable authorization, and connected-account operations for thread-container members. Group-owned management, sharing/join flows, newsletters, and explicitly room-routed automations remain separate authorities; a personal Settings page never configures a room. One structured automation write creates the single group newsletter and stores its delivery choice as a system-owned tag: current-chat editions use the ordinary bound-route conversation outbox, while email editions alone receive the one-shot prepare/send capability. Email preparation derives the group from the signed runtime member rather than a model-supplied group id and persists the private authorization proof plus HTML on the existing assistant outbox parent. The outbox reports an accepted parent to cron immediately, so even a later provider, validation, or persistence error leaves the occurrence in its existing pending-delivery state while retaining the error on the run record. Web marks that parent sent only after durably persisting recipient fanout, and the existing cron reconciler settles the occurrence from the parent state. Recipient intents use only the generic outbox retry lifecycle, so newsletter retries never recompose the body or create a second recipient budget. Because newsletter email `From` identity is spoofable, group-email replies may converse and read current group context but cannot mutate automations, join policy, group presentation, or other durable room controls; those actions require the authenticated group-chat route.

For retained group-participant activity reporting, an authenticated non-direct
Linq or Telegram mailbox wake may carry the internal member id already accepted
by Web ingress. That optional encrypted fact is group-only, immutable
admission-time analytics identity; it is not model input, display data, or
runtime entitlement authority. Direct wakes reject it. The growth projection
uses current blind-index resolution only for legacy wakes and unregistered Linq
participants, falls back to the existing keyed opaque sender identity when no
legacy registration remains, and omits valid group-email wakes because that
channel has no authenticated per-sender attribution. Mailbox content retirement
remains authoritative over analytics: the projection never decrypts a row after
its content-retirement marker is set, reports any affected rolling count as a
lower bound, and withholds a week-over-week comparison when either weekly
window has incomplete group-sender evidence. Missing unretired content remains
an integrity failure. The existing authenticated daily growth snapshot is the
only durable history owner for these anonymous aggregates: at each UTC date it
stores the completed prior-day and completed trailing-seven-day distinct-sender
counts only when their group evidence is complete. These windows use durable
mailbox receipt (`HostedMailboxItem.createdAt`) so a provider event delivered
after the daily capture cannot later rewrite a completed day; provider event
time remains payload/decryption and conversation evidence only. The date-keyed
upsert makes
same-day cron and ops-page retries idempotent. An attribution integrity failure
is reported and creates null activity values only when no same-date row exists;
on retry it leaves any existing activity values untouched while still updating
the snapshot's revenue, member, and message aggregates. The cron returns a
failure after that legacy snapshot write so monitoring and an authenticated
manual rerun can recover the same date; Vercel does not retry failed cron
invocations automatically. The ops-page snapshot-capture branch may also
recover the date before the normal live dashboard read. That read retains its
existing integrity-fail behavior for missing unretired group evidence. Legacy
or incomplete windows stay null, and the existing 30-day snapshot projection
shifts each row onto the completed day its
windows ended instead of reconstructing identities after mailbox expiry. These
metrics count the retained sender population received by Murph at read or
capture time. Account
deletion removes personal and owned group-container rows; activity retained in
another member's shared-group container follows normal content retention
instead of a durable deletion-timestamp trail in anonymous analytics.

External conversation directness is three-state authority. Explicit direct evidence and the local no-route fallback permit private-member context; explicit non-direct evidence permits synthetic group-container context; an external audience with unknown directness is unverified and receives neither authority. One conversation-scope resolver owns that classification. Stored directness applies only to its stored audience, and an allowed session rebind clears it when the audience changes without fresh directness evidence. Unverified inbound conversations receive a deterministic audience-safety reply without starting the provider, unverified notifications skip before every model or exact-text delivery path, and provider planning rejects unverified audiences as a final boundary assertion.

Hosted automation writes use a narrow root-turn tool backed by an invocation-scoped automation port. The already-bound member or synthetic-group runtime vault remains the sole owner of canonical automation records; the tool adds no service, credential, transport, or second record owner. An authenticated hosted conversation may edit, pause, archive, or reactivate any automation in that vault even when the record stores an older route. New records and explicit retargets persist only the trusted current route instead of model-supplied locators or directness; ordinary edits preserve the stored route. Scheduled automation occurrences enter the same conversation turn planner, prompt stack, thread policy, skill surface, and dynamic-tool assembly as attended turns. The stored automation instructions are the user request; occurrence and delivery facts are trusted turn context, and send-or-skip JSON is only the delivery envelope. Tool availability still follows the ordinary invocation's actual ports, audience, accepted-input evidence, and effect-owner checks rather than the trigger origin. A detached `assistant.notification.requested` system event without a valid occurrence is not a scheduled or user turn: it uses an isolated output-only formatter with no conversation history, private context, resume mutation, or tool and network surface, while the platform retains delivery ownership. That formatter runs as a fresh ephemeral thread on the resident App Server; its thread-local deny configuration leaves the ordinary provider-process launch identity unchanged. Unauthenticated group-email replies remain read-only because their audience does not authorize durable room controls, not because they use a separate assistant profile. Explicit arbitrary-route authoring remains a local operator capability. For scheduled Linq execution, the persisted route is only a bounded routing hint: before model or provider work, the existing web egress owner resolves the concrete destination and its direct/group fact. A known group route never falls back to a personal home; a personal or legacy-unknown route may use the owner's authorized current-home fallback. When that fallback selects a live direct thread, the route authority returns both its raw delivery target and its privacy-blinded conversation locator so the same thread selects conversation continuity and delivery. Unresolved authority remains retryable without a marker or manual-repair protocol.

Detached phone-call results and usage-referral celebrations are the only
notification families admitted through the dirty runtime's pre-checkpoint
system prefix. Their server-generated event identities and idempotent delivery
make that latency shortcut replay-safe; generic notifications still wait for
the idle checkpoint. A referral celebration recomputes its current-model
capacity label and receives only a server-resolved tone, Humor, and Unhinged
band, never transcript history. The existing minute recovery pass
re-signals the exact oldest unconsumed celebration mailbox pointers after a
failed Temporal signal, so mailbox state remains the only durable wake owner;
Web does not decrypt or replace their payloads. An authority-less legacy direct
Linq referral wake may already be persisted behind the runtime's advanced
import watermark. The local system-mailbox boundary therefore owns the only
compatibility action: for the exact referral event/dedupe/queue-only/required-
send/direct-explicit shape, it asks the existing signed external-route owner to
assert the frozen member, Linq channel, directness, and target before model
work. Success carries authority in memory through the unchanged audience guard
and provider-entry recheck, with no home-route fallback. A definitive stale
route becomes a typed terminal no-send for the same pending item so lane order
advances; authority-owner unavailability keeps the ordinary same-item retry.
There is no payload rewrite, replacement append, cursor rewind, migration, or
second reconciliation owner.

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

## Hosted Custom Inference

`apps/web` owns one optional encrypted `HostedInferenceConnection` per personal
member. Its selection bit is independent of the member's dormant managed
provider, model, and reasoning preferences. Web verifies a candidate before
replacing the row, projects only revision and bounded capability facts into the
signed workspace response, and resolves the decrypted target exactly once
during invocation preparation. Group thread-container members cannot own or
select this connection.

`apps/cloudflare` revalidates the resolved target, seals it under a
context-separated Worker key, and binds the encrypted envelope to the existing
UserRunner invocation fence. The runner receives only one fixed
`hosted-custom-inference` Codex provider, a revision-derived model alias, and a
non-secret sentinel. Each Responses request must present the existing
provider-egress authority for the same active fence before Cloudflare can open
the envelope, inject the member credential, and call the exact public HTTPS
operation URL. Native Responses streams directly; Chat Completions uses one
stateless request-local TypeScript adapter. There is no second agent runtime,
provider registry, gateway database, inference Durable Object, or managed-model
fallback. Member-funded core usage and Murph-funded tool usage remain separate
authorities on the same invocation fence. The full contract lives in
`agent-docs/product-specs/bring-your-own-inference.md`.

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
exact-successor direct-conversation actor/reply-anchor batch or one authenticated
non-direct group-room batch. Inside the mutation
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
intent sequence. The display projection retains that source sequence while the
runtime applies the approved sparse event by its own mailbox append sequence. A
newer source advances that dial's watermark even
when its visible value is unchanged; an older sequence is a field-local stale
no-op; replaying the same deterministic command identity is idempotent; and a
distinct command at the same accepted-input sequence is applied in command order.
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
mutate it. Group provider and reasoning controls remain unavailable. The
separate room-scoped `murph.assistant_configuration` contract may read or change
only the synthetic room member's model from an authenticated, accepted Linq or
Telegram group turn; it never reads or changes a participant's private
configuration.

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
sole durable owner, and a later invocation rereads the preference there.
For a synthetic thread-container member, the same input-bound path accepts
model changes only. Null retains the existing relation-derived Sol default,
while explicit Luna or Terra choices use the member's existing nullable model
field. Provider and reasoning stay fixed to OpenAI and `low`; no participant
identity, plan state, or private preference enters the room path.
Idle maintenance attributes compaction usage to the model actually bound to the
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
handoff when payment is required. Immediate paid-plan upgrades create a
Customer Portal `subscription_update_confirm` flow for the exact owned
Subscription Item and allowlisted target Price. Stripe owns proration display,
payment collection, payment-method recovery, and authentication before
redirecting to Settings; Stripe webhooks remain the only normal owner that
projects the applied plan into Postgres. The existing Settings authentication
handoff preserves only the allowlisted direct-plan completion or cancellation
return marker when Stripe opens outside the member's signed-in browser; it does
not read billing truth before sign-in, and cancellation is stripped after the
authenticated return. Retired hosted-AI metered items must be
removed by the guarded operator migration before this one-item Portal flow is
enabled. This path adds no subscription table,
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
- `cobuildwithus/murph-cloud` (private external owner): owns the hosted Temporal worker, Workflows, Activities, Schedule/client helpers, production bundle, replay gates, and Render deployment. Public Murph contains only shared pointer-level contracts, Web signaling/status adapters, and the hosted-local external-worker seam; it must not contain a Temporal worker implementation or production bundle. Hosted-local Temporal requires `MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR` to select the private package, or it must be disabled explicitly. Temporal workflow state must not store raw webhook payloads, mailbox bodies, prompts, transcripts, provider responses, provider tokens, dirty resource bodies, or workspace snapshot contents.
- `packages/runtime-state`: workspace-private shared hosted email/env/loopback/id helpers plus pure hosted bundle identity types/equality on the root package, a worker-safe `@murphai/runtime-state/assistant-generated-deliveries` exact-ref contract, an explicit `@murphai/runtime-state/node` subpath for hosted bundle codec/materialization, an explicit `@murphai/runtime-state/node/assistant-state-fs` subpath for assistant runtime-state write/audit/repair permission policy, explicit `.runtime` taxonomy/path resolution (`operations` vs `projections` vs `cache/tmp`), assistant runtime path/security helpers, process scoping, versioned JSON helpers, and SQLite-backed Node-only migration seams
- `packages/core`: workspace-private canonical mutation owner for live local-vault evolution, with current-format canonical reads/writes failing closed on non-current `formatVersion` values; it also owns the shared raw-attachment staging/manifests and canonical event attachment metadata used by document, meal, workout, and measurement writes, the dedicated `addActivitySession` and `addBodyMeasurement` seams for workout-session and body-measurement persistence, provider-agnostic wearable storage repair primitives for proven legacy/debug telemetry bloat, the verified raw-to-gzip transition and streaming gzip read/amendment path for closed monthly integration-ingest shards, and the shared event-spine envelope assembly used by generic events and health-event writes over the single `ledger/events` seam. Public bulk event import accepts legacy payload batches plus explicit upsert/retract decision batches and reconciles strict ISO `externalRef.version` values monotonically at that owner: it orders same-identity decisions by source revision within a batch, ignores retrieval-local provenance for source-semantically equal replay, rejects equal-version conflicts, supersedes newer same-kind values, tombstones and replaces newer kind changes, and tombstones newer retractions. An unseen retraction is persisted as an invisible deleted source marker in the same event ledger, preventing stale resurrection without a parallel watermark store. Blood tests stay canonical `kind: "test"` records behind a projected user-facing view.
- `packages/importers`: workspace-private ingestion adapters that parse external files or provider API snapshots, normalize them behind registry-based adapters, and delegate all writes to core; the clinical FHIR adapter validates each raw page exactly once for file integrity, declared resource family, manifest patient plus FHIR-base binding, same-base root-reachable pagination, and FHIR modifier semantics before emitting one upsert, retract, or review decision per resource
- `packages/device-syncd`: workspace-private local device OAuth/webhook/reconcile runtime with an authenticated localhost control plane, optional separate public callback/webhook ingress, a reusable shared public-ingress core for future hosted/tunneled callback surfaces, the canonical `@murphai/device-syncd/client` control-plane client/contracts surface for workspace or bundled callers, and durable local operational state under `.runtime/operations/device-sync/**` split explicitly into connection identity/config, credential authority state, and observation/reconcile state while normalized provider snapshot imports still flow through importers/core. Provider-owned modules keep auth, refresh, scheduling, webhook-preflight/admin specifics, and bounded product-needed resource windows; shared ingress/config surfaces stay provider-agnostic, and the provider registry/config/env/job-schema/hint/serialization seams now derive from one shared provider-manifest registry.
- `packages/messaging-ingress`: workspace-private shared stateless messaging-provider ingress package that owns provider webhook parsing/verification, target grammar, supported-message extraction, summary helpers, and sparse raw minimization for transports such as Telegram and Linq without taking on polling drivers, hosted policy, or runtime persistence
- `packages/inboxd`: workspace-private inbox capture ingestion/runtime package that owns the first-class append-only inbox-capture and inbox-attachment-retention ledgers, raw inbox attachment bytes, and bounded text projection while keeping inbox-only cursors, source-specific checkpoints, capture indexes, and audio/video transcription job state in a rebuildable local SQLite projection under `.runtime/projections/inboxd.sqlite`, with inbox daemon/config JSON state under `.runtime/operations/inbox/**`. The current inbox-capture v2 ledger record is the sole committed metadata owner; new captures do not retain a duplicate raw envelope. Message text is bounded to 20,000 characters inline and 64 MiB total; a longer body is one immutable hash/size-verified content artifact under the capture's raw directory, so routine ledger scans do not reread sender-controlled historical bodies. The explicit repair path can prove a legacy envelope equivalent, write any required text content, append its v2 replacement, and receipt-guard delete it atomically. Static hosted callers consume the narrow `@murphai/inboxd/retention` and `@murphai/inboxd/checkpoint` entrypoints so capture persistence remains outside the runner's pre-listen bundle closure. Image attachment bytes are normalized before canonical inbox storage so downstream assistant evidence refs see the bounded canonical image rather than the connector-original image bytes; image inputs that cannot be normalized to an allowed static raster WebP are left unstored. Raw inbox image/audio/video bytes expire after 14 days unless protected by active work or explicit durable save/pin evidence; expiration preserves attachment descriptors and parser derivatives through `ledger/inbox-attachment-retention/**` and projects `retention_expired` to readers instead of treating missing bytes as corruption. Canonical inbox raw metadata also drops size-like provider fields so original attachment or raw-message byte sizes do not survive in the ledger. Inbox is a projection/enrichment surface for search, display, audio/video transcript evidence, raw attachment paths, and debugging context; Codex admission does not stage hidden runtime-only inbox rows. It consumes `@murphai/messaging-ingress` for stateless Telegram/Linq ingress semantics while continuing to own polling connectors, local capture persistence, and the optional inbox-plus-parser daemon composition helpers layered on top of parser-owned runtime contracts
  The media pass may preserve parser evidence temporarily, but unpromoted inbound message content has one inclusive receipt-plus-14-day maximum. The content pass clears capture text/raw fields, out-of-line text, parser bundles, and SQLite/FTS content, and redacts paired legacy/current records after the envelope migrator proves equivalence. Active pending work cannot extend that deadline.
- `packages/parsers`: workspace-private local-first audio/video attachment transcription (local whisper.cpp when installed, plus a config-driven remote transcription HTTP provider used by hosted execution), parser-service helpers, parser-owned runtime/store contracts for media transcription, and one versioned `result.json` bundle per derived attempt under `derived/inbox/**`; it also owns the strict bundle decoder and explicit legacy-attempt compactor, and does not own inbox daemon orchestration or depend upward on `@murphai/inboxd`
- `packages/query`: workspace-private read helpers, export-pack generation, query-local event display-identity derivation, the semantic wearable day-summary and provider-neutral sleep-pattern read models over imported device evidence, the rebuildable local query projection over canonical vault data under `.runtime/projections/query.sqlite` that now backs both `readVault()` and lexical search, the stable reference-graph readers for `bank/library/**`, the pure parser/search/index helpers for derived knowledge pages under `derived/knowledge/**`, and the read-side adapters that consume shared MetricPoint contracts from `@murphai/health-metrics` plus shared health registry projection metadata, event lifecycle/revision collapse helpers, and static lookup-ID family classification from `@murphai/contracts` instead of maintaining duplicate query-local copies. Experiment progress-card sentiment accepts an injected snapshot of canonical biomarker desired directions and keeps that health interpretation separate from experiment-hypothesis agreement.
- `packages/health-metrics`: workspace-private neutral MetricPoint contract owner for health metric definitions, source metadata, unit normalization, display formatting, and selection policy reused by query projections and browser-vault exports
- `packages/vault-usecases`: workspace-private CLI/headless vault usecase orchestration owner over `packages/core`, `packages/importers`, and `packages/query`. It owns command-shaped service interfaces, shared CLI-style input normalization, lazy runtime loaders, assistant-safe vault path helpers, the narrow manifest-receipt/removal seam for derived export packs, and the neutral `@murphai/vault-usecases/vault-services` factory used by CLI, assistant, daemon, setup, hosted runtime, and inbox-service callers that need one composed vault service surface without importing owner internals. It composes the compact Health Commons desired-direction lookup into experiment progress-card snapshots without making query depend on the filesystem-backed Health Commons runtime. It must stay a thin composition layer: canonical record schemas and static lookup-ID family classification stay in `packages/contracts`, canonical writes stay in `packages/core`, imports stay in `packages/importers`, query projections and event display identity stay in `packages/query`, device runtime and control-plane composition stay in `packages/device-syncd`/`packages/cli`, inbox daemon behavior stays in `packages/inboxd` and `packages/inbox-services`, and assistant/session state stays in the assistant runtime packages.
- `packages/health-commons`: workspace-private public Health Commons owner for protocol pages, biomarker pages, source pages, source-backed health guidance and symptom-safety decisions, exact protocol revisions, generated catalogs, a read-only generated SQLite FTS claim projection that resolves a full health question to one authored topic before retrieving sourced claims, typed-target source findings, and matching safety within that owner, and future aggregate outcome summaries consumed across local and hosted surfaces. Assistant skills must not become a second owner for topic-specific public health knowledge; they remain for tool procedures and stateful product workflows.
- `packages/assistant-engine`: workspace-private headless assistant execution runtime that owns provider-turn execution, tool/runtime assembly, assistant state/outbox/status/store surfaces, assistant automation, the single assistant input spine, assistant-specific vault/inbox/knowledge tool surfaces, hosted computer-use dynamic tools, Murph-managed package skill assets under `skills/**`, attachment prompt-bundle audit support, and active-outbox reconciliation for assistant-owned one-time delivery staging under the exact flat assistant-runtime generated-delivery directory. Broad low-frequency native tools keep their argument contracts and set Codex `deferLoading` at `thread/start`, leaving direct-model `tool_search` and code-mode `ALL_TOOLS` discovery to the pinned App Server rather than adding a Murph-owned discovery protocol. The stable assistant prompt may route to those package-owned skill files through `$MURPH_ASSISTANT_SKILLS_ROOT`; local and hosted runtime env setup stamps that var to the canonical package-owned skill root. Hosted native Codex skill rendering stays disabled because rendered runner-local paths can break hosted prompt-cache stability. It consumes neutral vault usecase services, runtime loaders, and assistant vault path helpers from `@murphai/vault-usecases`, and consumes provider-target normalization plus hosted provider-preset/config helpers from `@murphai/operator-config` instead of owning duplicate copies.
- `packages/operator-config`: workspace-private operator and setup configuration surface that owns persisted operator defaults, hosted assistant config, assistant backend target normalization, hosted provider-preset/config helpers, setup/runtime-env helpers, device/channel readiness helpers, and CLI/shared command contracts
- `packages/assistant-cli`: workspace-private CLI-only assistant surface that owns the daemon-aware assistant wrappers, assistant command registration, foreground terminal logging, and the Ink chat UI
- `packages/setup-cli`: workspace-private CLI-only onboarding and host-setup surface that owns the setup wizard, host provisioning helpers, AgentMail setup helpers, and assistant/channel/wearable onboarding flows
- `packages/gateway-core`: published transport-neutral gateway boundary package that owns the shared gateway contracts, route helpers, projection/snapshot logic, opaque ids, and event-log helpers used by hosted and future transport adapters
- `packages/assistantd`: workspace-private local assistant daemon package with a bearer-authenticated loopback-only control plane bound to one vault; it fronts steady-state local assistant session/message/status/automation entrypoints directly through `@murphai/assistant-engine` and no longer exposes a local gateway projection/control API
- `packages/assistant-runtime`: workspace-private headless hosted assistant execution surface that exposes one-shot inbox/bootstrap/assistant/outbox/device-sync runtime behavior behind explicit runtime context, owns the canonical hosted runtime launch spec for semantic env splitting, forwarded env profiles, platform-only runtime config, typed resolved config, typed parser toolchain validation, commit timeout, runtime-env projection, and hosted runner executable PATH entries, consumes `@murphai/assistant-engine` and explicit `@murphai/operator-config/*` owner subpaths instead of the umbrella config root, now treats the durable operator `hostedAssistant` config as the only persisted hosted assistant source of truth, consumes shared messaging ingress contracts from `@murphai/messaging-ingress` rather than defining provider semantics itself, stages hosted conversation mailbox input into `AssistantInputEvent` records, may defer intermediate foreground checkpoints, may hot-service only the exact assistant wake projected by the current foreground assistant phase once before the idle floor without publishing a snapshot, and keeps dirty hosted runtime state dirty until the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint succeeds, exports sanitized pending assistant-runtime issue records through the injected runtime platform instead of persisting raw hosted diagnostics in Cloudflare, and expects hosted semantic behavior such as channel readiness and device-sync enablement to arrive as typed runtime config rather than being rediscovered from ambient env in lower layers while Cloudflare's container runner binds image-owned native parser paths inside the container
- `apps/web`: hosted Next.js integration control plane for Vercel-style
  deployments, backed by Postgres/Prisma for device OAuth sessions, short-lived
  hosted device connect intents, opaque public device-connection ids plus
  blind-index ownership mapping, typed durable connection summaries, sparse
  sync signals, token-audit history, hosted member
  core/identity/routing/billing/email-authorization slices, hosted legal
  consent event/grant state, hosted onboarding webhook receipts, hosted Stripe
  receipt/retry state, the canonical hosted AI usage ledger plus monthly
  allowance aggregate, immutable purchase/referral usage-credit entries with
  entry-keyed remaining projections plus their bounded member projection,
  conversational usage-referral state, an anonymized hosted assistant-runtime
  issue sink with retention metadata and no member relation, anonymous-by-default
  hosted product-feedback rows, encrypted hosted mailbox rows, signed hosted user
  crypto root-envelope rows/audit events, hosted workspace checkpoint
  metadata, hosted computer runs/handoffs with one member-scoped Kernel profile
  name, and redacted hosted runtime logs/status. It is the canonical owner of
  hosted product and control facts, including legal consent, product-feedback
  intake, device-sync authority, referral
  attribution/qualification/reward authority, and hosted computer-use browser
  lifecycle/checkpoint state. Temporal owns execution wake orchestration, and
  the app-local Vercel OIDC adapter remains for browser/session/status/deletion
  calls into Cloudflare.

  The shared public footer may read incident.io's fixed, public, bodyless,
  queryless status summary directly from the browser. The response is display
  evidence only and creates no product, incident, or availability authority.
  Hosted Web keeps the global referrer policy at `strict-origin` and limits CSP
  connectivity to the exact status-page origin, so the request carries no page
  path, query, fragment, account data, prompt, health content, or message
  content. Ordinary browser technical metadata still reaches incident.io and
  is disclosed in the public subprocessor register.

  Nullable hosted-member model and reasoning preferences are web-owned,
  billing-gated control facts. Active personal members may select Luna or
  Terra; only an active paid Edge personal member may select Sol. The common
  reasoning set is `low`/`medium`/`high`/`xhigh`, with Terra and low represented
  by absent personal overrides. Synthetic thread-container members derive Sol
  from their existing relation when the nullable model field is absent and may
  store an explicit Luna or Terra room override through accepted group input.
  Their provider and reasoning remain fixed to OpenAI and `low`. The signed
  hosted-workspace read projects the resolved personal or room model to
  Cloudflare for the next invocation; a running turn keeps the target it
  started with, and neither the vault nor the hosted workspace snapshot stores
  a second preference.

  Monthly and valid in-window trial allowance remain measured and noticed,
  retaining requested-model and served-model attribution. Subsequent
  usage-bearing work is denied only when included capacity and generic usage
  credit are both exhausted; the crossing operation may finish, and accepted
  input remains durable and pending. Included capacity is consumed before
  carryover credit. The beneficiary row lock is the sole serialization point
  for usage-credit grants, purchase reservations, debits, projection
  adjustments, the compact balance/version projection, and relevant
  checkout/refill admission; base allowance remains separate. An admission
  path that also locks a distinct payer takes the beneficiary lock first. A
  beneficiary may occupy at most 32 grant slots: a positive active grant
  projection or an unfulfilled purchase whose provider-final release marker,
  `grantSlotReleasedAt`, is null. Every shared capacity inspection reads at most
  33 combined occupied rows; a 33rd fails closed as overflow. Grant projections
  carry immutable beneficiary/FIFO identity behind a partial active-grant index,
  and unfulfilled reservations have a matching partial beneficiary index, so
  those bounded reads do not scan zero-balance or terminal history. At the boundary,
  purchase fulfillment may replace only its exact reservation; an unreserved
  grant is rejected. Settlement similarly locks and inspects at most 33
  positive grants, rejects more than 32, and computes FIFO allocation with
  window sums. The same data-modifying SQL statement updates affected grant and
  purchase projections set-wise, updates the beneficiary projection once, and
  inserts every debit.
  Replay reads at most 33 debit rows and rejects more than 32 before bounded
  validation. Refund and dispute convergence performs one final shared capacity
  inspection after all signed adjustments; crossing the slot boundary rolls the
  transaction back before the Stripe receipt binds so its existing retry owner
  can replay. Purchase and referral producers share that immutable ledger; only
  purchase-backed entries participate in Stripe refund/dispute reversal, while
  earned referral rewards are final. Web derives Settings and read-only
  `murph.plan_usage` from that same owner without persisting a forecast or
  granting runtime billing authority; synthetic thread containers receive a
  bounded unavailable result rather than personal plan facts.

  A genuinely new personal, Family, or group purchase that reaches the 32-slot
  boundary returns the distinct `HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT` HTTP 409;
  true eligibility failures remain 403 and exact purchase replay resolves before
  capacity admission. Group funding preflights that serialized capacity before
  Customer preparation, then revalidates after preparation before reserving a
  slot. The shared top-up dialog maps only that exact code to a truthful temporary
  block with no alternate-amount suggestion.

  Personal and exact Family-member top-ups use the server-owned $5, $10, or $25
  one-time offers. Hosted-group funding keeps the same purchase owner and
  payer/beneficiary split, but its primary flow is a durable payer authorization
  for one group with a $5, $10, or $20 calendar-month maximum. Activation is an
  ordinary $5 usage-credit purchase available at any current group-capacity
  state. Later purchases are deterministic exact-$5 `HostedUsageCreditPurchase`
  rows admitted only at the existing beneficiary-serialized
  settlement/capacity seam when capacity is low or exhausted. Ordinary
  automatic refill admission returns no refill at 32 occupied slots; overflow
  is an invariant failure. The authorization stores status, selected cap, and
  anchored period only; fulfilled
  plus pending purchases derive the current-period commitment, while
  `HostedUsageCreditEntry` remains the sole balance and carries unused credit
  across sponsorship periods. A partial unique database index permits only one
  live automatic sponsor per group.

  Current-policy personal and Family purchases resolve the exact Murph billing
  Subscription whose Customer matches the purchase. Hosted-group funding has no
  required Murph billing Subscription and may use the attached Customer default
  or the only attached card. The initial purchase establishes the reusable card;
  automatic refills reuse the existing saved-card PaymentIntent, bind-before-
  confirm authority check, verified Stripe-event grant, refund/dispute handling,
  and runtime recheck. Refill admission under the beneficiary lock is the
  linearization point for need and cap headroom: the deterministic purchase is
  the durable exact-$5 reservation. The provider sweep later rechecks the
  authorization, period, cap, purchase identity, and runtime access, but does
  not reinterpret need after admission or hold a database transaction open
  across Stripe I/O. Any credit not ultimately consumed carries forward. The
  existing minute Stripe sweep dispatches admitted purchases post-commit; ambiguous
  provider outcomes retain the deterministic purchase, while safe card or
  authentication failure marks the authorization recovery-required and privately
  notifies only the payer. Same-period payer recovery reuses the failed purchase
  only while its exact $5 still fits under the current cap; otherwise it leaves
  that history failed and reactivates at cap without provider work. Period
  rollover is lazy and activation-anchored, including end-of-month behavior.
  Cap increases require explicit payer confirmation; a decrease below already
  committed charges is deferred to the next period. Only the activation
  purchase may own a public sponsorship moment; refills are silent. The
  sponsorship projection exposes only sponsored versus unsponsored. A separate
  room-public usage read may expose one bounded
  `includedUsageUsedPercent`: Web derives it only from current-period included
  spend and the room's included limit. It never reveals payer, cap, charges,
  credit balance or source, remaining capacity, period dates, message counts,
  or refill state or events. Only
  verified Stripe-event reconciliation can grant purchased credit; a browser
  return or synchronous PaymentIntent response
  cannot. Conversational referrals instead require explicit arming by
  one trusted current sender, reserve both rolling caps under the beneficiary
  serialization boundary, bind only to that referrer's next newly created
  thread container, normalize Linq and Telegram evidence into one
  provider-neutral qualifier, freeze pre-expiry qualification in the ingress
  transaction, and converge immediate plus bounded minute recovery on
  one fixed server-catalog grant and one source-mailbox celebration fence. A new
  grant clears the current block when capacity becomes positive and requests
  the normal runtime recheck through the durable event owner so pending
  accepted work can resume. Inactive, suspended, or malformed entitlement, and separate daily Linq
  anti-abuse gates, remain enforceable.

  The current group-tool privacy projection is
  `{fundingNeeded,fundingUrl,includedUsageUsedPercent}`. A successful current
  Web projection already proves a positive included limit; an inactive or
  malformed limit makes the whole read unavailable rather than creating a
  second successful shape. Web computes the required integer from included
  usage only: return `0` when counted current-period included spend is not
  positive; return `100` when spend is at least the limit; otherwise return
  `max(1, floor(spend * 100 / limit))`. Credit purchases, referrals, automatic
  refills, carryover, and remaining effective capacity do not enter that math,
  so adding or consuming credit cannot lower or reset the percentage. A new
  included-usage period may reset it. `100` means at least all included usage
  has been used; it does not mean that the room is exhausted because credit may
  remain.

  The runtime requires and preserves the aggregate on the current successful
  shape. A funding-only current response is rejected instead of serving as a
  rollout compatibility shape; the assistant reports quantitative status as
  unavailable and must not reconstruct it from urgency, funding, sponsorship,
  or conversation history. The immediately preceding optional
  `sponsorshipStatus` and the older exact
  `{capacityState,fundingUrl,periodEnd,remainingPercent?}` response remain
  legacy-facing reader branches only. The oldest shape derives only the funding
  boolean; its period, remaining percentage, and funding-setup fields are
  discarded. In the current shape, `fundingNeeded` is false for healthy
  capacity and for low capacity with an available or pending automatic refill;
  it is true for low capacity without automatic recovery and for every
  exhausted room. `fundingUrl` remains the capability for an explicit
  contribution at any valid capacity.

  Assistant policy may disclose the included-used aggregate only after a
  participant explicitly asks how much AI usage the room has consumed or asks
  for the room's current usage status. The answer is approximate and scoped to
  included usage in the current period. Proactive depletion messaging, general
  funding options, and funding requests use `fundingNeeded` and `fundingUrl`
  without mentioning the percentage. The transport returns facts and never
  infers conversational intent. Filesystem-capable group-chat turns load the
  detailed low-usage skill. Group-email turns cannot read that skill, so the
  stable prompt carries only the compact explicit-question contract: one
  `read_usage`, the bounded under-100/at-least-100 wording, authoritative
  unavailability, and the prohibition on remaining-capacity inference. It does
  not grant the spoofable email sender any mutation authority. A Web-owned
  exhaustion projection always appends the current URL to the ordinary group
  pause copy.

  The Web producer, strict runtime reader, and assistant policy ship as one
  product change. There is no strip-only reader phase or rollout-only feature
  flag. A mixed-version Web/runner window may temporarily make this strict read
  fail; that availability tradeoff is accepted. Once both components converge,
  the direct group usage read must succeed. Existing legacy-shape branches may
  be removed only after their producers are neither routable nor rollback
  candidates and every older warm runner has drained.

  The app-local GCP KMS adapter owns web-side root wrapping plus authority
  signing. Hosted billing may store an encrypted unverified Stripe checkout
  email for Settings prefill and transactional welcome or cancellation-feedback
  delivery, but never for account lookup, direct-public sender authorization,
  or email-linked channel state until Privy verifies it. Welcome, internal
  signup, and cancellation-feedback mail retain their existing bounded,
  idempotent Resend ownership; later successful payments must not repeat
  activation side effects, and email paths must not persist provider payloads
  or expose recipients in logs.

  Reserved support escalation uses the existing product-feedback callback as a
  one-turn explicit action. A verified-private request for Murph human support
  authorizes one account-linked call with Murph's bounded, de-identified
  product-only explanation after the reserved prefix; Murph does not first
  display it or ask for separate approval. A generic bug handoff, group, or
  unverified audience does not authorize the reserved shape. The callback keeps
  the linked marker server-authored and the written issue in a separate
  anonymous detail row; the paired detailed-email behavior reads that row back
  before provider entry. This adds no second consent or state owner.

  Web persists that call as two deterministic rows under its existing owner:
  one member-linked row with a fixed server-authored marker and one anonymous
  row containing Murph's bounded, sanitized, de-identified product issue in its
  own words. The first three distinct member escalations per UTC day may send an
  immediate plain-text support alert that pairs that stored issue with the
  internal feedback and member ids. Web reads back and validates both rows
  before provider entry and formats from the first stored issue, so replay
  reuses one body and Resend idempotency key even if a later callback supplies
  different wording. Missing, linked, unsanitized, still-prefixed, or malformed
  detail fails closed. The alert has no raw-message, transcript, or provider-
  payload input and formats only the stored model-authored issue. The model
  contract forbids copied wording and private categories, while the deterministic
  sanitizer remains best-effort rather than semantic proof; the explicit request
  accepts that documented residual risk for the dedicated internal recipient.
  The path adds no table, queue, cursor, approval state, or delivery owner.

  A separate authenticated ten-minute Vercel cron performs work only during the
  6pm Eastern hour and sends one daily internal product-feedback digest through
  that existing Resend transport. Web reads its owned
  `HostedProductFeedback` rows from the prior 6pm-to-6pm window for the three
  server-allowlisted product-feedback kinds and renders fixed server-owned
  kind labels with truthful per-kind totals from a grouped aggregate and each
  displayed row's capture-scrubbed summary, in a bounded,
  deterministically ordered read capped at a fixed row limit with an explicit
  per-kind omitted-remainder line on overflow. Both indexed queries share one
  window filter, and the row read selects only the kind and
  summary columns and never reads the
  member relation or id, internal feedback id, changelog metadata,
  health data, contact data, or raw conversation; summary text entered email
  scope only because capture already bounds it to a product-only summary that
  passed the deterministic contact-detail and secret-token scrub. Recipients
  come from a
  dedicated environment allowlist, and every same-hour attempt reuses the
  Eastern day key as the Resend idempotency key. Missing configuration fails
  before the database read. This adds no digest table, cursor, scheduler,
  retry queue, or second feedback owner.

  Inbound hosted conversation traffic appends one canonical
  `conversation.message` mailbox item with provider/channel detail inside its
  payload. Hosted device-sync persistence stays provider-generic; the signed
  scheduled wake sweep selects due-reconcile candidates and appends bounded
  `device-sync.wake` mailbox handoffs for the Temporal global reconciler.
  Webhook freshness is not scheduler input: Web persists dirty state, appends
  one bounded wake on a clean-to-dirty transition, and the runner drains and
  acknowledges dirty-pending rows through signed callbacks. Hosted provider
  registration reuses the shared `device-syncd` provider-manifest assembly path
  rather than maintaining an app-local provider list.
- Group sponsorship remains an extension of the existing Web-owned
  usage-credit purchase, not a second billing or entitlement system. A group
  purchase may own one encrypted participant-authored sponsorship moment.
  Verified fulfillment activates its optional Web-timed running bit and
  appends one purchase-deduplicated creative notification to the existing
  mailbox. The isolated creative turn exposes only `generate_song`, inherits
  the output-only native-capability deny set, and makes at most one provider
  attempt. It is a fresh ephemeral thread on the resident App Server, not a
  second process. Its application-owned song tool uses the bound provider
  transport for ElevenLabs and Linq API calls and the existing authority-free
  public transport for the validated Linq-issued signed upload; neither is
  projected as native Codex browsing. A committed delivery intent remains
  ordinary outbox work. Web
  projects only the current bit as an optional typed mailbox
  sidecar; `packages/assistant-runtime` attaches it only to fresh,
  route-authorized non-direct group input, and `packages/assistant-engine`
  renders it as low-priority quoted data after rechecking expiry. The vault,
  group-room model, Temporal, and Cloudflare own no sponsorship state,
  financial fact, expiration scheduler, or second delivery queue.
- `apps/cloudflare`: hosted execution plane for ensure-processing requests (callback-signed from the Temporal orchestrator, or Vercel OIDC-authenticated best-effort direct ingress wakes from `apps/web`) plus Vercel OIDC-authenticated browser-vault session, deletion, status, and web-owned Telegram usage-limit notice requests, plus the signed deploy-smoke callback used to verify the managed container image, with per-user coordination via container-enabled Durable Objects, active write-fence wake/replace behavior, encrypted hosted workspace snapshots, legacy encrypted artifact objects, encrypted runner-secret blobs, short-lived DO-local coordination metadata, derived gateway projections, and a native Cloudflare container image that runs one-shot inbox/parser/assistant/device-sync execution through `packages/assistant-runtime`; it owns execution coordination, configured env profile selection, user-secret allowlisting, image-owned native parser tool paths, Worker-owned provider credential injection through runner HTTPS egress interception, and adapter transport details such as local loopback URL rewriting, while runtime launch semantics and profile key sets come from `packages/assistant-runtime`. Web applies its hosted access-and-usage decision before exhausted runnable mailbox work reaches Temporal or the runner. Cloudflare receives no billing or credit projection, cannot grant usage, and performs no Stripe call. Web preserves hosted conversation input before admission, and allowance accounting runs after usage exists. Cloudflare/runner #587 or newer is the permanent rollback floor while Web omits the retired callback route. Cloudflare carries the signed plan-usage read as a transport-only runtime port and cannot select a member, billing action, or usage interpretation; it owns opaque runtime blobs only, not canonical hosted product facts outside the encrypted workspace snapshot, and it may verify signed ingress/runtime root envelopes and unwrap its P-256 recipient wrap without holding GCP KMS decrypt authority; foreground runtime work may defer intermediate checkpoints, the active invocation remains dirty until the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint succeeds, RunnerContainer never records pending checkpoint intent, and activity expiry is cleanup-only
- The same Cloudflare app owns one production database-health singleton that is
  deliberately independent of hosted Web and Postgres. A five-minute Cron
  Trigger asks a SQLite-backed `DatabaseHealthDurableObject` to discover and
  scrape the configured PlanetScale production branch, retain 30 days of
  normalized connection metrics or classified scrape failures, evaluate the
  branch-local PgBouncer and Postgres connection conditions, and page two
  preconfigured direct operator Linq chats. Its SQLite contains only counts,
  ratios, bounded state maps, error-counter baselines, failure codes, and alert
  admission state. Metric families normalize independently: an unavailable
  family stays null and its canonical allowlisted name is retained, while
  available families continue to drive their own conditions. Missing data is
  never treated as zero. A telemetry-only notification opens after two
  consecutive incomplete or failed collections. The first two-check threshold
  window counts incomplete versus unavailable observations, unions only
  canonical missing families observed on partial checks, and uses the threshold
  time as the window end; one bounded evidence value on each existing sample
  preserves that provenance across restart. One bounded obligation in the
  existing incident row survives a busy pending slot, restart, and recovery
  until a telemetry-bearing page is acknowledged. Recovery and another metric
  gap before that acknowledgment coalesce into the same unresolved operator
  notification instead of creating a backlog; the first threshold window remains
  authoritative. An owed telemetry page
  alone does not occupy a closed provider fence. Before an incident admits its
  first page, concrete evidence—including a direct-error delta—that appears on
  the threshold or a later sample persists in one combined immutable body, so
  the exact pressure and truthful
  telemetry facts share the next eligible attempt and one acknowledgment cycle.
  An acknowledged-incident recurrence waits for the eligible sample, which
  includes any still-current unsafe evidence and labels
  historical telemetry by its own observation time. A later complete collection rearms
  telemetry only after the obligation is acknowledged. Its additive alert-state
  and sample-evidence columns
  preserve the existing schema
  version; current code also recognizes a telemetry pending body cleared by the
  prior Worker, preventing a duplicate after rollback and re-upgrade. Concrete
  unsafe conditions retain paced recurrence, but acknowledged monitoring
  evidence cannot enter their later pages without a currently owed obligation.
  First-incident
  and non-replayable direct-error alert
  admission shares one synchronous SQLite transaction with sample/baseline
  persistence; an inside-fence direct-error body excludes co-occurring
  replayable evidence, and acknowledged replayable recurrence is admitted only
  from the current sample once the attempt fence opens. Any direct-error delta
  observed while the single immutable message slot is occupied accumulates as
  count-plus-check-time evidence in the same alert row and transaction that
  advances the persisted sample baseline. After the older message is
  acknowledged, the next run atomically promotes that evidence into the one
  pending message slot; provider pacing still applies, and retry never mutates
  a provider-entered body. Before posting, the monitor resolves both direct
  chats and requires two distinct sole external recipients. Primary recipient
  identity is a prerequisite for secondary provider entry, so an unresolved
  primary identity suppresses both operations while an unresolved secondary
  identity may still allow the primary. Delivery health is independent from
  identity: a known but unhealthy primary destination does not block a healthy,
  distinct secondary. If distinct chats resolve to the same recipient, only
  the primary operation may enter Linq and the page stays pending until
  configuration is corrected. Otherwise the two
  direct-chat deliveries settle independently: the primary retains the existing
  idempotency key, the secondary uses a stable derived key, and a partial
  failure retains the pending page for a later globally paced replay. Only
  acknowledged entry to both distinct recipients clears a pending page. SQLite
  contains no connection URL,
  credential, query, member identifier, phone number, or raw response. This is
  operational monitoring history, never health truth, routing authority, or a
  product control plane.
  The Web-owned reply-latency and durable mailbox-progress monitors remain
  separate Resend-email incident owners and never fall back to this Linq path.
  They share one generic compare-and-set email lifecycle and the existing
  `HostedLinqAlert` storage owner, but retain independent singleton rows so one
  active latency incident cannot suppress a later error-code-independent
  progress stall. The progress read is observability only: it neither advances
  mailbox state nor signals Temporal or Cloudflare.
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

### Cross-platform initial onboarding

Postgres owns the one-time hosted-member onboarding fact through
`hosted_member.initial_onboarding_completed_at`. The migration backfills every
member that predates the field as complete. Its rolling-deploy compatibility
default also marks rows from the still-serving legacy writer complete, while
the current member creator explicitly writes null so new-version members begin
pending. Remove that compatibility default only in a later deployment after
the legacy writer can no longer serve. Every authenticated Home load reads the
canonical fact and renders the flow while it is pending; query markers and Web
session history are not eligibility owners. A user-initiated connection result
temporarily takes foreground priority on Home, then its close refreshes plain
Home so pending onboarding can render without competing dialogs. The iOS
companion reads the same fact through the bearer-only companion route. Optional
contact projection may remove only the contact-card step when unavailable on
either surface; it cannot block the public catalog or the member's continuation
to Health. The native
client receives the closed web-owned persona, voice, tone, and contact-avatar
catalog and keeps only unsaved presentation state; it has no durable completion
flag or parallel catalog.

Persona save and explicit persona skip/dismiss both use one shared transaction.
The transaction locks the member row, refuses to overwrite preferences after a
prior completion, writes all selected style fields through the existing
preference owner, and then records completion. The first surface therefore wins
an app/web race; a stale second surface receives `completedNow: false` and
closes without replaying the welcome state. Contact-card skip merely advances
the flow. Foreground native refresh and a fresh website load both re-read the
same fact. The short-lived native vCard handoff reuses the existing signed card
claim and never makes the app a routing-data owner.

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
and account deletion use that one lifecycle. Replacement remains gated by
active access and current launch consent. An enabled projection remains active
until one of those deletion paths runs. It has three Web-owned,
route-authorized presentation consumers: the model-triggered live participant
roster, the automatic authenticated Linq transcript speaker-label read, and the
signed Linq participant-change context path. Each consults only the human group
owner's projection while the owner still exists, remains unsuspended, and holds
current launch consent. The live roster and automatic read accept at most 16
canonical phone handles; the event path requests only the single normalized
changed handle. The enclosing group route owns admission, so these optional
overlays do not reinterpret the owner's current personal or sponsored billing
after the projection was validly enabled.

After proving the synthetic runtime is active, the automatic read resolves any
exact unique current room membership and its authorized `profile-name.v0`
snapshot. A connected room with no hosted-group row is an empty profile-
membership set, not a reason to skip owner-contact presentation. An exact
canonical phone with no member match, or one unsuspended match without a profile
name, may reach the owner-contact lookup; ambiguous or suspended matches remain
unnamed. A profile name therefore wins over a conflicting contact label.

Participant selection remains independent of durable `hasOwnMurph` activation.
Roster matches are exposed to the model as current-turn participant
`displayName` text. Automatic transcript matches keep explicit internal
`unverified-owner-contact` provenance but render to the model as
`Address-book name (display only):`; participant-change labels remain weak
one-shot context. The stable group prompt treats these values as familiar names
for natural conversational reference without turning them into identity,
membership, consent, routing, profile, invite, signup, delivery, or effect
authority, and they cannot override a registered participant's Murph identity.
Failures omit optional text without changing the truthful roster, signed
participant-change fact, or accepted conversation. The full boundary, deadline,
cache, and rollout contract is recorded in
`agent-docs/product-specs/ios-address-book-advisory-names.md`,
`agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`, and
`agent-docs/references/hosted-runtime-protocol.md`.

### Automatic meal-photo capture

The iOS companion is the only owner of photo-library observation and on-device meal classification. A member explicitly enables the feature, and the companion considers only photos created after that opt-in; the hosted system never receives or scans the rest of the library. Foreground enrollment uses the member's Privy identity token, while background uploads use a dedicated renewable bearer that grants only meal-photo upload and self-revocation. `apps/web` owns one enrollment row per member and hashed installation UUID. Schema-v2 identity mutations carry a positive signed-32-bit `authorityRevision`; the server accepts only a revision newer than that row's high-water mark, except that an exact replay of the current disabled revision is idempotently revoked. Identity revocation upserts a credential-free tombstone even when enrollment has not arrived, so a delayed lower-revision enable cannot restore upload authority. A higher revision is required for an explicit later re-enable. Existing schema-v1 installations remain on revision zero with their prior immediate enrollment, refresh, and revocation behavior, but schema-v1 identity mutations cannot cross a positive v2 fence.

Schema-v2 enrollment is two-phase on that same row. Identity-authenticated `POST` prepares a complete credential at the requested revision with `activatedAt = null` and returns the existing bearer, idempotency secret, and expiry response shape unchanged. The foreground iOS app must durably save that credential before a bodyless scoped-bearer `PUT` activates it, and it enables background capture only after activation succeeds. Upload rejects a prepared credential. Exact-token activation replay is idempotent; activation and scoped bodyless `DELETE` serialize on the member lock and reread the exact current token, so activation followed by deletion ends revoked while deletion followed by activation fails authorization. Activation also locks any active Family membership and group access rows before rechecking consent and access. Family billing locks its owner and active roster members in stable order before changing those rows, so a sponsor or group access loss cannot commit between the activation guard and success and the existing owners cannot deadlock across member and sponsorship locks. A lost enrollment response or a delayed `POST` after trust-boundary teardown can therefore create at most unusable prepared state, never unknown upload authority. Revision conflicts report the current revision and active, prepared, or revoked state without returning credential material.

Web stores only hashes of the bearer and installation UUID plus an encrypted idempotency secret, validates a bounded metadata-free JPEG, and stages the bytes through the internal Cloudflare control client. Prepared and active enrollment rows have the complete credential triple; only active rows have `activatedAt`, while revoked rows retain neither activation nor credentials. Upload reads fail closed on prepared, expired, revoked, or incomplete state. The nullable revision-and-activation schema expansion deploys before fence-aware Web code. Revision-zero rows with a null activation marker remain active during rollout for old-Web compatibility. After the fence-aware deployment is live and prior Web functions drain, the contract migration marks those final legacy rows active, scrubs historical revoked credentials and activation, and validates the row-shape constraints. Only then may a schema-v2 iOS writer ship. Once a positive revision exists, fence-aware Web is the rollback floor. Each upload attempt owns a distinct staged object. Before the metadata-only mailbox append commits, web locks the hosted member and any active sponsorship membership/group rows, then rechecks the same enrollment, active member access, and launch consent. The first accepted mailbox item chooses the canonical object for exact duplicate attempts; losing or failed attempts delete only their own unclaimed object, while ambiguous commit cleanup first reconciles against the mailbox. Postgres, Temporal, and the hosted mailbox receive metadata only.

The post-drain credential-shape constraint is itself a database rollback floor because older Web revocation code retained credential columns on revoked rows. A positive schema-v2 revision independently makes older Web logically unsafe because it could ignore the high-water mark and reactivate a tombstone. Rolling back below the fence-aware deployment therefore requires a forward schema/code repair rather than an ordinary application rollback.

`apps/cloudflare` encrypts each staged JPEG into a private per-user R2 object. Object deletion derives the user-namespaced R2 path directly and does not require the user's encryption context to remain available. The metadata-only `meal-photo.captured` mailbox item wakes `packages/assistant-runtime`, which verifies the object's length and digest, imports one idempotent photo-only meal through `packages/core`, and schedules object deletion only after the workspace checkpoint succeeds. The R2 lifecycle rule makes staged meal-photo objects eligible for asynchronous deletion at 31 days, one day beyond mailbox recovery retention; successful imports still delete staging immediately after the checkpoint, and 31 days is not a guaranteed physical-deletion deadline. Neither the enrollment row nor R2 is canonical meal truth; the member's encrypted hosted workspace remains the canonical record.

That same canonical import ensures one ordinary Murph-managed automation for the member at 9:00pm local time; meal capture has no second automation opt-in and no meal-specific scheduler. Enrollment requires an existing active private iMessage or Telegram thread or a verified email target so that postcondition is deliverable, and each accepted upload carries that Web-resolved direct route in its private mailbox envelope. The first import uses the envelope route to create the automation, while later imports idempotently reuse the same automation record without another service lookup. A direct email occurrence re-resolves the bound member's current verified address through the existing signed Web-control boundary immediately before provider work, so replacement or revocation never leaves the saved address as delivery authority. Reconciliation authorizes runnable conversation or model work normally even when system lag is also present; a blocked model wake can still admit the existing import-only system mode. System-only import checkpoints the ordinary cron wake created by canonical import and then runs the ordinary post-checkpoint staging cleanup. An accepted meal capture is member-wide engagement under the existing 28-day automation policy, equivalent to a direct inbound interaction, so ordinary due automations may resume; AI-usage authorization remains unchanged. At runtime the ordinary automation agent reads one bounded batch of same-occurrence retry evidence followed by the oldest captures that still retain photos, sends a dated catch-up for a late import, includes supported calorie and macro totals by default while still suppressing numbers in eating-disorder-risk, intuitive-eating, or number-sensitive contexts, and invokes the automatic-capture-only `meal remove-photo` command. Its first eligible closeout may also create and explain one paused daily-nutrition proposal after the complete safety and Goal reads pass and the stable managed Goal slug is proven absent; that Goal becomes the existing one-time marker, and later scheduled turns never create, change, or automatically repeat the proposal. Activation remains interactive. The retained photos are the only work queue. A no-photo meal whose removal revision was recorded at or after the current scheduled occurrence remains part of that occurrence's retry, preventing a mid-turn provider or partial-cleanup failure from losing the closeout without adding another state owner. `packages/core` owns the audited mutation: it preserves structured meal truth, replaces retained JPEG bytes with a privacy tombstone, updates the raw manifest atomically, and rejects non-capture meals or changed evidence.

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
- Audio/video transcript outputs under `derived/inbox/**` are rebuildable and never canonical health facts. They may survive an earlier raw-media byte pass, but the owning inbound message-content pass deletes them at the receipt-plus-14-day deadline. PDFs, documents, CSVs, and other inspectable attachment files follow their existing raw-inbox lifecycle unless a user or importer creates durable promoted artifacts; they are not reclassified as message-body text by this policy.
- `bank/library/**` is the stable health reference layer for durable shared entities such as biomarkers, domains, protocol variants, and source artifacts.
- Model-authored compiled knowledge pages under `derived/knowledge/**` are the separate non-canonical, rebuildable personal wiki layer that synthesizes local vault evidence and saved research notes without becoming a second source of truth. `derived/knowledge/index.md` is the content catalog, `derived/knowledge/log.md` is the append-only write log, and `derived/knowledge/pages/*.md` stores the assistant-authored pages themselves.
- Inbox runtime state is split between a rebuildable local projection under `.runtime/projections/inboxd.sqlite` and durable daemon/config JSON state under `.runtime/operations/inbox/*.json`; the projection remains rebuildable from canonical inbox capture records, raw inbox envelopes, and inbox attachment retention records.
- AgentMail inbox ids, outbound email thread bindings, and channel credentials remain non-canonical local/runtime concerns; AgentMail API keys stay in operator environment variables and never belong in the vault.
- Query runtime state is local-only under `.runtime/projections/query.sqlite`, is rebuildable from canonical query-visible vault evidence, and remains strictly read-only relative to canonical writes. Dense provider telemetry does not enter the default query/read/browser/assistant model: generic `ledger/samples/**` shards are explicit import/debug ledgers, `readVault()` and `readVaultTolerant()` materialize sparse canonical product records plus display-grade `ledger/metric-samples/**`, and browser-vault metrics come from compact `query_metric_points` rows rather than hydrated sample entities. Dense metric rows remain lookback-bounded, while sparse lab history uses a dedicated all-history browser projection derived only from collapsed live canonical test events; it preserves structured result facts needed for measured-biomarker history without adding raw reports, notes, raw references, or external identifiers to the browser replica. `readVaultRawTolerant()` is the explicit repair/debug source hydration path and bypasses default projection filtering. In `readVault()`, `family: "sample"` means display-grade `kind: "metric_sample"` product facts only; it must not be used as a signal that generic raw sample telemetry is back in the default read model.
- Durable local runtime state is split explicitly: `.runtime/operations/**` holds non-canonical operational state, `.runtime/projections/**` holds rebuildable indexes/projections, and `.runtime/cache/**` plus `.runtime/tmp/**` stay ephemeral. Canonical vault evolution is a separate seam in `packages/core`: `vault.json`, `CORE.md`, and any future canonical record-shape changes stay there, and non-current `formatVersion` values fail closed while `.runtime/projections/**` stores remain rebuildable and never carry canonical migration authority. `vault.json` itself stays minimal and instance-owned: it stores only `formatVersion`, `vaultId`, `title`, `timezone`, and `createdAt`, while layout paths, shard patterns, and id-prefix policy remain code-owned runtime contract details. Portability is a second explicit axis on top of that taxonomy: runtime paths are either `portable` or `machine_local`, and operational state defaults to `machine_local` unless a more specific classification says otherwise. Device sync runtime state is machine-local under `.runtime/operations/device-sync/state.sqlite`, and Murph's daemon launcher state/logs plus separate private managed control-token and encryption-secret files live under `.runtime/operations/device-sync/`; the control bearer may rotate with daemon lifecycle, while the encryption secret is stable for stored OAuth credential decrypt. Encrypted provider tokens, OAuth sessions, and webhook/reconcile cursors never belong in the canonical vault. Portable operational examples include canonical write-operation receipts and inbox promotion ledgers that must move with the vault's recovery/idempotency context. In the hosted lane, `apps/web` Postgres is the canonical owner of hosted member identity, routing, billing, email authorization, legal consent events/grants, device-sync authority, the hosted AI usage ledger, usage-credit purchases and append-only entries plus their bounded member projection, the anonymized hosted assistant-runtime issue table, anonymous-by-default hosted product-feedback rows, encrypted hosted mailbox rows, hosted workspace checkpoint metadata, hosted computer-use profile/run/handoff state, and redacted hosted runtime logs/status. The product-feedback callback remains authenticated and member-bound for write authority, but the ordinary route discards that identity before persistence; its deterministic id is derived only from the opaque runtime idempotency key, and nullable member linkage is server-controlled rather than model- or payload-selectable. Cloudflare may use narrow signed web callbacks for execution-time device-sync snapshots, computer-use commands, and product-feedback recording, but it is not a second product control plane or a durable device-sync/browser mirror. Hosted onboarding billing refs, legal consent rows, queued Stripe receipts, webhook receipts, mailbox rows, workspace checkpoint metadata, hosted computer-use rows, hosted AI usage rows, usage-credit purchases and entries, hosted product-feedback rows, and anonymized assistant-runtime issue rows in Postgres are operational or idempotency state only, not canonical health truth. Mailbox import watermarks, assistant channel enablement state, outbox truth, turn revision, and runtime timers live inside the encrypted hosted workspace checkpoint owned by the restored local runtime, not in web-visible run rows.
- Local assistant runtime state is non-canonical under `vault/.runtime/operations/assistant/**`, including sessions, transcripts, outbox/receipt artifacts, diagnostics, status, and other execution residue. Durable user-facing memory, typed preferences, compiled wiki pages, and scheduled prompt configuration do not live in assistant runtime state; they live under `bank/memory.md`, `bank/preferences.json`, `derived/knowledge/**`, and `bank/automations/*.md`. The canonical preferences singleton owns stable user intent such as workout unit defaults and desired wearable providers. The hosted mailbox owner serializes one immutable per-member causal sequence across conversation and system lanes at append; each Web-approved sparse preference delta enters local pending state with its own event sequence, while the bounded canonical companion `bank/assistant-preference-mutations.json` retains only each field's last-applied event sequence. The preference value document stays strict and contains no runtime mutation metadata. An older or equal approved event terminally no-ops only its stale fields while non-stale siblings apply, so post-commit replay needs no event receipt, reservation lifecycle, or capacity policy. Distinct conversational commands from one accepted turn receive distinct event sequences and apply in command order. Tokenless legacy pending work is sequence zero: it drains, but cannot overwrite a field already touched by any legacy conversational or sequenced mutation. The canonical runtime projection never reorders emitted deltas by Web timestamps; the Web owner approves sparse deltas before mailbox delivery. The canonical assistant-input selector admits a bounded, cursor-ordered compound batch from one direct conversation and one provider-native reply anchor, or from one authenticated non-direct provider room across actor and reply-anchor changes, only when each positive mailbox causal sequence is the exact successor of the previous one. Every admitted group message remains a separate prompt entry with its own provider sender label, opaque accepted-message ref, text/attachments, and native reply context; if any Linq input has an explicit reply anchor, only exact per-message anchors are used and the unanchored latest-reply fallback is disabled for that compound turn. Foreground starts at the oldest fresh input in the current wake and never pulls older pending backlog ahead of it; background starts at the oldest replyable pending input. Any boundary change, sequence gap, legacy sequence-zero input, or 50-input bound ends the batch and leaves the remainder pending. For web-owned tone/voice updates and local `murph.assistant_style` commands, the runtime forwards the terminal provider-accepted input id from that validated batch; web resolves its live member-owned conversation row and derives the causal sequence. Exact-successor proof prevents the terminal input from crossing an intervening Settings mutation. Actual wearable OAuth/account/runtime state remains device-sync-owned operational state. Session persistence stores one canonical Codex App Server assistant target plus separate resume-state metadata rather than duplicating provider config across multiple runtime records, and turn execution resolves boundary defaults, persisted session target, and per-turn overrides through one explicit execution-plan seam before Codex request shaping. Provider-native resume state is the continuity authority when present: onboarding/bootstrap overlays must not clear a valid provider resume handle, and flat-prompt native-resume providers such as Codex receive Murph's system/bootstrap instructions only on bootstrap turns rather than as repeated resumed-turn user content. Active same-conversation input otherwise follows one lifecycle: the initial hosted mailbox compound batch is frozen against broad rediscovery before Codex starts, but an exact staged input notification may join the live Codex turn when it is the next positive causal-sequence successor and preserves the direct-conversation actor/reply-anchor boundary or, for an authenticated non-direct group room, the room, delivery route, account/audience, projection readiness, and reaction boundary. A projection-pending input is a causal barrier until the existing projection-completion notification retries it; terminal projection failure remains replyable through the normal fallback. Duplicate staging and projection-completion notifications at or behind the newest queued or committed frontier are ignored before successor proof. After the provider acknowledges `turn/steer`, Murph journals and checkpoints the accepted live input before any hosted tool effect or final delivery may proceed; any missing input, gap, boundary change, or missed live window remains pending for a normal later turn. Final-delivery and hosted-tool effect keys use the newest accepted causal input as their stable anchor while answered-mailbox evidence retains the full set; recipient identity is room-scoped for non-direct group delivery and remains actor-scoped for direct conversations. Participant-specific group effects use the existing accepted-message resolver at effect time, derive only provider-authenticated sender evidence from the exact opaque message ref, and leave canonical member resolution plus current membership checks to Web without accepting or persisting a model-supplied member id. Input with a strict active-turn target fails closed when that target is no longer live, and Murph does not replay a completed provider response by synthesizing another provider request inside the same assistant turn. Murph may replay recent raw transcript turns plus bounded sanitized tool/provider audit entries during bootstrap or fallback continuity, and rely on provider-native resume or compaction for continuity, but that runtime context still must never be treated as canonical health memory or vault truth.
- Assistant user transcripts stamp the original inbound receipt on every new entry and expire text only from that stamp. Legacy entries without the stamp are a bounded rollout exception: phase one preserves them because settled-snapshot cleanup may already have deleted every trustworthy receipt join, and phase two may retire them only after 14 complete days of verified stamping-capable runner convergence. Transcript projection time and compacted runtime residue never become receipt authority.
- Assistant-generated one-time delivery staging has one flat runtime-owned ref shape: `.runtime/operations/assistant/generated-deliveries/<filename>`. The assistant may create and adopt a direct single-link regular file there only when the same turn establishes the delivery obligation and calls `send_vault_file` with a semantic provider call id; generated-file calls run on the existing serialized dynamic-tool chain, and missing call identity fails before adoption. Runtime parents are tightened to `0700`, the file to `0600`, and the friendly source is transferred to its deterministic owned ref with atomic no-clobber link/unlink plus exact interrupted-link recovery. This non-canonical private residue is included in encrypted hosted checkpoints while an exact filename/type/size/SHA-256 descriptor is active and is omitted from portable support bundles with the rest of `.runtime/**`. Quiescent pre-checkpoint cleanup first validates the complete flat inventory and outbox state, then removes only terminal, changed, or orphaned owned files; an orphan hardlink removes only its runtime link, while an active hardlink, nesting, unsafe names, symlinks, special entries, or untrusted live inventory fail closed. `exports/assistant-deliveries/**` remains ordinary vault data and receives no ownership, deletion, or packaging-exclusion semantics. The reader-compatible phase-one release is the rollback floor while any persisted outbox or checkpoint can contain the runtime ref.
- Hosted `murph.assistant_style` resolves the selected turn's Humor, Push,
  Detail, and conversational-only Unhinged sequence at mutation time through the signed Web personalization port.
  Web binds the terminal provider-accepted input id from the validated compound
  batch to the callback member and its live mailbox row; persisted assistant-input
  files are never numeric authority. Missing or ambiguous authority fails the
  hosted write closed without blocking the ordinary reply.
- Storage-policy hard line: if a datum is user-facing, queryable, or something future product features will build on, it belongs in canonical vault records or explicit derived materializations, not in assistant runtime. `vault/.runtime/operations/assistant/**` is for execution residue, replay/continuity artifacts, and operator diagnostics only.
- The hosted gateway plane is a derived operational model over inbox captures, assistant bindings, sent outbox deliveries, and approval state. Hosted Durable Objects may materialize hot gateway projections and short-retained event logs for transport-facing reads, but those projections are never canonical health truth and must remain rebuildable from canonical vault evidence plus non-canonical runtime state. There is no local gateway projection/control surface; assistantd stays focused on local assistant control.
- Hosted execution state for `apps/cloudflare` stores encrypted hosted workspace checkpoint refs plus legacy encrypted artifact objects, runner-secret blobs, and per-user coordination metadata. The live v2 snapshot ref is a direct R2 presigned PUT, single-object encrypted `tar.zst`; the Worker only handles JSON start/complete metadata and never receives the snapshot body. Legacy full/base workspace bundles and legacy layered `{base, hot}` or working `{base, delta}` refs remain restoreable during migration, but production foreground execution no longer creates layered or working checkpoint refs and v2 snapshot production does not create artifact sidecars. The v2 direct-R2 workspace snapshot includes canonical `vault/**`, durable operational runtime continuity under `vault/.runtime/operations/**` except explicit unsafe/process-local exclusions, the hosted operator-home directory marker, and only the Codex rollout JSONL files under `.codex-hosted/sessions/YYYY/MM/DD/` that are explicitly referenced by live assistant session resume state with no separate continuity manifest. They do not persist the operator config file; hosted assistant defaults are recreated from trusted platform runtime env after restore so executable assistant selectors cannot be carried forward by workspace snapshots. Hosted Codex config disables Codex-native memory generation and use for every session; any previously generated artifacts are inert, are not product truth, and remain outside the broad checkpoint surface unless an explicit allowlist/inventory is added. Foreground assistant turns do not publish a separate Codex continuity artifact or snapshot pointer; provider-native continuity is durable only through the normal idle workspace snapshot path. Live correctness barriers, including `system_mailbox_receipt`, `assistant_runtime_commit`, `provider_cleanup`, outbox, mailbox import, and active-turn checkpoints, stage local runtime state and terminal evidence without publishing hosted workspace snapshots. `canonical_runtime_commit` uploads exact hosted canonical write receipts to supervisor-owned artifacts and publishes a bounded receipt-log ref through a status-only workspace checkpoint that retains the prior snapshot ref. Restore replays those receipts over the prior snapshot and marks affected context domains dirty; the next idle snapshot becomes authoritative and omits the receipt-log status. `packages/core` `WriteBatch` is the canonical mutation contract for vault writes and emits the exact hosted canonical write receipts. `idle_shutdown` is the only live hosted workspace snapshot producer; its abortable maintenance first replaces valid closed raw integration-ingest months with verified deterministic gzip without changing the one-file-per-month shape, then the v2 snapshot path checks the runtime write fence before direct R2 upload so stale invocations abort before upload. Restore repairs only an exact independently valid raw/gzip interruption residue before foreground work and fails closed on every non-identical closed pair. Excluded local runtime state includes assistant JSONL event logs, device-sync control/token stores, parser executable-selector config, rebuildable local projections under `vault/.runtime/projections/**`, ephemeral cache/tmp state, secrets, quarantine/repair payloads, locks, pid/socket files, operator config, arbitrary Codex auth/credential/cache/tmp/log/history/key/cert/socket/lock files, Codex prompt-history files, Codex SQLite metadata, unreferenced Codex sessions, archived Codex sessions, and local incur CLI defaults. Hosted snapshots keep assistant diagnostics snapshots, status snapshots, runtime budgets, and pending anonymized issue records for continuity while leaving append-only event logs local; routine diagnostic info events are not mirrored into runtime events, and warning/error diagnostics stay in the small recent diagnostics snapshot tail. Hosted Codex continuity diagnostics are derived from assistant session resume state and may expose only counts, byte totals, and keyed hashed rollout-relative names when the hosted log fingerprint secret is configured; they must not expose raw Codex home paths, filenames, prompts, or credentials. Restore sanitizes native Codex resume metadata when the referenced rollout file is absent, does not match the saved Codex thread id, or is not a regular file under `.codex-hosted`, then prunes restored `.codex-hosted` contents back to surviving session-referenced rollout files. Large raw files under `vault/raw/**` are inside the encrypted v2 tar.zst instead of separate artifact refs. Browser-vault snapshots are a separate encrypted hosted sidecar for dashboard use only and now contain a typed dashboard projection bundle rather than a hosted clone of canonical vault entities or a generic read-model payload; workspace checkpoints do not write browser-vault replica refs. Web-owned Postgres stores signed wrapped hosted domain-root envelopes in `hosted_user_crypto_envelope` plus append-only `hosted_user_crypto_audit` rows; plaintext root keys are never stored, web wraps use GCP KMS AAD, authority signatures are verified before use, and the signed worker crypto-context callback returns only ingress/runtime envelopes for Cloudflare's P-256 recipient unwrap. The worker-facing HTTP surface is intentionally narrow: signed Temporal `POST /internal/users/:userId/runtime/ensure-processing`, Vercel OIDC-authenticated browser-vault session, user-data deletion, status, and web-owned Telegram usage-limit notice routes, plus the signed deploy-smoke callback and public `GET /` / `GET /health`. The per-user Durable Object keeps only execution coordination and other opaque runtime metadata in SQLite rather than a canonical queue-history model; the web-owned hosted workspace pointer is the latest checkpoint fence and any Cloudflare bundle cache stays process-memory only. There is no staged dispatch-payload control plane or CRUD seam anymore. Execution-time web callbacks are narrow and signed: the runtime may fetch mailbox rows, fetch signed ingress/runtime crypto context, read/checkpoint hosted workspace state, write redacted runtime logs/status, start a device connect-link, fetch/apply/ack hosted device-sync runtime authority including dirty-pending and dirty-ack state, record bounded hosted product feedback, record hosted Codex auth state, or record hosted usage directly into web-owned Postgres. Temporal owns accepted message-webhook, Cloudflare Email ingress, due-reconcile device-sync scheduled wakes, billing/manual, and browser-vault execution wake orchestration by pointer-only signal after the owning web mutation commits; Vercel Workflow may retry Stripe webhook reconciliation by Stripe event id after local signature verification and receipt recording, but it is not the hosted runtime wake scheduler. Device-sync webhook freshness is dirty-state owned: web persists trace/audit plus per-connection dirty state, appends one bounded `device-sync.wake` mailbox handoff on clean-to-dirty transitions, and completes trace acceptance in the same transaction. The runner pulls and acks dirty rows through signed callbacks. Temporal owns the global device-sync due-reconcile cadence by starting a short-lived reconciler workflow that calls a signed web scheduled wake sweep; that web command reads canonical due-reconcile facts, records due-reconcile wake markers, appends bounded `device-sync.wake` mailbox handoffs, and returns count-only summaries to Temporal. Dirty/stuck rows may be included only when they are due-reconcile candidates; dirty state remains the durable work source, not a separate scheduler queue. Temporal signal failures after post-commit clean-to-dirty webhook handoff are logged instead of failing provider ingress; there is no Vercel mailbox-lag cron or dirty-sweeper backstop, and a DB-backed pending handoff table remains future hardening for exact workflow-start failure journaling. Missing managed crypto now fails closed outside the explicit activation-time provisioning path, and ciphertext envelopes still decrypt by envelope `keyId` through the configured keyring.
- The authenticated Codex-native memory HTTP/WebSocket relay, bounded response parsing, secret-safe diagnostics, and usage-accounting path remain implemented but dormant while the hosted Codex feature, read, and generation gates are false. Re-enabling those gates is an explicit configuration change; infrastructure presence alone does not admit memory work. After a provider terminal exists, the runner makes one bounded usage-recording attempt and reports a secret-safe warning on failure without turning already-completed provider work into a retryable provider failure.
- Foreground assistant automation-directory receipts include an immediate assistant wake in the same status-only `canonical_runtime_commit` that publishes the receipt-log ref and retains the prior snapshot ref. The committed workspace wake is durable product truth; the Web checkpoint route registers its best-effort Temporal recheck as post-response work and never waits on that latency hint before returning the checkpoint.
- Browser-vault replica refresh is normal hosted runtime work, not a detached container side path. Web owns browser-session freshness backstops for missing, unreadable, age-expired, generation-mismatched, or client-known-outdated replica refs and represents refreshes as low-priority system-mailbox runtime work after the browser response; source-hash freshness belongs to the assistant runtime because it can restore and hash canonical query sources. The shared browser-replica contract owns one current projection generation carried by both the encrypted payload and its published ref. Missing or mismatched generations remain readable for deploy compatibility but are always stale; any projection-shape or interpretation change that makes old sidecars incomplete must bump the shared generation instead of adding route-specific checks. Cloudflare stays a thin runner. The assistant runtime builds the replica from the restored `vaultRoot`, uses a stable canonical query-source hash that excludes mtimes and runtime paths, checks the hash again before publish, and may publish an empty current replica when query-visible content was deleted. Replica writes must use the runtime browser-vault store under the active write fence, and the old container `/internal/browser-vault-refresh` path is removed; deploy-skew callers receive an explicit removed response instead of executing a half-removed write path. Before each R2 PUT, the per-user runner records the planned replica ref and the Web-reported ref it may replace as delayed cleanup obligations. Its alarm waits 65 minutes, re-reads the Web-owned current workspace ref, deletes only non-current objects, and retains failed deletions for retry; current replicas therefore cannot use a blanket age-based R2 lifecycle rule. Browser-vault replica writes remain capped at 50 MiB; oversized or wake-interrupted refreshes degrade without blocking foreground assistant work, outbox delivery, runtime-owned idle checkpoints, or runner alarms. Web and Worker/runner skew stays fail-soft by serving readable stale replicas, while generation-bump deploys converge Worker and warm containers immediately so retries publish the current marker.
- Any inbox-to-canonical promotion idempotency must be stored in or derivable from canonical vault evidence, not `.runtime/` alone.
- General assistant/session state belongs under `vault/.runtime/operations/assistant/**`, including local transcript files, per-turn decision receipts, replay-safe outbound intent journals, pending anonymized assistant-runtime issue records, bounded local diagnostics/runtime event logs, diagnostics snapshot counters and recent warnings, persisted assistant status snapshots, and runtime automation execution state plus run history. Hosted assistant provider usage, including the requested and served model reported by Codex App Server, is recorded directly through the hosted runtime platform into the web-owned usage ledger instead of becoming assistant runtime state. Durable user-facing memory belongs canonically in `bank/memory.md`, typed preferences such as workout unit defaults and desired wearable providers belong canonically in `bank/preferences.json`, and durable scheduled prompt configuration belongs canonically in `bank/automations/*.md`; capture-scoped rebuildable audit artifacts stay under `derived/inbox/**`, while durable compiled knowledge dossiers live under `derived/knowledge/**`.
- Assistant tone, voice, and personality values remain canonical in the active runtime's `bank/preferences.json`: a person vault configures that private Murph, while a synthetic thread-container vault configures the room Murph. Nullable `HostedMember` assistant-style columns are the authenticated web mutation projection; only person-member rows feed personal Settings. Web emits strict sparse `member.preferences.updated` deltas, and the hosted system mailbox applies every delta in mailbox order; preference events are never latest-wins snapshots, and an older retry blocks newer deltas so sibling settings cannot be lost. The scheduled preference-handoff backstop selects active people and active synthetic rooms through the same owner-or-current-participant access derivation before its bounded limit, then rechecks canonical runtime access before signaling.
- Hosted core-assistant provider intent is a separate Web-owned nullable
  `HostedMember.assistantProviderPreference`. OpenAI is derived when it is null
  or when the Venice rollout flag is disabled; Venice is projected only through
  the signed workspace read for eligible personal members. Settings and the
  input-bound assistant-configuration tool write through the same Web
  transaction. After an effective Settings change commits, Web sends one
  payload-free `runtime_wake_requested` signal. Temporal coalesces duplicate
  wakes as a boolean and uses the existing Cloudflare processing adapter even
  when reconciliation facts are idle; it stores no provider value. Immediately
  before core provider entry, the runtime re-reads the Web owner; an unavailable
  read defers the accepted turn without provider egress, while a changed
  provider stops servicing further wakes, checkpoints, and hands the pending
  turn to a fresh invocation. The
  vault, workspace snapshot, assistant runtime, Temporal workflow, and
  Cloudflare Durable Object do not keep another provider preference.
- Cloudflare remains the credential and translation boundary for both core
  providers. The runner holds a signed provider/user/runner credential rather
  than either real API key, and the direct Codex child receives only the
  credential selected by `HOSTED_ASSISTANT_PROVIDER`. Provider selection is
  part of the child launch identity so a warm OpenAI process cannot survive a
  Venice handoff. The hosted runtime keeps Murph's Luna/Terra/Sol ids canonical;
  Venice model translation happens only at Worker egress.
  OpenAI uses its existing Responses intercept; Venice accepts only the two
  Responses POST paths and rewrites a canonical
  Luna/Terra/Sol model to the matching regular Venice GPT-5.6 provider id at
  egress. For Codex Responses Lite requests to `/responses`, that same boundary
  restores the standard top-level tool field and marks the end of Codex's
  contiguous leading developer prefix as the explicit prompt-cache boundary;
  it preserves Codex's session-stable cache key and any caller-owned cache
  controls. Compact requests and ordinary non-Codex Responses payloads do not
  receive the compatibility marker. This creates no Murph-owned cache or cache
  state. The shared mapping is code-owned and exposes no duplicate operator
  model variables, so inference and pricing cannot drift independently. Web
  prices immutable usage rows by canonical model plus recorded provider, using
  Venice's distinct input, cache-read, cache-write, and output rates when
  `provider_name=venice`; each pricing snapshot records the matching provider
  model id and provider pricing source. Specialized
  tools retain their existing provider owners independently of the core choice.
- Assistant input follows one spine for local and hosted execution: source adapter -> `AssistantInputEvent` -> `AssistantInputSource` -> scanner/active turn -> accepted-input journal -> Codex. Source adapters may project accepted input into inbox for search, attachments, UI, and diagnostics, but inbox projection success is not the gate that decides whether Codex can see a decoded conversation message. `AssistantInputEvent` may carry bounded prompt-readiness facts such as attachment descriptors and minimized channel source metadata; prompt construction must read those first and use inbox capture/envelope data only as projection enrichment.
- Provider transcript history and channel-native delivery history should stay with upstream adapters when possible; Murph stores local assistant transcript copies, minimal manual aliases, explicit conversation bindings, fixed auto-reply channel enablement state, timestamps/turn counts, provider session references, runtime automation run history, compact system-emitted turn receipts, idempotent outbound intent state, diagnostics counters/warnings, and persisted status snapshots under `vault/.runtime/operations/assistant/**`. Assistant runtime directories must stay private (`0700`) and assistant runtime files must stay private (`0600`). Secret-bearing provider headers for persisted sessions live only in private sidecars under `vault/.runtime/operations/assistant/secrets/**`; the general session JSON keeps only public headers, diagnostics/runtime-event writes redact inline secret material before persistence, and `assistant doctor --repair` can tighten permissive assistant runtime modes in place. Inline secret findings indicate stale local session data rather than a supported migration path. Fresh sessions may inject a small canonical memory block from `bank/memory.md`, and assistant turns now use one shared CLI-first Murph runtime surface plus a small helper-tool layer across manual and message-triggered automation turns. Codex App Server is the hard-cut assistant adapter: it reaches the canonical `vault-cli` surface through native local CLI/filesystem/env authority, defaults to unsandboxed execution plus no approval friction, and is trusted as a local operator path. Assistant-engine keeps one Codex App Server process warm across ordinary turns for the warm container or Node-process lifetime; each ordinary turn is an RPC into that process. Prompts, session/thread/turn ids, delivery routes, and invocation-scoped automation or device authority stay in request data rather than process launch identity. Those capabilities are exposed only through narrow typed tools on the current root turn and are absent from the App Server and descendant shell environments. Process replacement is limited to owner shutdown, process exit, proven unhealthy or poisoned protocol state, explicit operator shutdown, explicit workspace invocation abort/preemption, or a genuine process-level configuration change that Codex cannot accept through RPC. An explicit abort synchronously stops the exact owned App Server before the container job slot can be reused; ordinary turn and invocation completion do not. Codex App Server owns provider-native web-search behavior; Murph normalizes Codex `web.search` events into assistant trace and status output without carrying a separate Murph-side search provider or web-read tool layer. Managed OpenAI standalone search crosses the existing Worker credential boundary only as exact `POST /v1/alpha/search`; the Worker revalidates the provider/user/runner identity, injects the Worker-owned OpenAI credential, and strips runner authority before forwarding it. Accepted inbound channel messages are therefore treated as operator-authorized actions for the bound vault and may use the assistant runtime, canonical `memory`, canonical `automation`, self-target, and vault query/write surface. Murph owns transcript policy, turn orchestration, and tool/runtime planning, while canonical vault records remain authoritative on conflicts.
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

For established hosted conversation work, the first fresh auto-reply-enabled
pre-pass Linq or Telegram input candidate staged after restore and final Codex
config/auth preparation may begin process-only spawn and initialization while
the remaining mailbox work continues. Email, self-authored Linq, bootstrap,
system, maintenance, replay, and active-turn imports do not admit preparation;
the first staged pre-pass conversation decides for the invocation. Readiness is
memoized on the exact process and does not reserve a turn; a matching
foreground turn synchronously reserves that object before joining readiness.
Preparation sends no thread, turn, provider, account, tool, or compaction
request, and launches no detached child. Speculative preparation never evicts
a healthy claimable resident with another launch identity; only authoritative
foreground acquisition may replace it.
The preparation call returns a cancellation handle bound to that exact process,
so invocation release cannot cancel a later replacement. Checkpoint and
invocation-release boundaries first close and join asynchronous preparation
admission, then stop and settle pending unclaimed preparation while ready idle
processes stay warm.
Exact object identity binds cancellation to the admitted process. The existing
engine-owned warm-slot transition lock serializes inspect, exact teardown,
publication or reservation, and workspace-boundary admission. The same owner
marks the full boundary call active, so resident preparation declines and warm
foreground or account acquisition begun while it is active fails busy instead
of queueing a replacement behind that boundary. A caller that already obtained
a slot-transition ticket retains FIFO priority, so the boundary observes that
process or fails busy rather than overtaking it. Process initialization,
foreground readiness, and the potentially long background-work wait remain
outside the lock. No second owner, lock, queue, scheduler, keepalive, or longer
container lease is introduced.

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
detached work alone. When a root replies while its child is still generating,
every later ordinary inbound root turn checks Codex's native parent-thread
completion context again. It incorporates a newly completed relevant result at
most once and never waits or calls `wait_agent` for an unfinished child before
replying. Use, failure, cancellation, or loss of relevance stops rechecks for
that child. Scheduled automation, maintenance, system-notification, and
output-only turns never recheck. This adds no queue, wake, or automatic
follow-up owner. Before publishing a workspace snapshot, the runtime waits for
every exact resident child and checks every touched root and child for
background terminals. The lifecycle owner retains the full child set for each
root until that boundary clears, so one sibling's completion cannot evict
another. A routine checkpoint wake only interrupts that boundary wait and
leaves the App Server plus all resident evidence warm. A timeout or unsupported
lifecycle stops the exact process and fails the boundary closed. Explicit
workspace invocation abort/preemption also interrupts the wait and
synchronously stops the exact process before workspace or job-slot ownership
can be reused.

- Low hosted usage is not a proactive message. Web's existing mailbox allowance check projects an optional coarse low-capacity bit for an allowed conversation batch; the runtime binds it to the accepted input sidecar, and assistant turn context asks Murph to mention it naturally after answering the current request. No balance, price, contributor, or internal accounting reaches the runtime. The hosted developer-policy addition changes the stable assistant contract: every existing native-resume hosted conversation starts one new provider thread on its first turn after deployment, using the existing bounded committed-transcript fallback, and later turns resume that new thread. Exhaustion remains a deterministic notice because denied input cannot start a model turn. Its target is derived after the foreground checkpoint from durable provider-accepted assistant input events: direct Linq and Telegram inputs retain their exact origin; group Linq inputs additionally require exact external-thread route authority. Every accepted input must resolve to the same route, the newest accepted message supplies the reply target, and missing, mixed, or invalid provenance fails closed. The runtime does not keep a parallel mailbox route projection, and a thread-container crossing never falls back to a member home route.

Hosted mailbox payload ciphertext is retired in place at its message deadline.
An unconsumed conversation row becomes a durable content-free policy non-reply
and advances only the contiguous conversation floor; ordinary non-policy
structural tombstones have a separate bounded pruning window.

## Control Flow

1. Operators, automations, and future agent layers call `vault-cli` or package APIs.
2. CLI commands stay thin, validate input, and delegate vault/query/importer orchestration through `@murphai/vault-usecases` service/usecase modules that compose `packages/core`, `packages/importers`, and `packages/query`; inbox and parser flows continue through their owning packages. Canonical mutation flows for experiments, journal pages, providers, events, vault summary updates, and inbox journal/experiment-note promotions must route through typed `packages/core` mutation ports; CLI may keep command UI, device-daemon composition, and read-side lookup/orchestration, but it must not parse/stringify canonical frontmatter or assemble canonical write batches for those write paths.
3. Inbox capture appends the typed `ledger/inbox-captures` fact as the sole canonical intake metadata record, persists only needed raw attachment bytes from Telegram, Linq webhook chats, and AgentMail email connectors, indexes attachments, and enqueues audio/video transcription jobs in rebuildable local runtime state. PDFs, documents, CSVs, images, and other inspectable files are handed to the assistant through raw inbox paths and metadata while those bytes are available; expired raw inbox media projects as `retention_expired` with descriptors, hashes, message relationships, and retained parser derivatives preserved. Generic event/audit projections happen later only when a promotion or user-visible flow needs them.
   Parser derivatives preserved by an earlier media-byte pass remain available only until the owning message-content deadline.
4. Parser workers or parsed-pipeline wrappers consume only those media transcription jobs and publish one rebuildable, versioned result bundle per attempt.
5. Attachment prompt bundling can materialize a normalized capture bundle and image-routing eligibility metadata as rebuildable audit artifacts; live model routing/apply is removed/disabled for this hard cut.
6. Importers may parse and normalize external inputs but must never write canonical vault files directly. Provider connectors normalize upstream payloads into shared device-batch payloads and still rely on `packages/core` for canonical persistence.
7. `packages/device-syncd` owns provider OAuth state, reconnect/disconnect control, scheduled device backfills, and optional webhook fan-in; its control routes must stay loopback-only plus bearer-authenticated, any public callback/webhook ingress should stay isolated from `/accounts/*` and `/providers/*`, polling-first providers remain first-class citizens, provider credentials stay outside the vault, per-account jobs should be serialized to avoid rotating-refresh-token races, and canonical health writes still flow through `packages/importers` and `packages/core`. Provider timeseries sync must stay product-needed, bounded by resource/day windows or cursors, and avoid volatile `now`-shaped snapshots for routine scheduled imports; dense/raw-only streams should be treated as freshness hints or explicit debug imports rather than default vault storage. Its provider-agnostic public OAuth/webhook handling should live in a reusable shared ingress layer so future hosted control planes and local tunnel setups do not fork provider callback logic, while provider-owned modules keep webhook preflight/admin specifics and any provider-specific secrets off generic ingress/env types. Hosted runner startup may read only the boot-safe provider config projection; full provider manifests, importer adapters, and SDK clients stay outside the runner's static boot closure, enforced by the device-sync package's static source-graph test and the final runner-bundle metafile guard. `packages/cli` may start, reuse, and stop that daemon for the active vault, but it should treat the localhost HTTP control plane as the stable boundary rather than reaching through to provider state in-process.
8. Codex App Server-backed assistant chat and outbound channel flows may persist local session metadata, local transcript files, explicit delivery bindings, auto-reply channel state, terminal auto-reply handling evidence, runtime automation execution state, accepted-input journal entries, and derived gateway conversation/message/event projections under `vault/.runtime/operations/assistant/**`, but they must not treat that state as canonical health truth or bypass canonical write boundaries for health data. Durable user-facing memory and scheduled prompt configuration belong in canonical vault records, not assistant runtime. Saved assistant session bindings are monotonic routing facts: lookup may enrich missing channel, identity, participant, or thread fields, but it must fail closed rather than silently rebinding an existing session to a different audience; conversation continuity keys therefore isolate direct, group, and indeterminate audiences even when the provider thread identifier is unchanged. During the audience-key rollout, the store alone recognizes the prior key format: positively direct Telegram sessions migrate in place, while legacy email or Linq sessions whose transcript audience cannot be proved are explicitly reset and their legacy lookup key is retired without deleting the old session record. The first production deploy that can write an `audience:` key must use immediate container rollout and prove the deployed runner-bundle fingerprint before processing user turns; after the first audience-scoped key is written, that bundle is the hard rollback floor because an older resolver can recombine direct and group history. This compatibility path is removable only after old runner bundles have drained and the assistant index contains zero keys without an `audience:` segment. One-off outbound retargeting belongs on the explicit delivery-target override path instead of mutating the saved binding. The local `packages/assistantd` daemon is now an allowed loopback-only bearer-authenticated control boundary for this runtime, but it stays bound to one vault and does not become a second canonical write owner. Current outbound adapters include Telegram, Linq, and AgentMail-backed email; email auto-reply is intentionally limited to positively classified direct threads or signed hosted group routes that resolve to a current grantor and must preserve the inbound AgentMail inbox identity for replies, while Linq replies reuse the inbound chat id thread binding for the local webhook-driven conversation. A signed hosted group email route is not authenticated sender proof and cannot expose private assistant style settings. Generated voice memos are modeled as assistant response media that stores only bounded ElevenLabs transcript/config metadata plus a channel transport reference: Linq attachment ids for pre-uploaded native iMessage voice memos, or Telegram delivery-time generation descriptors for native Telegram voice messages. Raw generated audio bytes are never persisted in Murph runtime state. Assistant automation admits channel input through `AssistantInputSource` and writes terminal reply/deferred/suppression evidence after accepted input is committed; inbox capture remains useful projection evidence but is not the Codex-admission gate. Hosted mailbox imported watermarks prove import only, so a Cloudflare deploy, Durable Object reset, or runner restart after import checkpointing must still replay assistant handling from assistant input plus any available raw capture evidence until terminal auto-reply evidence exists. Once conversation work is terminal locally, the runtime retains its pending-index entry and may publish the exact mapped mailbox item id only with an `idle_shutdown` checkpoint whose snapshot contains that terminal evidence or durable reply intent. In the same successful snapshot transaction, Web stamps only those same-user imported conversation rows and derives the largest contiguous stamped replay floor; a gap therefore stops `consumed_seq` even when a later item is terminal. A later server floor lets the runtime remove the retained local entry without scheduling another reply. Accepted Linq delivery additionally writes the same exact row stamp before checkpoint to close its delivery-to-checkpoint replay window, while Telegram and terminal no-reply paths receive their exact stamp at idle checkpoint. Deployed v1 pending indexes preserve their recorded IDs and recover omitted retained events only when terminal evidence already proves completion; v1-omitted nonterminal history is ambiguous and stays categorically nonreplyable. The first accepted v2 snapshot is a hard runner rollback floor because the preceding v1-only runner cannot read its cursor-bearing envelope. Restart catch-up semantics belong to ingress durability, not assistant scheduling: Telegram can replay provider backlog through update offsets, email only replays messages that are still unread, and local Linq webhook delivery has no backlog if the ingress process was down when the webhook arrived. Assistant automation must stay a pure consumer of persisted assistant input plus its own persisted receipt/outbox/terminal-evidence state, while each ingress path owns its own durable backlog, backfill, or always-on persister. Canonical prompt-backed automations must declare an explicit outbound channel route and always deliver their generated response instead of storing local-only undelivered summaries. Assistant turns now bind the real current user prompt, session id, and turn id on the host side, share one CLI-first Murph runtime surface, and use Codex App Server as the transport for reaching the same canonical `vault-cli` surface through native local CLI authority. Message-triggered assistant turns use that same full Murph runtime surface rather than a bounded read-only profile, so any accepted inbound channel message can inspect runtime state and canonical vault records for the bound user and vault. Assistant runtime receipt/outbox/diagnostics/status mutations stay serialized under one shared assistant-runtime write lock, and due canonical automations execute only while `vault-cli assistant run` is active for that vault.
   Message content in assistant input events and user transcript entries uses the same receipt-anchored 14-day deadline. Pending accepted work becomes terminal suppression before its content is redacted, and transcript entries persist the original receipt separately from their later transcript creation time so queue delay cannot restart the clock.

Assistant response cards are singular outbox-owned presentation siblings, not a
new delivery primitive. The daily-nutrition V1 contract remains readable for
retained effects and already-sent messages. V2 keeps the same card kind and
adds canonical fiber totals plus nullable frozen goal snapshots. Targets come
only from current active canonical goals; the one-message semantic status is
not persisted goal progress. Ordinary private-direct interactive turns, exact
private-direct scheduled turns, and the managed meal closeout share this one
attachment tool. Scheduled use requires saved instructions that explicitly
request a card; occurrence authority alone is not card intent. Because a card
replaces the whole final response, it is only
eligible when the card alone completely satisfies the current request. New
accepted input in the same live turn invalidates an earlier card-only decision,
and attachment is rejected after the delivery context advances. Every
card copies the immediately preceding single-date canonical meal-totals read.
Both versions use the same deterministic text fallback, Linq capability
boundary, and existing outbox idempotency lifecycle. Hosted inbound routing
keeps the opaque conversation locator used for continuity separate from the
trusted provider reply thread. Ordinary auto-replies pass that provider route
once as a thread binding rather than copying it into an explicit target, so the
existing direct Linq chat owns native-card delivery without a reverse map or a
new-chat workaround. Same-route inputs accepted during the live turn may update
the reply message, reaction capability, and delivery idempotency inputs, but do
not recreate the explicit-target override or replace the turn's thread binding.
Linq explicitly requests interactive transcript rendering. A recipient with
the shipping Messages extension sees the extension-owned SwiftUI balloon; a
recipient without it, including Messages on macOS, sees a provider-owned static
layout with a generated image that mirrors the same compact native presentation.
Nutrition images retain the calorie ring and metric row while remaining
rectangular and badge-free so the provider owns the outer mask. The installed
Messages extension retains its native icon and interactive identity. The
provider request omits the optional App Store id so app-absent static cards do
not substitute square App Store artwork into the wider Messages icon slot.
Their concise native caption keeps only the date and meal count instead of
repeating visible totals or target amounts. Each assessed V2 goal keeps one
concise directional label inside the image without relying on color alone;
null and unavailable goals stay absent, and a short subcaption appears only
when some totals are partial. Compact-table images retain the table grid or workout
progress and exercise rows. Their provider chrome stays bounded to the title
plus an optional generic subtitle or derived workout progress rather than
repeating the raster's rows and sets. Complete semantic text remains available
through the deterministic text renderer and value-free recovery fallback.
The nutrition image derives a quantitative calorie arc only from a complete
total and an assessed non-null goal; V1, partial, null-goal, and
unavailable-status snapshots retain only the neutral ring track. The extension
URL keeps the immutable V1, V2, V3, or V4 snapshot in a bounded Base64URL
fragment that the extension decodes offline. The static image URL carries that
same bounded presentation envelope in one queryless path so the Web image route
can render it and Linq can rehost it. V3 strips its canonical tracking reference
before either encoding, and V4 contains no canonical event reference or write
authority. Encoding is not encryption: either representation may contain only
the same private-direct card values and never member identity, canonical record
references, credentials, or other authority. The image route performs no
database or remote read, writes no application log or analytics event, returns
private no-store/no-index headers, and rejects malformed input before reading
render assets. The fallback body remains value-free and names a truthful
text-recovery action to avoid Apple data-detector downgrade. No persisted card
state, authenticated card API, cleanup owner, extension network read, or second
queue exists.

Assistant image media has an explicit public/private type boundary. `image`
contains an intentionally public fetchable URL, while `vault_image` contains a
normalized vault ref plus hash, size, filename, and allowlisted image MIME
metadata for Murph-owned private bytes. Because a model relays that descriptor,
the attachment boundary reloads the selected vault ref and derives canonical
byte metadata before accepting response media. The trusted descriptor survives
outbox persistence and restart, and final delivery reloads the bytes again to
prove they have not changed before provider dispatch. Signed or short-lived
URLs are delivery capabilities, not valid private-media storage
representations.

Provider-native thread continuity is not a delivery ledger. Preserve a resumable Codex thread even when `finish_without_reply` or delivery-context filtering means its internal history differs slightly from the durable semantic transcript, and preserve it after authenticated private reads. Runtime-owned capability URLs belong only to the ephemeral delivery response: do not put them in the durable assistant transcript, fresh-thread replay, stale-resume fallback, or provider-native turn. Do not clear or abandon provider continuity as a privacy or delivery-reconciliation mechanism; enforce privacy at authority, output, logging, and snapshot boundaries instead.
Hosted group-email assistant replies use the assistant outbox as their single durability owner. The parent effect resolves authorized group members and creates privacy-blind, member-scoped child intents before it is considered sent; the no-send parent planner remains replay-safe through bounded response-body and partial child-intent persistence failures until that durable expansion completes, and stable per-member dedupe fills only missing children after a restart. Each child resolves only that member's current authorized address at delivery time. A deleted group or child whose recipient authority has changed before the provider call is durably abandoned with a typed authority-superseded reason, and transient failures proven to occur before provider entry remain retryable across the runner response boundary, while a lost internal response or liveness failure after the recipient-scoped provider request starts is terminal ambiguity. Successful siblings remain durable when another recipient fails, and an ambiguous child send is recorded terminally instead of replaying the whole group. Production Worker config embeds the prepared runner bundle and source fingerprints. Every warm or cold runner must report those exact fingerprints before a user workspace invocation is admitted, so a stale warm shell is replaced and a stale cold shell fails closed even before post-deploy smoke completes.

The hosted pending-input v2 index persists a capped exact-ack batch cursor in
the same workspace snapshot. It rotates later idle checkpoints without
deleting selected terminal entries until Web's contiguous consumed floor
covers them, so a blocked earlier sequence cannot starve later terminal rows.
That durable v2 envelope makes its producing runner a hard rollback floor once
the first matching workspace snapshot is accepted.

9. Query/export paths are read-only and must not mutate canonical vault state.

The legal-consent subroute inside the companion namespace is shared by the iOS
and Android apps. It records the server-owned `native-companion` source because
Privy authenticates the member but does not attest the requesting platform;
client-supplied platform labels are not audit authority.

10. Hosted health-data processing authority is the current
`hosted_consent_grant` row for `launch.health-data`. Only an explicit
`revoked` row pauses processing; an absent legacy row is not withdrawal.
Settings writes revocation before the required runtime barrier and before
best-effort source and meal-photo cleanup, so AI admission, message append,
runtime usage, source connection,
webhook, scheduled-sync, and companion boundaries fail closed independently.
Before withdrawal succeeds, Web invokes a Vercel OIDC-authenticated Cloudflare
control route whose per-user Durable Object operation serializes with every
runtime ensure, re-reads the Web-owned grant through the signed callback, clears
the execution write fence, and destroys the runner container. Every later
ensure performs the same grant read before starting or waking work. Renewal
waits behind that stop before committing its new grant, then signals the
existing Temporal workflow. Cloudflare persists no consent projection or
second product authority.
Withdrawal retains the account, subscription, and stored data. Export reads the
latest available retained vault replica without waking the paused runtime.
Renewal reuses the existing consent documents and grant owner; disconnected
providers require their ordinary explicit reconnect flow.

Native companion account admission is a bearer-authenticated member lifecycle
boundary, not a device-sync lifecycle boundary. `POST
/api/device-sync/companion/admission` accepts only an optional validated IANA
time zone, delegates canonical identity creation/recovery, historical launch
consent, untouched-member starter-usage enrollment, and active-access assertion
to the existing companion member-access owner, and returns only the fixed
non-identifying success response. This account-only caller suppresses the
ordinary signup welcome while preserving the canonical starter activation and
internal `member.activated` fact, so admission neither assigns a Linq home line
nor queues or emails a welcome. On failure it preserves the stable native
login, consent, access, suspension, and alternate-sign-in identity-conflict
outcomes. Every other retryable owner failure becomes
`COMPANION_ADMISSION_RETRYABLE`, while every remaining terminal setup failure
becomes `COMPANION_ADMISSION_SUPPORT_REQUIRED`. This closed public vocabulary
keeps hosted lifecycle internals out of the Android contract; the client may
retry only the retryable outcome and must not loop the terminal support
outcome. The route must remain outside shared device-sync public ingress and
may not create, resume, reactivate, or otherwise mutate a Junction connection.

11. The hosted `apps/web` control plane accepts provider OAuth and webhook traffic plus authenticated browser and agent control traffic, keeps provider tokens away from browsers, records sparse routing and token-audit state, and owns the hosted member slices plus all hosted control-plane facts in Postgres. Hosted onboarding identity is anchored on the verified phone plus blind lookup keys in Postgres, while `HostedMemberIdentity`, `HostedMemberRouting`, `HostedMemberBillingRef`, `HostedMemberEmailAuthorization`, and `HostedWebSession` keep recoverable member facts and first-party browser app sessions on their owning rows; app-session tokens are opaque to the browser and stored only by hash. Privy is fresh proof for login, linking, and security-sensitive identity operations, while the Murph app session is normal hosted browser auth. When Privy completion carries an existing Murph app session, it is same-member reauthentication rather than account switching: both the fresh Privy user and resolved member must match that app session before a replacement session is issued. The only human browser wearable-management surface is `/api/settings/device-sync/**`, and browser assertion routes such as `POST /api/device-sync/agents/pair` must still rely on short-lived signed assertions with consumed nonces. Native iOS and Android device-sync routes under `/api/device-sync/companion/**` authenticate with a Privy identity token in `Authorization: Bearer` through the same server-side Privy verification as browser sessions (no cookie fallback). Before minting a Junction SDK sign-in token, the companion sign-in route accepts only the closed `ios | android` platform union and applies lifecycle intent against durable connection state through the shared device-syncd ingress path: known same-member passive repair sends `resume` and requires exactly one established row; fresh or unproven legacy iOS installation omits intent, under which durable state resumes exactly one established row or establishes only when zero provider rows exist; and terminal or ambiguous state rejects without mutation. Android's visible Connect Health Connect action and a future visible hosted-health/Junction Reconnect action may send `connect`; passive launch, foreground return, and data ingress may not. The route returns the short-lived token exactly once without logging or persisting it. Companion status may scope to a normalized Junction source. `DeviceSyncSignal.sourceProviderSlug` records that source only when the provider-owned webhook parser identifies an actual data-bearing source; data-less historical completions, lifecycle events, and legacy rows keep it null. Source-scoped status filters both connected-source availability and receipt timestamps, so those null-source rows cannot make Health Connect borrow Apple Health success. The companion health-metadata route accepts only bounded versioned Recovery/Strain records with client-hashed identity inside a 366-day history horizon and 24-hour future-clock allowance, caps pending payloads at 16 per connection, stores each accepted batch as one encrypted dirty payload on the active member-owned Junction runtime lane, and emits a value-free mailbox wake. That active connection is the ingestion authority; source rows are projection evidence used only to disambiguate multiple active Junction lanes, not a prerequisite for the zero-provider-row omitted-intent bootstrap. `device-syncd` validates the closed payload again, preserves Apple HealthKit as canonical provenance with only an unverified WHOOP-metadata hint, and canonical health writes still flow only through `packages/importers` and `packages/core`. The sole pre-login exception is `POST /api/device-sync/companion/auth-diagnostics`: it accepts only a small allowlisted auth-failure envelope, uses the same closed optional platform union with legacy iOS defaulting, re-sanitizes the bounded provider message, writes one structured hosted warning, and applies per-client plus aggregate in-process throttles without persisting identity or contact data. Vercel WAF owns the cross-instance production rate limit for that route; the in-process window is a bounded fallback, not shared enforcement. Hosted onboarding Linq and Telegram webhook ingress verifies provider payloads in the route/service, stores sparse routing in hosted member owner tables, records quota counters where applicable, appends one canonical encrypted `conversation.message` mailbox item with channel-specific payload detail, and signals the per-user Temporal runtime workflow with no raw payload. Cloudflare Email ingress verifies either a signed reply alias for an active member or the fixed public sender route plus trusted sender authentication, stores the encrypted raw message, appends the same canonical mailbox item through a signed web callback, and signals the same pointer-only Temporal workflow through a signed web callback. Raw provider bodies, raw email messages, message content, verification headers, and provider secrets are not Workflow inputs. Cloudflare-bound hosted execution from exact message ingress and onboarding activation must first append encrypted hosted mailbox rows in the same transaction as the originating state mutation. Device-sync webhook freshness records trace/audit plus per-connection dirty state, appends one bounded `device-sync.wake` mailbox handoff on clean-to-dirty transitions, and completes trace acceptance in the same transaction. The runner pulls dirty rows through signed callbacks only when no fresh conversation input is pending. Hosted Linq, Telegram, and email ingress routes return success after durable classification/append or intentional ignore; post-append Temporal signal failures are logged as best-effort handoff failures instead of forcing provider retries. Device-sync webhook routes return success after durable trace/dirty acceptance; post-commit clean-to-dirty Temporal signal failures are logged as best-effort handoff failures, with no Vercel dirty-sweeper cron cadence and no dirty-row recovery sweep. The Temporal-owned global recovery reconciler is due-reconcile-only. Mailbox event-id dedupe and Temporal signal coalescing keep duplicate attempts safe, but web no longer runs a mailbox-lag cron backstop; a DB-backed pending-handoff reconciler remains future hardening for exact workflow-start failure journaling. Web does not own message-processing completion, assistant channel enablement state, same-conversation turn revision, outbox finalization, or internal runtime timers; those remain inside the restored local runtime checkpoint. Hosted device connection persistence stays provider-generic, hosted registry assembly should reuse the shared `device-syncd` config/factory seam, and provider-specific webhook-admin secrets must stay on provider-owned config rather than generic hosted env shapes. Hosted webhook receipts remain retry journals for receipt-local side effects only, not a second dispatch lifecycle owner. Stripe webhook ingress verifies the event and writes minimal receipt state synchronously, then starts a Vercel Workflow with only the Stripe event id; that workflow uses one event-id step to re-fetch Stripe, commit billing plus inline `member.activated` mailbox facts transactionally, perform the explicit activation-time crypto provisioning path after commit, and signal Temporal when activation appended work. Step inputs and outputs remain pointer-only, with member or activation ids re-derived inside the step when a Temporal signal follows a completed receipt. Raw Stripe request bodies, signatures, customer objects, and invoice objects are not Workflow inputs or step outputs. Billing remains monotonic: starter access is activated only by the Web-owned non-expiring starter-usage enrollment service, while `invoice.paid` is the sole positive Stripe subscription-entitlement source. A Family-sponsored direct loser is canceled or refunded only while holding the Family owner lock before the member lock and revalidating the exact active membership, paid Family subscription, and direct Stripe identity; an authority change leaves the receipt retryable and preserves the Checkout attempt so replay can bind direct billing. Paid allowance still requires the paid phase from an accepted invoice, and hosted UI or API reads should follow eventual execution state rather than synchronous Cloudflare responses. Usage-credit Checkout is a separate one-time payment branch: reconciliation verifies the frozen purchase against live Session, line-item, PaymentIntent, Charge, Customer, currency, and mode facts before appending one grant. Browser return and status state never grants credit; an authenticated cancel return may re-fetch and idempotently expire only an open unpaid Session. Matching usage-credit refund or dispute events are intercepted before subscription handling; live re-fetched financial state appends capped signed `refund_adjustment` or `dispute_adjustment` entries under the beneficiary lock, while failures remain in the durable event retry lane and never suspend entitlement.
Direct saved-card funding remains inside that same one-time
usage-credit branch. Reconciliation accepts only the exact PaymentIntent
durably bound to the purchase, re-fetches its amount, Customer, environment,
purpose/version metadata, status, and Charge, and then calls the same grant,
refund, and dispute owners. Browser state and synchronous PaymentIntent
responses never grant credit.

Stripe failure email is a best-effort observability projection at these shared
Web-owned boundaries, not a billing owner. A provider rejection that aborts
the complete website or assistant billing action, a new verified canonical
payment-failure event, and the first failed local event-reconciliation attempt
schedule a plain-text Resend alert through the existing operational sender and
recipient allowlist. Checkout ownership spans its mandatory price read,
customer provisioning, saved-card preparation, and Checkout Session
creation/resume. Paid-plan upgrades, paid-trial transitions, and scheduled plan
switches own their complete provider-backed action in the same way; individual
SDK calls do not independently own email. The
Family direct-paid action derives one complete provider-effect identity from
the current plan, current Price, target Price, and seat count, and a stale
Session restart rebinds reporting to the replacement checkout attempt. Paid
Family capacity changes reuse the exact capacity-update idempotency identity;
member-tier swaps reuse their persisted transition identity. Provider failures
abort those complete actions and alert once, while already-applied capacity,
successful updates, and domain-only conflicts remain silent. Explicit
group-sponsorship recovery is another checkout action owner; a capacity-only
reactivation makes no provider request and remains silent. Family checkout
returns a Murph redirect that performs one final mandatory Session read; a
provider rejection there reports only after the unique blind Session key still
resolves to a current checkout attempt, so unknown or stale public IDs remain
silent. The
central Stripe diagnostic logger is not alert eligibility because cleanup races
and recovery reads also log safely absorbed rejections. Alert content is
limited to bounded error tokens, operation/event type, an opaque stable
operation-attempt or Stripe request/event correlation, HTTP status, and
live/test mode. When an SDK adapter replaces a raw provider error with a hosted
error, only the validated opaque Stripe request id crosses that internal
boundary in a frozen non-serialized correlation record; client-visible details
retain only request-id presence. Member identity, contact details, checkout
contents, raw errors, and provider payloads are excluded. The correlation
parser is a dependency-free Stripe
field boundary: the general onboarding runtime stays free of `server-only`,
Next request-lifecycle, and alert-delivery imports because production migration
line sync and standalone Stripe tooling also import that runtime. Stripe
receipts retain retry authority, and alert configuration or delivery failure
cannot alter checkout results, webhook
acknowledgement, entitlement, or reconciliation state.

Hosted thread routing prepares thread-container domain envelopes, delivery-route
ciphertext, and mailbox ingress roots before the planner transaction.
Telegram sender authority and Linq pending-contact authority resolve
contact-privacy rotation candidates through blind routing indexes to core
member state only; they do not select or decrypt private routing fields.
The Linq AT_RISK home-line and recovered-setup paths genuinely inspect private
home-line state before `BEGIN`; those speculative reads retain a failed root
unwrap only in the existing request-scoped cache so their authoritative
transaction rechecks fail locally instead of repeating KMS under a connection
or authority lock. When an opted-in speculative batch fails during envelope
metadata lookup or verification, it retains that same rejection for every
affected uncached root reference. A later mixed cached-and-uncached request
observes cached failures before starting new metadata or provider work.
Established Linq direct messages resolve only a narrow blind-index/member-id
target and unwrap the mailbox-payload ingress root; established Linq and
Telegram group routes also retain the exact observed delivery-route ciphertext,
prewarm both the active control root used for replacement sealing and any
decrypt-only control root named by that ciphertext, and prewarm the mailbox
root. For an eligible unbound group, Web generates the
synthetic member id, prepares all four domain-root envelopes, pre-seals the
delivery route, and prewarms the prepared control and mailbox roots before
`BEGIN`. Parallel route/mailbox preparation and four-domain candidate
preparation preserve the first observed failure but drain every started sibling
before opening the transaction or finalizing request-scoped crypto state. These
reads and crypto results grant no authority: the planner repeats
route, identity, activation, access, line, pending-setup, and participant checks
inside the transaction. A new route then commits the synthetic member,
prepared root envelopes, container, unique external-thread route, and activation
mailbox wake atomically using the prewarmed ingress root. A version-independent
raw-thread advisory token serializes creation and refresh across privacy-key
write versions; the versioned unique external-thread identity remains the
same-version conflict backstop.
After taking that token, refresh compares the locked row with the exact
pre-transaction ciphertext before demotion, mailbox work, or route decryption.
If the route changes after preparation, Web rolls back and performs at most one
fresh prepare-before-transaction attempt. Matching valid ciphertext opens from
the request-scoped root cache with local AES work; absent or structurally corrupt
ciphertext keeps the existing owning-ingress repair path without speculative
KMS. Thread-container creation therefore does not use the legacy all-domain
provisioning bridge or perform domain-root provisioning, delivery-route sealing,
or activation-mailbox root unwraps while holding its route transaction.
Transaction-owned authority reads remain inside that boundary and may reuse
request-scoped root prewarms when available. In particular, opening a
pending-group setup transfer payload remains a pre-existing transaction-owned
authority read; it is not thread-container crypto preparation.

A private accepted text turn may arm one expiring
`HostedPendingGroupSetup` for a person member's current managed Linq line. The
row is only a one-use transfer envelope: it stores the owner, blinded line key,
timestamps, and one encrypted strict-version payload containing optional sparse
existing assistant-style fields and bounded explicit room-context Markdown. It
stores no plaintext setup, chat id, roster, provider actor, message, contact
label, or participant handle. Before the transaction for the first inbound on
an unbound Linq group, Web performs one bounded current-chat read and resolves
at most 32 active non-Murph roster handles to member ids. Inside the existing
route transaction, a lone roster-matched intent wins; if several match, only
the current sender's own intent breaks the tie. Otherwise the canonical
first-active-sender fallback continues when the provider roster read completed.
An unavailable roster leaves recovery-backed ownership indeterminate and
returns a typed retry before route creation; a completed empty or oversized
roster cannot match another member's setup but may retain the active-sender
fallback. After the request-local existing-route and roster preflight, explicit
suspension or health-data-consent withdrawal prevents route creation and setup
outreach. Other sender inactivity or unresolved sender identity disqualifies
only the fallback; it does not veto a distinct active roster-matched owner. Only
after the prepared-route boundary returns no route may an unknown or inactive
non-withdrawn sender receive the existing group-setup handoff. When first-contact
admission enforcement is enabled, an unknown sender must pass that gate before
setup outreach. The setup must cover the provider event time and remain unexpired
at processing
time. The selected row stays locked through
`ensureHostedThreadContainerRouteTx`, which remains the only route and
`ownerMemberId` owner, and is deleted only when that transaction creates the
route. Only a newly created route applies sparse style through the synthetic
member's existing preference owner and carries explicit room context on the
existing activation wake to initialize the fixed group-room-model page exactly
once before conversation work. Existing-route convergence and transaction
rollback leave the envelope unchanged without compensation; a concurrent loser
re-reads the canonical route and appends its distinct message there. Unreadable
or future encrypted payloads are consumed as unavailable optional setup so they
cannot block an accepted group message. Expiry is query-time authority, and
member deletion removes the intent by foreign-key cascade. Provider add-actor
fields are not ownership authority. For a hard-blocked-line recovery, the
existing delivery attempt is the retry owner: transport must durably record its
provider-accepted milestone before reporting recovery success, and an exact
uncorrelated attempt makes replacement-line admission retry rather than fall
through to first-speaker ownership. That exact pinned recovery alone bypasses
the generic pre-provider claim lease: it replays immediately with the same
provider idempotency key, compares and advances the row's existing `updatedAt`
version, and preserves the original `attemptedAt` as the proof that recovery
preceded the replacement-line event. An uncorrelated recovery provider error
surfaces without locally settling this shared row; accepted correlation or
provider-correlated terminal evidence remains the only settlement authority.

For usage-credit Checkout, one `created` purchase row persists before Stripe
I/O and, together with the single purchase-status lifecycle and stable
purchase-derived idempotency key, permits identical creation retries for a
derived 30-minute window, and fences ambiguity through its frozen 90-minute
expiry. Current-policy personal, Family, and group funding may bind one
unconfirmed saved-card PaymentIntent to that row before confirmation. The payer-row lock is the
linearization boundary: it rechecks active payer and still-created purchase
state. Personal and Family attempts also revalidate the selected exact billing
Customer and Subscription together with canonical status, suspension state,
and last accepted Stripe-event time; a deletion, authority change, or terminal
transition that wins first cancels the unbound intent without confirmation.
Ambiguous confirmation remains
recoverable only through that exact encrypted reference; a definitive failure
must be verified canceled before the purchase can return to `created` and open
Checkout. The existing payer-owned cancel path also resolves a sessionless
direct attempt, while fulfilled sessionless purchases detach by clearing
encrypted payer references and retaining lookup evidence for later
refund/dispute reconciliation. The database constraint for that detached
fulfilled shape requires paid, terminal, reconciled, PaymentIntent, and Charge
proof but deliberately does not require a Checkout Session; the sibling
constraint still requires every payer-encrypted Stripe value to be cleared.
Checkout-entered cards are saved only for later explicit group contributions.
The financial movements described above use only signed
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

Hosted browser wearable OAuth is a same-browser, same-member, same-host
boundary. Start issues one short-lived, host-only callback proof bound to the
provider, OAuth state, member, and app-session generation. The provider callback
GET requires that proof and active session, passes the session member as
`expectedOwnerId`, completes the connection in shared ingress, and redirects
straight back into the app with no interstitial confirmation. A callback
delivered without its initiating-browser proof consumes only the OAuth state
and returns to Connect, so its transferable provider URL cannot be relayed
later. This proof adds no durable state owner and never crosses hosts.

Before constructing shared ingress or starting provider authorization, Web
rejects a callback hostname that differs from the authenticated start request.
Hosted Web build validation applies the runtime precedence to both explicit
`DEVICE_SYNC_PUBLIC_BASE_URL` and its derived hosted-public-origin fallback.
Cloudflare preview and production preflight verify explicit callback overrides;
they do not claim to derive an unset Web-owned callback base. The `__Host-`
app-session and callback-proof cookies remain host-only; do not add a Domain
cookie or cross-host handoff.

Junction's existing setup phase is the account data-admission boundary. A new
account in `pending_link` or `link_returned` cannot accept webhook side effects,
persist dirty work, wake or schedule the runtime, execute queued provider jobs,
or promote itself through sync success. After an account reaches
`source_confirmed`, adding or retrying another Junction-backed source preserves
that account and its established siblings. The target `DeviceConnectionSource`
stays `disconnected` and its webhook and pull work remain inert until callback
completion reaches the runtime connection-established hook. Shared ingress
chooses one closed account write policy for every persistence request:
`replace` for an account reconnect or `preserve_established` for a
source-scoped addition. Hosted Prisma and local SQLite apply the same shared
established-account predicate inside their persistence transactions; neither
adapter may drop or reinterpret that decision. The runtime hook is the sole
source-admission owner: hosted mode commits the source, signal, and mailbox work
in one transaction, while local mode commits the source and initial jobs in one
SQLite transaction. Shared ingress never writes source admission after the
hook. Junction polling lists every upstream source only to resolve provenance:
before projection and every durable summary or timeseries import it rereads the
live source rows, skips projection mutation for a disconnected source, and
removes that source's records from the import. While any source admission is
pending, a record whose source reference cannot be resolved fails closed;
absence of a row for an explicit source remains the legacy admission rule.
Explicit disconnect or a newer connection epoch wins the locked recheck,
fails the stale callback, and leaves the target disconnected. Retry cleanup
deregisters only the target source; whole-account revoke remains the explicit
connection-wide disconnect path. Ambiguous target cleanup blocks the new link
and remains retryable. The hosted Connect surface uses that same split for
removal: an ordinary Junction source card targets the child source route and
calls provider-specific revoke without changing the parent connection,
credentials, or sibling rows. The existing connection-source row carries a
two-phase disconnect fence so callbacks and hosted-runtime projections captured
before removal cannot restore the source. A failed provider revoke restores the
captured source lifecycle and remains retryable; a fresh explicit connect clears
the completed fence before opening the new provider link. That pending-source
epoch is carried as an exact proof through provider Link creation and checked
again before OAuth state is persisted or the URL is returned; a newer
disconnect therefore makes an already-created Link unreachable instead of
publishing stale authorization. Historical-export
reset remains the deliberate connection-wide exception and keeps its broader
confirmation copy. If an already-open Junction Link completes after removal,
the rejected callback advances that same source operation and deregisters only
the obsolete provider authorization, including while the initiating Disconnect
or source-start cleanup is still in provider I/O. The initiating operation
follows the newer exact-source claim before it can report success; a new Link
cannot start while that cleanup is in progress. Repeating Disconnect also
rechecks provider state instead of treating the local fence as proof of remote
revocation.

Native companion work uses the same source row. Source-attributed Apple Health
metadata and WHOOP overnight summaries are admitted only when the exact source
is absent for first use or connected without a disconnect fence, and the hosted
runtime rereads that durable source immediately before canonical import; a
queued job never treats its cached account snapshot as current authorization.
An explicit Apple Health SDK connect captures the exact source epoch before
token mint and opens a pending epoch only if that proof is still current after
mint; an older Connect therefore cannot clear a newer Disconnect. A signed
source-registration event reconciles that pending epoch against Junction's live
provider list and can mark it connected without inventing a timestamp. If the
source or parent was disconnected, the same event performs target-only cleanup
instead. Receipt time and health-record occurrence time are never synthesized
as registration proof, and source admission runs only after the webhook attempt
owns its dedupe trace. Passive SDK resume, omitted
intent, stale events, background uploads, and queued runtime work cannot clear
or bypass a completed source disconnect. Companion WHOOP summaries retain the
`whoop` health-data provenance while authorization is derived from the
disconnectable Junction `whoop_v2` source row.

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

Hosted R2 has one canonical production bucket in ENAM and one isolated preview
bucket. Worker reads and writes, direct-upload presigns, lifecycle automation,
snapshot restore, and account deletion use only that environment-specific
canonical bucket. Account deletion synchronously deletes and proves stable
emptiness in the canonical bucket before it can delete Durable Object state or
report completion. Deploy preflight requires both canonical buckets to report
ENAM Standard. The runtime has no source-region fallback, dual write, migration
phase, storage-specific admission gate, or binding to the retired OC region.

12. The hosted `apps/cloudflare` execution plane accepts ensure-processing requests over its narrow internal HTTP surface — callback-signed from the Temporal orchestrator, or Vercel OIDC-authenticated from web ingress as best-effort direct latency hints for Linq and Assistant Ask request/completion mailbox appends whose trigger is recorded in orchestration latency diagnostics as `triggeredByWebDirect` derived from the authorizing credential — plus Vercel OIDC-authenticated browser-vault session, deletion, and user-status requests, with one additional signed deploy-smoke route for managed-container release verification. The ensure-processing adapter starts, wakes, or accepts pending processing for the exact active write-fenced runtime and returns after that intent is accepted rather than after runtime idle; Cloudflare alarms remain write-fence alarm cleanup rather than semantic schedulers. Browser-vault refresh is hosted runtime work represented by web-owned system-mailbox rows and orchestrated by Temporal, not a separate worker path. There is no Cloudflare Queue wake executor or fallback; duplicate delivery safety belongs to mailbox event-id dedupe, Temporal signal coalescing, exact Assistant Ask request/completion identity, idempotent continuation delivery, and Linq delivery-time `consumedAt` stamps. The direct Durable Object methods restore ephemeral local execution context from encrypted hosted workspace snapshots, inject a method-based hosted runtime platform into `packages/assistant-runtime`, and keep deployment topology app-local. Hosted is a thin containerized runner over the same local runtime input spine: it restores the workspace, stages mailbox conversation rows as assistant input, runs the local scanner/active-turn machinery, imports a bounded same-wake mailbox batch during initial selection or the required pre-scan refresh, freezes that batch before provider start while leaving later rows pending, imports late active-turn mailbox rows through an invocation-local foreground loop, steers same-conversation input into the live Codex turn when one exists, journals accepted input, may hot-service only the exact assistant wake projected by the current foreground assistant phase once before the idle floor while dirty without publishing a snapshot, and keeps the invocation dirty until the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` checkpoint publishes the updated workspace. Mailbox payload decrypt is a narrow Worker-owned runtime write-fence capability: the container calls a mailbox decode hook through the normal `web-control.worker` virtual host, Cloudflare Container outbound interception dispatches it inside the Worker, the Worker verifies the runtime write fence and returns only a parsed hosted wake or blocked result, and the container does not receive ingress root keys, private JWKs, callback-signing private material, or root-fetch authority for mailbox import. The canonical runtime-to-worker authority model is normal internal virtual-host fetches plus runtime write-fence headers, with no public runner callback endpoint; generic side-effect authority is `attemptId`, write-fence generation, and bound user, while workspace version remains only checkpoint/restore compare-and-swap freshness. Provider egress for intercepted OpenAI, ElevenLabs, Exa, Mapbox, Linq, Telegram, hosted data API, and Workers AI transcription calls stays Worker-mediated through Cloudflare Container per-host outbound handlers for default provider/internal hosts, while the catch-all outbound handler remains an explicit open-internet passthrough for arbitrary hosted-agent HTTP/HTTPS egress and runtime-configured provider override hosts. Native child-process integrations for OpenAI, Exa, Mapbox, `murph_data_api`, and `workers_ai_transcribe` receive a signed Murph provider credential in the provider's native credential slot; Worker egress validates that credential's provider/user/runner identity against UserRunner's current active runtime state before injecting the real Worker-owned credential. Generated image turns use that OpenAI egress path for GPT Image 2, persist validated image bytes as canonical capture media under `raw/captures/**`, and emit a hash-bound `vault_image` response-media descriptor. Durable delivery reloads and verifies that vault artifact before provider dispatch, uploads the bytes through Linq's existing attachment API or sends Telegram multipart `sendPhoto`, and never represents the private image as a fetchable URL. The legacy `results.worker/generated-images` route is a `410 Gone` rolling-deploy tombstone so old warm runners fall back to text instead of creating public objects. Generated voice memo turns store bounded transcript/config metadata only; Linq turns upload generated MP3 bytes into a Linq attachment during tool execution, while Telegram turns generate bounded MP3 bytes at final delivery and send them through Telegram `sendVoice` without persisting the bytes. ElevenLabs, Linq, and Telegram credentials stay Worker-owned sentinels in hosted runtime env. Hosted audio transcription is the same Worker-owned shape: the parser pipeline POSTs ffmpeg-prepared audio bytes to the fixed `murph-transcribe.worker/v1/transcribe` host, the Worker authorizes the signed `workers_ai_transcribe` provider credential, exact write-fence proof, or a provider-egress token, calls the Workers AI binding (`@cf/openai/whisper-large-v3-turbo`), and returns only bounded transcript JSON; Workers AI account context never enters the runtime env and the runner image ships no local speech model. Direct invocation mints runner-scoped provider credentials into the explicit supervisor-env projection, the runtime platform attaches exact write-fence headers or provider-egress tokens where the client path can carry them, and Worker secret injection strips runtime authority headers before upstream egress. The open-internet passthrough also strips runtime authority headers and never injects Worker-owned provider credentials. Intercepted providers validate exact write-fence headers, provider-egress token proof, or a runner-scoped signed provider credential; there is no tokenless active-user-fence provider authorization path. Delivery providers (Linq and Telegram) and ElevenLabs continue to require exact write-fence headers or a provider-egress token, so they can only be reached through the runtime's wrapped fetch that routes through the outbound-intent journal owning recipient binding and idempotency. ElevenLabs is constrained to `POST /v1/text-to-speech/:voice_id` with the MP3 output format, Exa is constrained to `POST /search`, and Mapbox remains constrained to allowed read-only GET allowlisted path families. The container supervisor pins Codex, native TLS, Node, Python requests, and curl CA bundle env to Cloudflare's runtime HTTPS-interception CA path, rewires the installed `codex` command to the native binary so the long-lived process is the native app-server, and direct invocation preserves those CA pointers plus Cloudflare-managed proxy env without accepting user overrides for transport settings. The outer native container shell may stay warm per user for the configured idle lifecycle; when Cloudflare reports `sleepAfter` activity expiry, RunnerContainer yields to any active foreground invocation or tears down an idle warm shell, and it never records pending checkpoint intent or posts a host-owned checkpoint job. The private container bridge is reached only through the container Durable Object's internal `containerFetch`, keeps a plain `/health` check plus validated `POST /internal/workspace-invocation`, rejects concurrent workspace invocations, exposes only an internal `POST /internal/runtime-wake` callback into the active invocation, and no longer carries a second per-shell bearer-token layer. The direct hosted invocation uses per-user warm workspace roots with invocation-local writable cache and temp roots. The per-user runner keeps only write-fence state, direct-R2 snapshot upload sessions, and other short-lived coordination state in Durable Object storage while writing v2 checkpoints as a single encrypted object through a presigned R2 PUT URL; the Worker never streams the snapshot body and there is no Worker request-body fallback. Gateway state here is projection or cache only, not a second durable authority. Broad worker control seams are intentionally gone: no generic user-env CRUD route surface, no dispatch-payload CRUD or staged dispatch control plane, no deleted sharing CRUD, no local-vault import payload CRUD, no broad pending-usage store routes, and no mutable gateway control routes. Narrow signed callbacks back into `apps/web` remain only where execution still needs them, such as device connect-link initiation, hosted device-sync runtime snapshot/apply callbacks against the web-owned authority, assistant-configuration reads and mutations against web-owned member preferences, product-feedback recording into web-owned rows, and direct hosted usage recording into the web-owned ledger. Missing crypto fails closed outside the explicit activation-time provisioning path, and platform-envelope key material must still fail startup immediately when malformed.

Within that foreground loop, live steering is limited to exact-successor
input from the same conversation, only until the first completed assistant
response, and to 50 admitted messages cumulatively. Later or overflow rows
stay pending for the next ordinary turn.

The Environment walkthrough reuses that execution plane without turning audio
into a chat attachment. Authenticated Web validates and stages one bounded
application-encrypted recording under the member's opaque R2 namespace, then
appends a pointer-only `environment-voice.captured` system mailbox wake. The
first-seen admission uses the existing AI-usage gate and the member lock limits
each member to one unconsumed Environment recording; exact capture retries
resolve idempotently even when they arrive later. The write-fenced runtime
verifies the staged bytes, applies the three-minute media cap during ffmpeg
preparation, transcribes through the existing Worker-owned transcription effect,
and gives the transcript only to a silent Habitat-scoped maintenance turn.
Canonical Habitat writes checkpoint through the ordinary workspace owner before
a post-checkpoint effect deletes the recording; failed work remains retryable
and the 24-hour R2 lifecycle is only a cleanup backstop. Neither audio nor
transcript becomes assistant conversation history, an outbound message, or
Browser Vault product truth. The open page polls the existing Browser Vault
replica after acceptance to distinguish an updated audit, a transcript with no
clear new facts, and work that is still pending; it adds no second result store.

Hosted dynamic image generation launches as invocation-local background work so
the current tool call returns immediately. Provider work stays detached, while
the canonical capture save waits for an invocation boundary and rebases its
existing receipt checkpoint onto the latest workspace. The exact private
`vault_image` result is upserted on the original accepted conversation route and registered with the
ordinary pending assistant-input index before invocation-local completion state
is released. The existing runtime wake interrupts the dirty idle window, and
the runtime carries the exact ready completion input into the next Codex
admission. When newer conversation input is already waiting, the same frozen
batch places the trusted completion immediately before that input; later input
still joins through the existing live foreground loop. Invocation-local
completion readiness is cleared only when the exact input reaches provider
admission. After shutdown, provider handoff, or an earlier failure, background
or fresh-foreground selection reconstructs the same completion-first batch
from structurally trusted completion events in the ordinary pending input
index. The trusted envelope's existing origin input id bounds the cohort to
same-route conversation events strictly after that origin, so older backlog
and other routes remain pending. The index owns durable retry and terminal
evidence; the immediate assistant wake is only a scheduling hint. Provider
completion starts the existing generic
usage recorder without awaiting it, and image delivery never waits for
accounting or diagnostic writes. A provider rejection keeps the exact legacy
failed result envelope and places its bounded structured OpenAI diagnostic on a
separate runtime-authored line. The new reader presents that private string to
Murph as untrusted provider text that may echo user input, never as instructions;
only the completion provenance and normalized status are authoritative. The
completion turn explains the cause without starting another image operation;
retry requires later user authorization. An older reader still recognizes the
failed envelope, and neither path persists raw provider bodies or credentials. This
adds no durable image job, mailbox kind, scheduler, reservation, allowance
implementation, or image-specific usage lifecycle; unfinished provider work
may be lost with the runner invocation.

Reconciliation evaluates engagement and AI-usage authorization for runnable model work even when deterministic system lag is present. Authorized conversation/default work owns the foreground pass and imports system items before the assistant phase without letting a retryable system item starve fresh conversation. When model work is blocked, or system lag is the only work, the existing `system_mailbox` mode imports only the system lane and returns before assistant execution. It adds no queue, scheduler, cursor, or durable state owner.

Linq group-avatar mutation is the one private-image provider boundary that
requires a fetchable URL. After the group tool preflights current chat
authority, the runtime resolves canonical vault bytes and calls the
write-fenced `results.worker/private-image-urls` effect. The Worker stores one
deterministic application-encrypted object under the member's opaque
private-media R2 prefix through the existing per-user `UserRunner`, where the
write-fence check and staging serialize with account deletion under one
mutation lock, and returns a one-day AES-GCM capability on Murph's fixed Worker
origin for the immediate Linq mutation. The canonical URL ends in
`group-avatar.<ext>`, where the extension is derived from the verified MIME
type. The Worker serves both that path and the already-shipped extensionless
path during rolling deployment and rollback, supports GET and HEAD with the
same successful content headers, and returns no HEAD body. Deletion that owns the lock first
clears the fence so queued staging fails; staging that owns it first completes
before deletion sweeps the object and reports completion. The public GET/HEAD route
decrypts and hash/size/signature-verifies the object, responds with
`private, no-store`, and reveals no member id, object key, storage namespace, or
image hash in the URL. An extension-bearing request must match the decrypted
MIME type. Web and runtime validators accept both Worker URL generations before
the Worker begins canonical minting; rollback reverts minting first and retains
dual-shape serving and validation through the one-day capability lifetime plus
the warm-container drain window. Retry reuses the same object without refreshing its R2
age. Account deletion synchronously sweeps the member prefix; the R2 lifecycle
makes any remaining object eligible for asynchronous deletion after 24 hours
and is not a physical-deletion deadline. Neither cleanup path treats provider
acceptance as fetch proof. That URL is ephemeral provider input, never the
internal media representation, model output, outbox state, or log payload.
For a non-2xx avatar mutation, Web may project only an allowlisted Linq nested
four-digit error code and its fixed first-party recovery message through the
existing `provider_unavailable` tool result. Provider prose, raw bodies, trace ids, private
identifiers, capability URLs, credentials, and headers never cross that
boundary; transport, cancellation, and timeout failures remain generic.
Provider acceptance is only a pending request, not proof that iMessage applied
the icon. Web emits a metadata-only accepted-request timing record and persists
the subscribed `chat.group_icon_updated` and
`chat.group_icon_update_failed` callbacks in the existing Linq provider-event
ledger. Those rows correlate through the private chat lookup key and retain only
the terminal status, provider timestamp, bounded event/trace suffixes, payload
shape/hash, and the documented numeric failure code when present. Icon URLs,
actor handles, raw callback values, and provider prose are discarded. This is
diagnostic evidence only: it adds no retry, mailbox work, user-facing state, or
second avatar lifecycle owner, and it cannot project line or chat health.

Hosted Exa egress is narrower than the path allowlist alone: before injecting
the Worker-owned key, `apps/cloudflare` must validate the exact bounded
`vault-cli research scout` request shape, the `research paper` category, and
bounded non-identifying profile tags, and clamp the caller-supplied publication
window to a well-formed past-or-near-present range. The shared Exa
research-scout request recipe, query shape, and structured-output schema live
in `@murphai/contracts` so local CLI and hosted Worker validation cannot drift.

Hosted Linq typing-start events are verified and parsed strictly. For Linq's
supported direct-chat signal, Web acknowledges before post-response work reads
only the private home-chat blind index plus active access and crypto-root
eligibility, then issues the existing best-effort runtime shell-prewarm hint.
Unknown, ambiguous, inactive, or ineligible chats remain no-ops. Typing never
plans onboarding, binds a route, appends mailbox work, starts processing,
signals Temporal, sends a receipt, or adds reconciliation work. Cloudflare
still rechecks live Web-owned admission under the per-user consent-mutation
barrier before it starts a container, so Web's lookup grants no runtime
authority. The optional Cloudflare owner admits a hint only when its existing
consent-mutation lock is idle; repeated hints and hints arriving during
authoritative ensure, withdrawal, or deletion are dropped before the FIFO.
The single admitted hint then relies on the existing container lifecycle's
coalescing instead of a second dedupe or warm-state owner. The Temporal mailbox
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
fence coalesces runners that overlap in the same invocation. The typing-start
shell hint is the only established-member Web-to-Cloudflare prewarm before
durable message acceptance. The separate
first-contact instant-start shell hint obtains the named `UserRunner` stub
without binding durable state, enters the same per-user consent-mutation barrier
as authoritative ensures and withdrawal, and re-reads live Web-owned admission.
The optional read has a fixed 250 ms deadline, well below the measured 693 ms
provider-start p50 benefit; an unavailable admission abandons the hint and
releases the barrier while authoritative and user-control reads keep their
ordinary timeout. Only allowed admission reserves and binds the exact versioned
container in the existing user-control stop-target field before awaiting the
container's registration acknowledgement. The platform wait continues under
the container's existing lifecycle owner after the barrier releases, so
authoritative readiness or exact-target destruction can supersede it. A later
current-version start destroys any different pending target before binding its
fence. Web admits the hint only for an extant, non-suspended member whose
health-data grant is not revoked; this preserves legacy missing-grant
compatibility without letting a hint queued behind account deletion recreate
runner state. The hint creates no workspace or processing authority; the later
post-Temporal direct ensure remains authoritative.

Hosted Linq message edits are immutable correction inputs, not mutations of an
accepted mailbox item or transcript. Each accepted inbound Linq conversation
message stores a private versioned blind lookup key for its provider-global
message id. A verified `message.edited` webhook locks that source lineage,
finds the already-accepted original, and revalidates its exact sender, chat,
direction, direct home route or same group route, and container access before
appending a structured correction through the ordinary mailbox and wake
handoff. The lock is edit-only: ordinary accepted messages write the blind
source index without an additional source-lock query. An edit that races an
uncommitted original receives the existing bounded retryable missing-source
outcome and resolves after provider retry; simultaneous edits serialize from
lineage read through correction append. Optional group `senderMemberId`
attribution and personal entitlement
never grant or remove owner-backed room authority: an absent participant
projection remains eligible, while an existing projection that positively
records removal or a different handle fails closed. The
replacement text stays user-authored data; only the separate part index,
deterministic opaque reference to the original accepted assistant input, and
correction framing are trusted runtime metadata. That reference distinguishes
corrections to different originals without exposing provider identifiers.
Corrections accepted before planning may join the current turn, corrections
accepted during an active turn may steer it only when their opaque original
reference names an input already accepted into that same turn, and corrections
to older inputs remain ordinary pending conversation work. The owner keeps at
most the provider-supported five corrections, rejects conflicting replay,
ignores stale or ambiguous ordering, and retries a missing original only within
the provider delivery window. If the referenced input already received a
completed answer,
the assistant sends one concise follow-up only when the correction materially
changes that answer or action; immaterial wording changes end with the existing
durable `finish_without_reply` policy. It
does not rewrite history, cancel a turn, rerun onboarding, fetch the message
from Linq, create a second queue, or use the provider diagnostic ledger as
correctness state. Outbound edit events are diagnostic only.

Participant-derived thread-container authority is a seven-day lease over an
authoritative provider observation, reused by ordinary access, AI admission,
usage allowance, and newsletter projection. A non-direct Linq inbound may
advance only the already-existing, nonremoved relationship for the
server-resolved sender; it cannot create participant authority, clear a newer
removal, move `lastSeenAt` backward, or use a provider timestamp later than
server time. Owner-derived authority remains independent. Partial oversized
rosters therefore cannot turn an omitted or departed participant into an
unbounded subscription capability.

Direct and authenticated group conversations share the same provider-response
lifecycle. Every completed text or media segment is retained and delivered;
the audience does not create a replacement-response owner. Group transcript
rendering uses one canonical message shape with an opaque message reference,
server-derived sender handle, and an optional bounded quoted speaker label.
Telegram carries its label from authenticated ingress. Linq resolves labels
lazily during prompt preparation against current Web authority: an exact unique
current member's authorized `profile-name.v0` display name wins, otherwise the
human group owner's explicitly enabled address-book projection may provide one
safe unique canonical-phone label marked as unverified. Failure leaves the
speaker unnamed. A granted profile share whose snapshot is not yet materialized
is unavailable rather than profileless, so its post-join publication can win on
the next ordinary operation. The owner-contact reader admits at most 16 phones
per request; only those exact admitted handles can receive positive or negative
contact evidence, while overflow remains operation-local.

The assistant-runtime Linq presentation adapter owns the compound operation
memo and one bounded private file cache at
`vault/.runtime/cache/assistant-runtime/group-participant-display-names.json`.
Initial prompt preparation reads unresolved unique handles in one batch; later
live admissions reuse operation-local positive, negative, and fail-soft entries
and read only new handles. Across ordinary turns that reuse the same local
workspace, validated profile and owner-shared contact labels have a fixed
14-day TTL. Web separately returns `nameMissSenderHandles` only for exact
requested handles where every applicable authorized profile/contact source was
successfully checked and no safe label exists; only that explicit evidence has
a fixed six-hour TTL. An omitted handle without this evidence remains
operation-local. Each entry uses an opaque
SHA-256 key over the callback-bound runtime member, exact accepted-input route
conversation key, channel, and normalized handle. The versioned JSON file is
atomically replaced, capped at 2,048 insertion-ordered entries and two MiB on
read, stored below a `0700` owner directory as a `0600` file, and never names a
member, route, handle, or label in its path. Hits do not slide TTL or eviction
order. Missing, corrupt, oversized, or unreadable files are ordinary misses;
expired entries are pruned opportunistically without timers. Resolver failures,
timeouts, rollout skew, policy-limited contact reads, malformed or ambiguous
responses, suspension, and authorization loss remain operation-local and are
never written. There is no second resident
cross-operation cache, single-flight owner, mutation invalidation, lock manager,
or distributed coordination. `.runtime/cache/**` is excluded from hosted
workspace checkpoints, so the file can bridge fresh reader or process instances
only while the same local workspace survives; a cold restore or replacement
re-reads Web. Neither the operation memo nor the cache becomes profile or
contact truth. Profile and owner-contact labels remain presentation only, and
the name read returns no member or participant identifier. For
participant-scoped effects, the opaque `Message ref` plus trusted server
derivation remains the sole path; display labels and handles are never
selectors.

Hosted Linq participant-change webhooks are privacy-minimized provider-ledger
facts, not standalone runtime work. The shared ingress contract normalizes the
documented full participant handle (or Linq's deprecated handle fallback), but
the diagnostic ledger still stores no participant id, handle, phone, email, or
label. For a routed group, Web takes the canonical chat-ownership lock before
provider-event insertion, then locks the group owner before mutating the route
or reading optional context. A unique event may then append one bounded
participant-attributed item to the route's existing encrypted transient
group-event buffer in that same transaction. The item says which canonical
handle was added or removed and may include the human group owner's unverified
address-book label only when that phone is not proven to have an activated
Murph identity. The locked route rejects any participant
lookup key that belongs to its own Linq account, even when the provider omits
`is_me`. No live-roster fetch is needed: the signed participant event is
evidence of the change, while the existing live roster tool remains the sole
decision-time source for current membership and join-offer decisions.

Participant events still create no mailbox item, wake, route, membership,
invite, consent, share, or outbound message. A unique addition also sets the
existing nullable coalescing bit in the same transaction as ledger insertion;
that anonymous hint is the durable fallback when optional contact lookup,
encryption, or detailed staging fails. Removals have no automatic reply or
generic fallback: their detailed item is intentionally optional context. The
same chat lock serializes this transaction against the next normally admitted
non-direct message, so a later message cannot consume the route between ledger
insertion and detailed staging. That message then locks the route row, consumes
the addition bit and encrypted buffer in the same transaction as its ordinary
mailbox append, and carries them through the existing tolerant
mailbox-to-input sidecar. Prompt assembly exposes the buffer only with route
authority and explicit group attestation, clearly marks it as weak context
rather than a message or instruction, and uses the same path for normal and
captureless turns. Duplicate events do not restage context, and any failed or
raced mailbox append rolls consumption back.

Hosted Linq group reactions share that one-shot context boundary. A unique,
verified reaction for an active account-bound group route is checked against
the live roster and exact reacted-to message, then appends one actor-attributed
entry to the same encrypted transient buffer on that route. The legacy physical
column name remains reaction-specific, but its logical owner is the bounded
group-event buffer. It holds the newest ten entries in insertion order; older
entries fall off without creating a separately processed queue. Reaction
entries keep the canonical active roster handle, action/type, and bounded
target text, but no provider identifier, URL, or attachment metadata.
Participant entries keep only the normalized handle, change action, and
optional unverified owner label. Address-book replacement or deletion takes the
same owner-member lock as label staging and clears pending encrypted group-event
buffers for that owner's routes before committing. A staged label therefore
cannot survive Stop, permission-loss cleanup, or replacement; the existing
anonymous addition bit remains independent. Clearing may also discard pending
optional reaction context, which is already lossy and creates no work owner.
Corrupt context fails open, authority rotation clears it, and a failed or raced
mailbox append rolls consumption back. Append decrypt and reseal share one
500 ms deadline, and consume decrypt has the same bound, so optional crypto
cannot inherit the general KMS deadline while holding locks.
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
groups), with one exception: a removal of the exact canonical join offer by a
nonmember whose phone region has no derivable safe send window is consumed by
the join-offer owner before that path runs, so a participant the outreach
feature declines cannot have their phone and reaction persisted into
group-owned context.

Hosted Linq unknown first-contact admission is a web-owned classifier gate on
the first-contact path. It runs after cheap deterministic ingress filters and
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
permanently dropped. With enforcement off, only a genuinely unknown member on a
provider-authenticated direct iMessage from a configured E.164 phone prefix may
use a persisted model-source allow to enter instant start. The selected
permanent home line must be the same line the person contacted. The first
planner transaction creates the canonical member, verified phone identity,
pending route, and invite. That invite carries only the event id of the
persisted model-source allow and is the single-owner token for that exact
original inbound. Only the transaction creating a genuinely new member may
mint that token; an existing inactive member without the exact same-event token
remains on the signup path. The phone identity owner reports whether its unique
insert actually won; a stale outer lookup that loses that insert exits
retryably before invite or accounting work. While the token remains pending, a
different inbound for the inactive member exits retryably before counting or
creating an effect; it cannot continue or cancel the admitted start. The
starter-usage owner then locks the beneficiary and member, revalidates the
exact invite and event, appends the one semantic-keyed $4.50 starter grant when
absent, activates the member, and clears the token atomically. It creates no
Stripe Customer or Subscription. A second ordinary planner pass counts and
appends the original inbound exactly once after active access is visible. Any
block, deterministic fail-open, unsupported prefix/channel, cross-line route,
existing member, conflicting billing history, or definitive enrollment failure
keeps the existing signup-link or ignored behavior. Active members, explicit thread routes, own
messages, group chats, local guard rejects, deterministic URL/STOP-style spam,
and other non-invite paths bypass the classifier.

Starter-usage acquisition provenance is descriptive, not entitlement
authority. The starter grant records `web_onboarding`,
`companion_onboarding`, `linq_instant_start`, or `legacy_trial_migration` in
its bounded source-reference lookup key. Duplicate enrollment paths converge
on the member's policy-versioned semantic grant key. Historical billing rows
and delayed legacy Stripe events retain their old nullable trial metadata only
for bounded provider cleanup and audit compatibility; those fields never grant
capacity. The ops growth read derives current starter activation from the
immutable starter grant and maps invalid source references to Unknown while
exposing only the existing masked phone hint; it never decrypts contact data
for attribution.

Hosted signup-welcome admission is a separate line-owned outbound guard. Web
serializes only the affected member's durable row, reads each healthy assignable
`HostedLinqLine`'s UTC-day proactive-conversation counter, and derives one
on-demand planning snapshot from the two canonical route owners: active direct
member bindings count as 10 planned messages each, while provisioned non-direct
Linq `HostedThreadRoute` rows count as 25 each by their blinded
`accountLookupKey`. Group load follows the canonical delivery account written
with the encrypted route; it never follows the container owner's home line and
the assignment read never decrypts route material. New direct placement prefers
otherwise eligible lines below 5,000 planned messages. If every eligible line
is at or above that soft target, selection falls back to the least-loaded line;
the target does not reject assignment, inbound group provisioning, inbound
messages, or replies in an existing conversation. A healthy line contacted by a
member-initiated first inbound keeps that conversation on the contacted line
without consulting planning load or proactive pacing; weighted selection only
balances proactive placement and a genuinely degraded-line fallback. Legacy
route rows with a null projection are surfaced as incomplete coverage and add a
common conservative unknown weight during assignment until the bounded one-shot
encrypted-route backfill reaches readiness. Linq route owners take the member row `FOR NO KEY
UPDATE`: this still serializes them with activation and each other, while
remaining compatible with the foreign-key `KEY SHARE` taken when Linq, Telegram,
or another channel appends mailbox work after changing the shared routing row.
This avoids a second lock namespace and avoids a routing-row/member-row
cross-channel deadlock. The effective proactive limit is the lower of the hard
50-conversation ceiling and the line's configured
`maxNewConversationsPerDay`; the line row lazily rolls its counter to the new
UTC day. The conditional row update is the only atomic shared-pool capacity
gate. If a claim loses, activation retries it once for a day-rollover race and
then tries another eligible line inside the same request. If no line has welcome
capacity, web still assigns a healthy home line but omits the participant-target
welcome, preserving the member-initiated Text Murph path. Same-line inbound
first binds and existing-thread replies do not consume this proactive budget. A
degraded incoming line may fall back to a different line only after the final
member route agrees with the selected line and that line's capacity is
atomically claimed, because the fallback creates a new participant-target chat;
without capacity, web accepts the inbound event but sends no fallback chat. For
an unknown phone on a degraded incoming line, web materializes the member
identity before that final claim so concurrently created route authority can be
re-read. A rejected claim commits that inbound identity but creates no home or
pending route, invite, delivery, fallback chat, or line-count increment; a later
inbound resolves the same member and retries normal routing. Member deletion
cannot erase line-level capacity already claimed that day. Linq's 7,000 combined
inbound-plus-outbound messages per line per UTC day remains a provider
performance guideline, not this planning score and not a new runtime rejection
threshold. Exact line-level traffic evidence continues to belong to
`HostedLinqProviderEvent` and `HostedLinqDelivery`, separate from assignment
planning and proactive-conversation pacing.

A private direct Telegram member may explicitly ask for Murph's iMessage
number before a home line exists. The hosted assistant exposes a
one-current-input tool whose authenticated Web owner first requires a verified
member phone that Linq inbound can resolve back to the same member. A verified
account email alone is not iMessage sender proof. Without that phone the tool
assigns nothing and directs the member to the existing account settings flow.
It then locks and rereads the member's route.
An existing `linqRecipientPhone` is returned without consulting the pool. Only
`none` home-route authority may select a healthy assignable line, and the bare
home-line assignment commits in the same transaction; pending or chat-bound
authority fails closed. The tool accepts neither a member id nor a requested
phone number, so repeated or concurrent requests reuse one durable line instead
of consuming the pool. Every successful result also returns the existing masked
verified-phone hint. The assistant must tell the member to start their first
iMessage from that phone and state that same-account recognition is not
guaranteed for another number or email and may produce a separate Murph
conversation. This is an explicit supported-sender boundary, not a guarantee
for an arbitrary iMessage sender. The line is not copied into Telegram wake or
persisted assistant-input metadata; both existing and first assignments use the
same signed request path. This assignment sends no message and does not claim
proactive-conversation capacity.

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
warm local runtime markers across leases. Before an inactive fence is replaced,
the `UserRunner` preserves it only when the durable current snapshot-upload
session belongs to that exact attempt and lease generation, has not completed,
A runtime starts the first heartbeat immediately after the snapshot-session
handshake and keeps later serialized attempts on a two-second start-to-start
cadence while publication is active. That handshake has one six-second total
deadline, leaving the two-second heartbeat request inside the 10-second stale
boundary. A successful foreground preemption bypasses handoff preservation and
stops heartbeat liveness before detached session cleanup. After Web accepts the
checkpoint, the runtime stops heartbeating and best-effort records completion;
a successful marker releases replacement immediately, while marker failure
falls back to stale-heartbeat expiry. The one-second replacement retry therefore
protects live snapshots without imposing a fixed publication deadline; absent,
mismatched, completed, or stale handoffs proceed immediately.
A dead runtime can defer replacement for the 10-second liveness window plus at
most one additional retry interval (one second) after its final heartbeat.
Encrypted hosted snapshots also carry
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

After a parsed successful runtime result has settled and RunnerContainer has
removed the exact active-operation pointer, RunnerContainer sends UserRunner one
best-effort internal completion receipt bound to user, attempt, and generation.
RunnerContainer waits at most one second for that receipt before returning the
completed result so a slow or unavailable UserRunner cannot block the outer
completion fallback.
UserRunner applies the same exact write-fence compare-and-swap used by the outer
invocation path; whichever path wins is the only owner that can release the
runtime owner, while the outer path remains the mixed-version and callback-loss
fallback. A checkpoint, elapsed time, or container lifecycle event is not a
completion receipt. After an exact successful runtime completion clears its
write fence, Cloudflare makes at most one signed, payload-free, best-effort
callback to web with a timeout of at most two seconds; a known future mailbox
retry continuation skips it. A
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

The repository uses the current verification commands described in
`agent-docs/operations/verification-and-runtime.md`. Their dispatcher is local
by default and exposes two explicit, fail-closed, secret-free remote executors:
Crabbox's first-party static SSH provider for a dedicated macOS worker account,
and its direct Blacksmith Testbox provider for the bounded paid fallback. The
static lane validates explicit operator-local host, user, and port routing,
passes those facts only as Crabbox CLI arguments, derives one opaque lease id
per initiating worktree, and creates a unique remote directory for every
invocation. After admission, the dispatcher
materializes one process-owned immutable Git candidate over its original base
as detached `HEAD`, verifies and logs its tree id, and performs a full sync
from that candidate without requiring a source branch. Because Crabbox excludes
the local `.git` directory, the dispatcher also transports a bounded generated
object pack for the base objects absent from the candidate. The remote
entrypoint first proves native `tar` plus the production-compatible `zstd`
stdin compression/decompression contract, then rebuilds the detached base plus
staged candidate and verifies both tree ids before installing dependencies.
That entrypoint internally selects the `static-ssh` verification profile; the
root verifier admits composed acceptance only when it observes at least 10
logical CPUs and 24 GiB of physical memory. That capable plan starts three
two-worker package lanes, initially limits them to the three-worker CLI plus one
two-worker peer, and overlaps one-worker app pools plus fixture verification;
CLI terminal state retains the existing release and failure-propagation
contract. Smaller or memory-unobservable workers retain the serial two-process
fallback. Later checkout writes cannot change the run, while the dirty candidate
preserves implicit diff scope. A native macOS `lockf` descriptor inherited by
the verifier is the single remote-capacity owner until its exact child groups
exit. For that same finite lifetime, native `caffeinate` prevents idle system
sleep without changing a persistent power setting. The verifier then removes
only that run directory. The local artifact lock protects cooperating local
producers and candidate capture, not remote completion. The lane reuses the same
synthetic verification core and adds no daemon, coordinator, queue, scheduler,
shared checkout, or product state.

Ordinary Vitest output is contained beneath one marked process-owned temp root
that is removed at teardown and recovered conservatively after an abrupt stop.
The repository also has a cross-platform repo-local host setup path
(`pnpm onboard` / `scripts/setup-host.sh`) for macOS and Linux, a fixed-version
release manifest that publishes five public packages while bundling private
workspace owners into the relevant tarballs, a local device-sync runtime with
service/http tests, and inbox/parser package tests that exercise runtime rebuild,
audio/video parser workers, parser-toolchain discovery, and parsed-pipeline
flows inside the local TypeScript workspace.

## Tracked Compact Table Response Cards

Compact table response cards reuse the existing outbox-owned immutable effect
and interactive Messages-extension balloon, with Linq's static layout retained
for recipients without the extension. A compact card is a bounded
presentation snapshot, never a mutable tracker: canonical workout events remain
the only workout authority, qualitative set annotations live on canonical set
notes, and an update is complete only after a successful workout re-read
followed by a new V4 workout snapshot. Generic compact tables continue to use
V3.

The optional tracking reference is one exact canonical event ULID plus a
canonical UTC snapshot instant. That reference remains in semantic transcript
history so a later turn can reopen the workout without a second table store;
both presentation projections omit it before encoding the card URL. Linq
requires an HTTPS app-card URL, so V3 generic-table and V4 workout envelopes use
a bounded Base64URL fragment on the fixed canonical
`https://www.withmurph.ai/` origin. The fragment stays inside the immutable
message URL, is not sent to the Web origin by an HTTPS request, and is decoded
locally by the Messages extension. Recipients without that extension receive a
provider static layout whose `image_url` carries the exact same authority-free
envelope in the bounded queryless `/imessage/card/v1/:payload.png` path. The
stateless Web renderer accepts only strict V1-V4 presentation envelopes, reads
no database or remote service, logs no card values, and returns private
no-store/no-index headers. This is a narrow presentation exception to the
fixed-URL rule: either URL may contain the same bounded health-related values
visible in the immutable private-direct message, but never a member identity,
canonical record reference, credential, tracking reference, or other authority.
The provider request rejects encoded URLs at 2,048 characters, while the
contract applies the tighter of the fragment and image-path bounds before
delivery. Compact-table provider chrome uses only bounded title, optional
generic subtitle, and derived workout-progress fields; complete detail remains
owned by the semantic text renderer. Nutrition V1 and V2 cards use the
same bounded fragment and image-path family without a tracking field. The
Messages extension remains offline and read-only. This adds no card API,
database, background synchronization owner, authentication surface, or mutable
message state.

## Scheduled assistant tool authority

Ordinary canonical `automation-cron` turns reuse the hosted invocation authority
already carried by the scheduler. Assistant Engine accepts that authority only
when the automation id and occurrence timestamp exactly match
`scheduledOccurrenceAt`. The resulting invocation scope is one of two typed
variants: a real accepted assistant input or an exact automation occurrence. An
occurrence is authority in its own right and is never represented as a message.

Response cards, private Clinical Records connect links, route-eligible
style/personalization, and synchronous image generation may use that exact
occurrence authority. Synchronous image generation is exposed only when the
resolved delivery adapter supports `vault_image`; scheduled email remains text-only
instead of generating media that delivery would discard. Their existing owners
remain unchanged: Web owns Clinical Records intents and durable personalization
writes. A Clinical Records occurrence
returns one stable authenticated launcher; the browser creates the short-lived intent
only after current human navigation, stages its claim in the existing private history
state, and can retry a transient intent-creation failure. Its deterministic scheduled
callback permits one bounded replay on retryable transport failure, and the turn-local
memo clears only the exact rejected request so a later tool invocation may retry.
Message-authorized claim creation receives no automatic transport replay.
Personalization writes append
only the sparse fields that Web approves under the field-local `(occurredAt, source
causal sequence)` order. The runtime applies those approved writes in their preference
event append order, so delayed source callbacks cannot reorder canonical vault state.
An exact provider tool-call id distinguishes multiple commands from one accepted input
or scheduled occurrence without becoming authority. Ordinary product feedback and
verified-private support escalation remain accepted-message capabilities; scheduled
turns create neither a feedback candidate nor a delivery-linked feedback obligation.
Background image completion and its physical-note continuation remain bound to a
real accepted message because they must return through that durable message route.
Ephemeral progress updates remain unavailable because queue-only background turns
have no waiting audience and cannot durably order a progress send before the final
reply. No scheduler-specific service, persisted authority row, queue, or second
continuation lifecycle is introduced. Occurrence-derived hashes are retry keys
only; they are never accepted-input identities.
