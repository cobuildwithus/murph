# iMessage workout tracking

## Product outcome

A private member can run a strength workout from the Murph conversation:

- see today's ordered exercises and completed/remaining set counts;
- open an exercise to see each set's target and recorded result;
- edit sets and add exercises directly inside the expanded Messages app;
- receive a refreshed immutable workout card after every verified free-form gym mutation.

The experience borrows the useful workout-tracker loop—plan, log sets, correct, finish—without introducing a second workout product or data store.

## Authority boundary

- A saved workout format owns planned exercises, stable exercise identity, planned sets, and target values.
- One canonical `activity_session` workout event owns session timing, unlogged set coordinates, and actual completed-set values. Planned targets are not copied into those placeholders.
- A response card is an immutable snapshot. It never owns workout state.
- The Messages extension has no vault credential, Privy dependency, cache, or
  canonical persistence. It may read only the narrow Messages-scoped credential
  enrolled by the containing app.
- An active workout editor submits a closed, bounded member action directly.
  The existing hosted mailbox delivers it to the canonical workout owner with
  no assistant turn; the immutable card remains presentation, not authority.
- A set edit owns only its explicit result family (`note`, `reps`, or
  `weight_reps`): optimistic comparison, canonical merge, and exact replay
  preserve unrelated annotations and metrics on the same set.
  Its expected-state projection records null versus present prior fields
  independently, so adding load to a reps-only set cannot overwrite a newer
  reps correction.

## Response-card contract

The assistant continues authoring `compact_table` V1 through two closed shapes. A generic table keeps `rowHeader`, `columns`, and `rows`. A tracked live workout instead carries the shared title/footer fields, requires `subtitle: null`, a canonical `tracking` marker, and structured `workout` detail:

- `state`: `active` or `completed`;
- ordered exercises;
- ordered sets with `pending`, `completed`, or `skipped` status;
- a compact target string and actual-result string.

Workout state and progress summaries are derived from the structured exercise/set detail by text, provider-layout, image, and native consumers. The model does not author either a subtitle or a second generic row projection of the same state. Runtime and native readers continue accepting non-null subtitles from already-persisted and already-sent cards, but workout presentation ignores that legacy field.

Tracked workout detail requires a canonical tracking marker in durable transcript context. The native URL strips the event id and snapshot time.

The model never authors edit preconditions. At card attachment, runtime re-reads
that exact active workout and may add one internal editor projection only when
ordered exercise names, set counts, and logged states match the presentation.
The projection preserves the closed result family, canonical zero values,
nullable reps/weight, the raw optional set unit, and separate exercise unit
context. A note is eligible only when its exact canonical value fits the
40-character visible card field; a longer note is never substituted with a
generic label inside editable state. Every completed set must fit exactly one
supported note, reps, or weight/reps family; duration, distance, RPE,
bodyweight, assistance, added-load, or mixed-result sets keep their original
readable actual on V4 instead of entering a lossy editor. Duration, cardio,
assisted-bodyweight, and weighted-bodyweight exercise modes remain V4 even
before a result is logged because V6 cannot produce their native set shape. A read failure,
mismatch, completed workout, hidden or unsupported result, or oversized V6
leaves the card as the existing readable V4 snapshot.

Generic compact tables keep the existing schema-version-3 native envelope. The
static workout image keeps the authority-free schema-version-4 envelope. The
installed native editor uses schema version 6, which adds that compact typed
projection and one opaque 64-character workout-revision binding while still
staying under the existing 2,048-character URL ceiling. The revision binds the
canonical workout identity to its ordered hidden exercise/set-slot identity and
last applied member-action generation without exposing any of those values.
Mutable set results and annotations are intentionally excluded so their closed
result-family compare-and-merge path can preserve unrelated canonical fields.

The readable response-card contract remains object-shaped for authoring and
runtime validation. V4 uses positional exercise tuples `[name, sets]` and set
tuples `[status, target, actual]`. Its logical reader and authoring bounds admit
up to 16 exercises and 16 sets per exercise, while validation of the actual
encoded fragment and image path remains the final capacity authority. This
admits realistic higher-cardinality snapshots, including eleven-exercise,
three-set late-active sessions, without adding another projection owner; a
specific snapshot that exceeds the existing URL ceiling still uses complete
semantic text recovery instead of truncating or changing canonical workout
data. V6 uses `[name, exerciseUnit, sets]`; a
completed set replaces the actual display string with a closed compact
note/reps/weight-reps tuple, while a pending set carries `null`. Native derives
display and optimistic preconditions from that typed tuple. Removing repeated
wire keys keeps realistic six-exercise, four-set initial and late-active
snapshots below the same URL ceiling without adding another projection owner;
completed cards remain V4/read-only.

