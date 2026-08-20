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
- An editor for one exact workout submits a closed, bounded member action
  directly. The existing hosted mailbox delivers it to the canonical workout
  owner with no assistant turn; the immutable card remains presentation, not
  authority.
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
the exact canonical workout named by the tracking marker and may add one
internal editor projection only while that workout is unfinished and its ordered
exercise names, set counts, and logged states match the presentation.
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

Targets, member prescriptions, and actual results are distinct authorities:

- planned targets come from the verified workout format;
- `memberRepsPerSet` is the smallest canonical exercise-owned fact for one exact
  repetition count the member explicitly assigns to every set of that exercise;
- completed actuals come from the verified canonical workout event;
- a target, prior workout value, card label, assistant suggestion, range, AMRAP,
  or qualitative instruction is never evidence for `memberRepsPerSet` or for a
  completed set;
- when a terse completion omits repetitions and the exact exercise has
  `memberRepsPerSet`, the canonical set-log use case copies that member-owned
  fact into the completed set's actual `reps` field in the same write;
- only an explicit statement that one exact repetition count applies to every
  set updates the member prescription before logging the current completion; an
  exact result for one set changes only that set's actual, while a conflict,
  ambiguous exercise, range, or AMRAP asks one narrow question instead;
- weight, duration, distance, RPE, bodyweight, assistance, added load, and every
  other actual field never carry forward under this rule;
- pending planned sets become skipped only when an early or targetless workout
  is explicitly finished; additional actual sets beyond a finite plan have no
  target.

The exercise-owned repetition fact survives provider-thread loss and bounded
transcript replay without creating assistant memory, a focus owner, or a second
workout record. It remains separate from both saved-plan targets and completed
set actuals.

A short acknowledgement after a set message or assistant reply is not another
set completion and cannot advance the coordinate. The last exact workout,
exercise, and set the member identified remain the only candidate. If an exact
coordinate is not available from a current command result, durable card marker,
or immediate causal context, Murph asks which workout or set is intended. It
does not select by recency, create a recovery workout, close another workout,
or demand unrelated finish metadata.

Starting or logging a new workout is independent of older unfinished workouts.
Every mutation carries the exact canonical workout id and uses that workout's
record-scoped lock. Multiple unfinished workouts are valid; there is no global
active or focused singleton.

Generic full-structure edits preserve exercise-owned repetition and finite-plan
facts only across proven exercise continuity. An existing stable
`sourceExerciseId` must match exactly and may support a label change or reorder;
otherwise the exact normalized name must identify one unique replacement, with
the existing group plus name disambiguating grouped duplicates. Presentation
order is never identity. A changed existing source id or different exercise is
a semantic replacement, not continuity, and the generic editor rejects it
alongside exercise or set deletion. This surface remains limited to
identity-preserving reorder, additions, and coordinated field edits; it does
not own arbitrary routine replacement or another exercise lifecycle.

Logging the last pending set of an explicitly finite workout writes the actual
result and `endedAt` atomically. The accepted completion timestamp is the
observed end boundary; no separate “I am done” language or finish command is
required. Targetless sessions and explicit early closure still use the exact
finish command. A later explicit extra set remains possible when it names that
completed workout and exact exercise/set; its successful write advances that
workout's observed end boundary. Murph never infers an old end from a reminder,
midnight, planned duration, last-write time, or later conversation time.

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

For a workout reminder, relationship context identifies the exact saved
workout-format id. When the member's current message clearly starts or completes
a set from that format, Murph reads the exact format, starts a new workout from
it, preserves the returned workout event id, and logs only the stated coordinate
on that new record. An older unfinished workout neither blocks this work nor
needs to be closed first.

When immediate causal context instead identifies an existing exact workout event
id, Murph reads and mutates only that record. A reminder reference alone never
selects an existing workout. Missing or conflicting record identity, exercise,
or set coordinates ask one narrow disambiguating question; they do not trigger a
recency scan or silent retarget. A completed exact workout may still accept a
clearly requested extra set.

Relationship context does not establish when any older workout ended.
`durationMinutes` on an unfinished workout is elapsed time at its latest
mutation, not an end observation. Murph never derives an end from that value, a
last-write time, a plan target, the reminder time, the later reply time, or local
midnight, and it never asks for that old end merely to permit unrelated new
work.

Explicit historical intent, including a correction for yesterday or an explicit
older workout id, continues through the ordinary exact-record path and is not
reinterpreted as a new-routine completion.

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
The same bounded activity-session read resolves an exact persisted action id
before first-application eligibility, because the original write necessarily
changed the card's revision binding. Finishing that workout after its canonical
write therefore cannot turn a crash-replayed success into a rejection or
retarget another workout. Only a first application without that exact marker
must match one unfinished record's binding and revision.

Positions are one-based presentation coordinates, and each coordinate within
its original-edit, original-remove, or final-append namespace may appear at most
once. The action carries no member id or plaintext canonical workout id. Its
stable one-way workout-revision binding and destructive-state binding are
stale-card preconditions, not authentication: after deriving the member from the
scoped credential, the server scans the bounded workout records and admits a
first application only when exactly one unfinished record derives the supplied
binding. That matched record supplies the canonical id and owns the mutation;
there is no active/focused singleton or recency fallback. Stable identity,
positional identity, last applied action generation, ordered exercise names,
set counts, logged states, the exercise-owned repetition prescription and finite
plan marker, and, for removal, complete canonical state must still match. Each
edit to an existing set also carries the bounded previous result from the typed
card projection; the canonical owner rejects the batch when that target changed
instead of overwriting a newer correction.

Web validates the whole envelope, re-checks active access and historical launch
consent under the existing member locks, and durably appends the action before
returning `202 Accepted`. An ambiguous network retry reuses the exact action id,
body, and client timestamp, so mailbox dedupe remains stable. Runtime resolves
the exact bound record, locks that workout id, revalidates the binding, and
applies the complete batch with one canonical write and no model call. That
write also stores the last applied member-action id on the workout, replacing
visible-sequence replay inference with one exact effect marker. If the action
logs the final pending set of an explicitly finite plan, the same write records
the accepted client timestamp as the observed `endedAt` boundary. The serialized
mailbox item cannot advance to another member action before its terminal outcome,
so no receipt table or action ledger is needed. The generic workout editor
continues to reject every saved exercise or set deletion; only the member-action
owner, after exact removal binding and snapshot validation, uses the narrow
set-removal replacement path. Runtime then records an `applied`, `unchanged`, or
typed `rejected` receipt through the same mailbox checkpoint. The editor stays
locked while polling that receipt and says the changes were saved only after an
applied or converged result. A missing, completed, non-unique, or changed binding
is rejected without retargeting on first application; an exact persisted replay
remains converged after its workout completes.

This is the first family on the generic member-action delivery primitive. A
future direct editor adds another explicit action variant and delegates to its
existing domain use case. It does not gain arbitrary JSON paths, database
operations, assistant tools, or a new queue.

## Rollout

`memberRepsPerSet` and `setPlanIsFinite` are optional canonical exercise fields,
so existing workout records require no bulk migration. Deploy all strict event
readers and writers together before the first new field is emitted; after that
write, those compatible bundles are the rollback floor. Legacy saved-routine
exercises with no finite marker retain finite-plan semantics, while new
targetless exercises write `setPlanIsFinite: false` so they cannot inherit that
legacy default. Legacy ad hoc workouts remain explicit-finish sessions. The
workout action binding version changes, so already-sent editable cards fail
closed and require a refreshed card rather than being reinterpreted.

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
