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
projection and one opaque 64-character action binding while still staying under
the existing 2,048-character URL ceiling.

The readable response-card contract remains object-shaped for authoring and
runtime validation. V4 uses positional exercise tuples `[name, sets]` and set
tuples `[status, target, actual]`. V6 uses `[name, exerciseUnit, sets]`; a
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
- pending planned sets become skipped only when the workout is explicitly finished;
- additional actual sets beyond the format are included with no target.

An active workout may have zero pending sets after the final result is logged; it remains active until the member explicitly finishes it.

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
the message URL. Exact replay instead proves the one final sequence: original
edits, descending removals, then contiguous appends.

Positions are one-based presentation coordinates, and each coordinate within
its original-edit, original-remove, or final-append namespace may appear at most
once. The action carries no member id or canonical workout id. Its stable
one-way action binding and destructive-state binding are stale-card
preconditions, not authentication: the server derives the member from the scoped
credential and requires exactly one active workout whose stable identity,
ordered exercise names, set counts, logged states, and, for removal, complete
canonical state still match. Each edit to an existing set also carries the
bounded previous result from the typed card projection; the canonical owner
rejects the batch when that target changed instead of overwriting a newer
correction.

Web validates the whole envelope, re-checks active access and historical launch
consent under the existing member locks, and durably appends the action before
returning `202 Accepted`. An ambiguous network retry reuses the exact action id,
body, and client timestamp, so mailbox dedupe remains stable. Runtime applies the
complete batch under the existing live-workout mutation lock with one canonical
write and no model call, then records an `applied`, `unchanged`, or typed
`rejected` receipt through the same mailbox checkpoint. The editor stays locked
while polling that receipt and says the changes were saved only after an applied
or converged result. A missing, completed, ambiguous, bound-to-another, or
changed workout is rejected without retargeting.

This is the first family on the generic member-action delivery primitive. A
future direct editor adds another explicit action variant and delegates to its
existing domain use case. It does not gain arbitrary JSON paths, database
operations, assistant tools, or a new queue.

## Rollout

Deploy the native schema-version-6 reader first, the shared Web action and image
routes second, and the Worker and runner producer last. Older app versions retain
truthful captions and the static image but do not provide the drill-down workout
interface. Keep the Web route available while any sent image URL may still be
fetched.

The backend also has a persisted-state compatibility floor. Deploy V6-capable
Worker and runner bundles before any V6 card can be emitted. The accepted outbox
intent and hosted delivery side effect both persist the full response card;
after the first V6-bearing record exists, those bundle versions are the rollback
floor. A warm older bundle must not process that state because its strict parser
rejects the workout branch, and the local runner can quarantine the pending
intent out of the retry inventory. Recovery is a coordinated forward fix or
explicit restoration of the quarantined intent after the compatible bundle is
live, not rollback below the floor. Focused local-outbox and hosted-side-effect
round-trip tests pin both persisted owners.

Static rollout also requires physical macOS and no-extension iPhone proof of the
final balloon, image-failure behavior, accessibility behavior, and App Store
affordance. Provider acceptance, direct route renders, and delivery receipts do
not prove those device behaviors.