## Static fallback

Recipients without the Messages extension, including Messages on macOS,
receive a generated static image that mirrors the compact native workout or
generic-table balloon. Provider chrome is intentionally bounded to the title
plus derived progress for structured workouts; it does not repeat the image's
sets below the balloon. Generic-table provider chrome retains its existing
title, optional subtitle, rows, and footer. The complete semantic text renderer
remains the workout recovery owner, and the value-free fallback identifies the
message as the member's workout before telling them how to request that complete
text without exposing its values outside the card.

The bitmap remains rectangular because Messages owns the outer mask and
caption. Because the provider request omits an App Store id, the app-absent
layout supplies no app art of its own; the bitmap therefore embeds the checked-in
canonical Murph mark in the same 36×27pt upper-left badge footprint as the
native balloon. Every fallback title sits beside that compact footprint in one
shared header; optional supporting text stays directly under the title, and no
larger empty icon gutter is reserved.

Shared workout footer copy must remain truthful on both projections: it may ask
the member to reply with an exercise, set, and result, but must not promise a
native-only tap control. The static workout summary derives `Next` from the
first pending set in order; a targetless first pending set stays visibly
targetless instead of borrowing a later set's target. Static text wraps at a
deterministic display width, and the same calculation owns the raster height so
every contract-valid title, row, cell, and footer remains inside the image.

The image URL carries the exact same strict authority-free V3 or V4 presentation
envelope as the native fragment in a bounded queryless path. V3 tracking remains
in the semantic transcript only and is stripped before either encoding; V4 has
no tracking or canonical event reference. The stateless Web renderer accepts no
identity, credential, canonical reference, or write authority, reads no database
or remote service, logs no card values, and returns private no-store/no-index
headers. It adds no card API, persistence owner, cache, queue, or retry path.

When the same shared-card fragment reaches the public homepage outside the
Messages extension, Web recognizes only the exact non-empty `#murph-card=`
prefix after hydration and opens the App Store handoff. It never decodes,
displays, stores, logs, or transmits the fragment value. Dismissal leaves the
shared URL unchanged, and every other homepage fragment stays quiet. The web
fallback uses Murph's canonical App Store URL independently, while the Linq
payload omits the optional App Store id so it cannot replace the wide static
preview with square artwork. Neither path changes the installed-extension route
or application authority.

## Plan versus actual

Targets and actual results must remain distinct:

- planned targets come from the verified workout format;
- completed actuals come from the verified canonical workout event;
- a target is never evidence that a set was completed;
- one exact repetition count the member explicitly assigns to every set of one
  exercise in the current active workout is member-stated actual repetitions
  for a later unqualified free-form completion in the same direct conversation;
  only repetitions carry forward under this exception, while every other actual
  field must be stated with that completion or already exist on that exact
  canonical set; an explicit repetition result overrides the earlier count,
  while a range, AMRAP, conflict, ambiguous exercise, or unavailable
  establishing message requires clarification;
- pending planned sets become skipped only when the workout is explicitly finished;
- additional actual sets beyond the format are included with no target.

This narrow same-conversation repetition rule does not create a card-level
“complete at target” shortcut and does not authorize copying a saved-format
target, prior workout value, assistant suggestion, or non-repetition
prescription into an actual set.

A short acknowledgement after a set message or assistant reply is not another
set completion. It cannot move the write target to the next set. The last set
coordinate the member explicitly named remains the only candidate. If that set
still needs a result, Murph asks one narrow question about it. If the canonical
result already matches, the acknowledgement causes no workout mutation. The
sole exception is a contextual affirmative that accepts the exact bounded
missing-workout recovery offer below.

Every completion, correction, and acknowledgement follow-up first resolves the
canonical active workout. A missing active workout fails closed. Murph does not
start a workout to make an earlier assistant confirmation appear true, does not
write a later set, and does not claim that any set was saved. It states that no
active tracked workout was found. A completion or correction alone never
authorizes a new workout. Murph may start one only when the current message
explicitly requests it or the member accepts one exact recovery offer. That
offer repeats the proposed workout, exercise, set coordinate, and stated result.
Acceptance creates only enough pending coordinates through that set and writes
only the named set. Murph rechecks active state before acting and never retargets
the accepted recovery if another active workout has appeared. The missing-state
response includes both the truthful no-save result and that exact recovery
question. It does not stop after the failure statement or give generic retry
advice.

An active workout may have zero pending planned sets and remain active so the
member can add targetless extra sets. Plan exhaustion is not session closure.
When one message contains both a set result and unmistakable closure language,
Murph logs the set, finishes that same workout in the same turn, and returns the
completed card. The member does not need to send a separate finish command.
A reminder by itself, plan targets, elapsed time, or an earlier-day active record
does not prove completion.

