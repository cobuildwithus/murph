# Murph Architecture

Last verified: 2026-08-31

## Accepted-Message Targeting

Terminal Linq send recovery extends the Web-owned `HostedLinqDeliveryMessage`
receipt owner with one attempt timestamp and a blinded original identity.
It reuses current route/access and egress policy, retrieves the original
provider message transiently, and resends only that failed message. It creates
no assistant turn, outbox owner, scheduler, or durable message-body copy.
`agent-docs/RELIABILITY.md` specifies the supported content, ordering, limits,
and conservative behavior after an ambiguous retry.

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

Native replies may select any input admitted in the active turn through the
exact tool or response ordinal, including earlier live-steering segments.
Reactions remain segment-only. Native selection and pre-delivery revalidation
use the same bounded prefix; invalid ordinals, including request-relative
ordinals before group reconsideration rebasing, fail closed. Admission and
checkpointing still precede target authority, and no-reply accounting is
unchanged.

`murph.select_reply_target` annotates a normal response segment;
`murph.react_to_message` keeps the existing reaction effect and outbox
operation. The delivery owner re-resolves the selected input immediately before
each effect. Native replies clone the response ordinal's reply context and
overlay only the canonical message target, without replacing the route or
audience or mutating shared input. Every `---` bubble from one response segment
inherits the same selected target.

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
After a successful personal checkpoint, the runtime offers complete replacement
snapshots before a complete device-sync-only maintenance prefix may resume;
the dedicated system-mailbox lane likewise offers before acknowledging imported
dirty state. Conversation work still preempts the offer. Group reads query the
current Web-owned snapshot on demand, so publication adds no per-group wake,
cache invalidation, fanout, or second projection owner.

A group participant's explicit dated daily-metric report uses that same owner
split. The model submits the exact accepted-message ref, never a member id. Web
reopens the accepted group input, resolves its current canonical sender, and
appends one deterministic encrypted mailbox wake to that sender's personal
runtime. The runtime stores a canonical `manual` daily observation beside, not
over, wearable evidence and reuses the system-mailbox post-checkpoint projection
opportunity to replace any already-granted group snapshots. There is no Web
health-value table, override row, correction join, or projection-specific queue.
The runtime resolves active Web-owned scopes without touching the vault, then
materializes every selected record while the invocation still owns the restored
vault path. Scope resolution receives the invocation's abort signal, so a
foreground wake cancels and drains that read. An already-started immutable
delivery instead remains owned and
finishes its current scope. A foreground wake, exact host abort, or shutdown
prevents admission of every undispatched captured scope, including the first,
and that offer reports
preempted instead of treating its successful prefix as complete. Foreground's
stop bit belongs only to the active delivery owner, so
a later opportunity begins fresh and can retry every scope before the existing
dirty or recording obligation is acknowledged. Web
owns a finite effect deadline for that current scope, stops admitting destination
replacements on deadline or request cancellation, and bounds the final database
transaction by the remaining deadline. Runtime creates that one absolute
effect deadline and carries it unchanged through the proxy to Web. Transport
timeouts add a fixed settlement margin. Only a proxy response marked after an
actual Web response can prove terminal settlement; an unmarked proxy response
or transport failure retains the invocation owner until the absolute settlement
boundary. A marked actual-Web failure received before the effect deadline is
terminal for that scope only when Web has proved the failure is the absence of
one destination member's ingress-root envelope. The same sequential owner then
records the attempt as failed and offers later independent scopes. Unknown
crypto/provider, access-query, database, transaction, deadline, transport, and
owner-ending failures stop the undispatched suffix.
Finalization drains that owner
before release or retry, so projection work never overlaps a successor
invocation. Local capture is bounded and likewise drains before its result is
either delivered or discarded. Every captured offer names
the committed personal-workspace version that produced those bytes. Web
serializes only the final replacement against that existing workspace row; an
older in-flight offer becomes a no-op after a newer checkpoint instead of
overwriting the newer group snapshot. One opportunity has at most one active
request. One destination's explicitly typed missing-root failure does not starve
healthy scopes behind it; the aggregate failure retains the durable retry.
Unclassified or shared-infrastructure failure, foreground preemption, exact host
abort, shutdown, deadline exhaustion, or ambiguous transport instead drains only
the active request before leaving the undispatched suffix to the existing continuation.
Projection
failure retains the existing dirty or recording obligation and its bounded
continuation rather than creating a projection-specific queue or watermark.
After an authenticated group join or sharing save, the page reuses the
dashboard auth owner's first-checkout decision: a member who still requires
checkout continues directly to `/join`, while an accessible member retains the
existing chat-channel or Home return. The group feature adds no onboarding or
billing state owner.

`murph.group_data action="read_shared"` is the only ordinary hosted assistant path for group
standings, shared facts, and diagnostics. Its runtime adapter is synchronous and
performs no I/O when constructed. This path adds no pre-model roster, grant,
snapshot, device, projection, configuration, or attribution read; existing
accepted-input and route-binding work is unchanged. Web is contacted only after
the model invokes the tool.

Assistant-engine advertises six focused group family names:
`murph.group_consult`, `murph.group_data`, `murph.group_membership`,
`murph.group_usage`, `murph.group_chat`, and `murph.group_email`. Each is a
strict action subset derived from the canonical `murph.group` argument parser
and normalizes into the same existing group request/executor path. The legacy
full `murph.group` name remains parser-compatible for rollback but is absent
from ordinary discovery. Detached or scheduled contexts with only shared-read
authority still receive their existing narrow `murph.group` descriptor, so the
catalog split does not widen those contexts or create another executor.

Strict dynamic-tool parsing returns the complete Zod issue list to the same
originating model call so it can repair unknown fields, invalid actions, and
cross-field failures without guessing at a product or permission limitation.
That complete reason is held only in an invocation-local weak association with
the existing validation digest. Runtime-issue persistence and JSON serialization
retain only the bounded value-free digest; a reconstructed digest therefore
uses the older bounded repair hints rather than recovering model-only detail.

`murph.group_chat action="read_chat_name"` is the on-demand provider-title primitive.
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
yet. A room's explicit request to repost the native offer is the narrow
exception: the model supplies that current accepted Message ref, Assistant
Engine verifies it against current group input, and Web incorporates the exact
accepted-input identity into provider idempotency. Web resends the locked
current join-policy snapshot; reposting never defaults or replaces its scopes.
Replay of that request converges on one provider message; a later request can
post one replacement.
Older active offers are revoked only after the replacement message is durably
bound, so a failed send does not destroy the existing recovery path.

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

Immutable hosted memory consolidation remains an isolated one-shot automation.
Only its exact built-in id receives `murph.member_memory`; the host executes
that narrow state tool through canonical core memory operations. The turn uses
the shared restricted maintenance configuration and needs no separate
permission profile or filesystem mutation path; native controls are not an
additional memory owner, and the host suppresses their effects in this lane.
The evidence owner distinguishes a successfully empty bounded conversation
window from collection failures. An empty member-memory window skips before
provider admission. An empty group window skips only when its room-model page
is also genuinely missing; existing pages remain eligible for cleanup, and
unavailable evidence or pages keep the ordinary maintenance path. The rolling
evidence window remains intact so corrections and late committed events are
not hidden behind a last-run timestamp.

The canonical cron lifecycle skips a managed Journal connected-context pass
only when its ledger is genuinely missing and its complete connected-account
inventory is empty. Existing ledgers, new accounts, unavailable ports, and
failed reads keep the normal pass, preserving notices and due follow-ups.
The account inventory owner rejects malformed pages instead of presenting them
as empty. Journal and Personal Patterns retain the common hosted cron policy:
eligible first attempts request Flex; failed-attempt retries use Standard, and
the provider boundary validates model and catalog support before selecting Flex.