## Generic scheduled-reminder relationship context

Every scheduled automation delivered into assistant context includes its exact
`automationId` and occurrence timestamps. When it concerns canonical records,
it also includes a bounded list of exact `contextReferences`; plan-owned support
continues to include its `supportSeriesId`. Each reference names an entity kind
and the canonical id it concerns, such as a workout format, experiment, habit,
or regimen. The host keeps those exact ids visible to the model.
That relationship metadata survives provider-accepted text, text-plus-media,
and media-only reminder presentations; native reply is never required.

A model-authored reference copies an id returned by a successful current
canonical read or create result that identifies exactly one record. When that
evidence is missing or ambiguous, the automation stores no reference. The host
preserves stored ids with the delivery; preservation is not proof that a record
still exists or is the right mutation target.

The metadata is relationship context, not side-effect authority. It does not
confer read permission, mutation permission, or consent, and it does not select a
write surface. The assistant must inspect the referenced canonical record and
use the ordinary domain tools, validation, and locks for any action. Missing or
conflicting references fail closed rather than being guessed from reminder copy,
titles, card state, or recency.

The same prior-delivery context remains available for the next ordinary direct
chat message after the reminder. Native iMessage Reply, a quoted reply target,
card provenance, or provider reply attestation is neither required nor treated
as authority.

For a workout reminder, the relationship context identifies the exact saved
workout-format id. On an ordinary set completion, Murph reads that format and
the ordinary active-workout state. If no workout is active, the current
completion plus that exact inspected reference authorizes starting only the
referenced routine and logging only the stated set. If the active workout
already references that routine, the exact active event is targeted normally.

A different active workout is not assumed to be the reminder target, but the
reminder also does not establish when that earlier workout ended. Active
`durationMinutes` is elapsed time at the latest mutation, not an end
observation. Murph never derives an end from that value, a last-write time, a
plan target, the reminder time, the later reply time, or local midnight. If the
member supplies the earlier workout's exact end time or exact total duration,
Murph may compose the existing finish, start-from-format, and targeted set-log
commands. Otherwise it makes no workout mutation, says the new set was not
saved yet, and asks one narrow question for that time or duration while
preserving the exact proposed routine, exercise, set, and result.

Multiple active workouts, an unidentified routine or set, missing or
conflicting relationship context, changed state, and insufficient finish timing
all stop without silent retargeting. The existing one-active-workout invariant
and mutation lock remain the write owners. Explicit historical intent,
including a correction for yesterday or an explicit older workout id, continues
through the ordinary exact historical targeting path and is not reinterpreted
as a new-routine completion.

## Direct action loop

The expanded native editor derives one bounded expected shape from the visible
V6 workout snapshot and emits only closed `exercise.append`, `set.put`,
`set.append`, and `set.remove` mutations. `set.put` addresses an original or
in-batch exercise-placeholder coordinate. `set.append` addresses the contiguous
final positions after all original-coordinate edits and descending removals,
so deletion and creation never share one positional identity. A destructive
batch also carries one opaque SHA-256 binding over the canonical workout id and
complete ordered exercise/set state. The canonical owner recomputes that binding
under its existing lock before removing a set, so any concurrent type, note,
duration, distance, RPE, bodyweight, assistance, added-load, result, or mixed
field change rejects the immutable card without exposing those hidden fields in
the message URL. Before applying any different action, the same owner also
recomputes the card's workout-revision binding from the canonical workout id,
ordered exercise source/group/name/mode/unit/note identity, ordered set-slot
order/type identity, and last applied member-action generation. A prior direct
action or generic structural reorder therefore invalidates every older
positional card even when repeated visible values make its intended result
appear unchanged. When two exercise blocks have the same projected identity
after exercise order is excluded, mutable set results cannot distinguish their
coordinates safely. Those workouts remain truthful read-only V4 cards, and the
canonical owner rejects a previously issued V6 action if the current workout is
ambiguous. Admission rejects a destructive batch when original edits,
descending removals, and contiguous appends would recreate the same visible set
sequence because it would have no observable structural effect. The canonical
workout write records the request action id atomically with the final exercises.
Only that persisted id proves exact replay; a stale workout that merely matches
the intended visible projection still fails the complete binding precondition.
The same bounded activity-session read resolves an exact persisted id before
revision and active-workout eligibility, because the original write necessarily
changed the card's revision binding. Finishing that workout after its canonical
write therefore cannot turn a crash-replayed success into a rejection or
retarget a newer active workout. Only a first application without that exact
marker must satisfy the revision and active-workout checks.

Positions are one-based presentation coordinates, and each coordinate within
its original-edit, original-remove, or final-append namespace may appear at most
once. The action carries no member id or canonical workout id. Its stable
one-way workout-revision binding and destructive-state binding are stale-card
preconditions, not authentication: the server derives the member from the scoped
credential and requires exactly one active workout whose stable identity,
positional identity, last applied action generation, ordered exercise names,
set counts, logged states, and, for removal, complete canonical state still
match. Each edit to an existing set also carries the
bounded previous result from the typed card projection; the canonical owner
rejects the batch when that target changed instead of overwriting a newer
correction.

Web validates the whole envelope, re-checks active access and historical launch
consent under the existing member locks, and durably appends the action before
returning `202 Accepted`. An ambiguous network retry reuses the exact action id,
body, and client timestamp, so mailbox dedupe remains stable. Runtime applies the
complete batch under the existing live-workout mutation lock with one canonical
write and no model call. That write also stores the last applied member-action
id on the workout, replacing visible-sequence replay inference with one exact
effect marker. The serialized mailbox item cannot advance to another member
action before its terminal outcome, so no receipt table or action ledger is
needed. The generic workout editor continues to reject every
saved exercise or set deletion; only the member-action owner, after exact removal
binding and snapshot validation, uses the narrow set-removal replacement path.
Runtime then records an `applied`, `unchanged`, or typed
`rejected` receipt through the same mailbox checkpoint. The editor stays locked
while polling that receipt and says the changes were saved only after an applied
or converged result. A missing, completed, ambiguous, bound-to-another, or
changed workout is rejected without retargeting on first application; an exact
persisted replay remains converged after its workout completes.

This is the first family on the generic member-action delivery primitive. A
future direct editor adds another explicit action variant and delegates to its
existing domain use case. It does not gain arbitrary JSON paths, database
operations, assistant tools, or a new queue.

## Rollout

Backward compatibility is a permanent iMessage app-card contract, not a
one-time V6 rollout step. Linq's app-capability result does not negotiate a
decoder version, so every production card must remain readable by every
previously released Murph Messages extension that can claim it. A new schema,
discriminator, required field, stricter bound, or changed meaning may emit only
when unknown clients keep receiving the last readable envelope, an explicit
capability selects a compatible envelope, or every earlier claiming extension
already renders the unknown shape as a complete non-interactive recovery. A
new reader becoming available in TestFlight or the App Store is necessary when
applicable but is never sufficient by itself because older installed builds
remain active. Until compatibility is proven, emit the prior readable schema
(V4 for workouts) or deterministic ordinary text.

Within that compatibility gate, deploy the native reader first, the shared Web
action and image routes second, and the Worker and runner producer last. Keep
the Web route available while any sent image URL may still be fetched.
Provider acceptance, delivery receipts, the provider's static layout, and
new-build device proof do not prove old-extension rendering: an installed
extension can claim the card before rejecting its envelope.

The backend also has a persisted-state compatibility floor. Deploy a Worker and
runner bundle that accepts the current V4 bounds and V6 before a card using
either expanded shape can be emitted. The accepted outbox intent and hosted
delivery side effect both persist the full response card; after the first
expanded V4- or V6-bearing record exists, those Web and bundle versions are the
rollback floor. A warm older bundle must not process that state because its strict parser
rejects the workout branch, and the local runner can quarantine the pending
intent out of the retry inventory. Recovery is a coordinated forward fix or
explicit restoration of the quarantined intent after the compatible bundle is
live, not rollback below the floor. Focused static-route, local-outbox, and
hosted-side-effect round-trip tests pin all three strict readers with the same
expanded fixture shape.

Reminder context references follow the same persisted-outbox rollout rule.
Intents without references omit the optional field, so ordinary replies remain
readable by the preceding strict reader. Deploy the reference-aware Worker and
runner together with immediate container rollout before any reminder carrying
references can fire, then prove the exact runner-bundle fingerprint. The first
canonical automation or outbox intent with a non-empty reference list
establishes that bundle as the hard rollback floor. Hosted rollback below the
floor is safe only after every such canonical reference is removed through the
current writer and every affected intent and checkpoint has drained; otherwise
recovery requires the compatible reader or a forward fix, never manual editing
of canonical or assistant runtime state. A local CLI downgrade below the same
reader floor is unsupported while canonical automations carry references.

Static rollout also requires physical macOS and no-extension iPhone proof of the
final balloon, image-failure behavior, accessibility behavior, and App Store
affordance. Provider acceptance, direct route renders, and delivery receipts do
not prove those device behaviors.
