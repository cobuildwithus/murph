# iMessage workout tracking

## Product outcome

A private member can run a strength workout from the Murph conversation:

- see today's ordered exercises and completed/remaining set counts;
- open an exercise to see each set's target and recorded result;
- compose an explicit command to log, correct, or finish the workout;
- receive a refreshed immutable workout card after every verified free-form gym mutation.

The experience borrows the useful workout-tracker loop—plan, log sets, correct, finish—without introducing a second workout product or data store.

## Authority boundary

- A saved workout format owns planned exercises, stable exercise identity, planned sets, and target values.
- One canonical `activity_session` workout event owns session timing, unlogged set coordinates, and actual completed-set values. Planned targets are not copied into those placeholders.
- A response card is an immutable snapshot. It never owns workout state.
- The Messages extension has no vault credentials, shared authentication state, network client, cache, or persistence.
- Every card action inserts a command into the Messages composer. The member sends it through the normal Murph conversation path, which remains the sole mutation owner.

## Response-card contract

The assistant continues authoring `compact_table` V1 through two closed shapes. A generic table keeps `rowHeader`, `columns`, and `rows`. A tracked live workout instead carries the shared title/footer fields, requires `subtitle: null`, a canonical `tracking` marker, and structured `workout` detail:

- `state`: `active` or `completed`;
- ordered exercises;
- ordered sets with `pending`, `completed`, or `skipped` status;
- a compact target string and actual-result string.

Workout state and progress summaries are derived from the structured exercise/set detail by text, provider-layout, image, and native consumers. The model does not author either a subtitle or a second generic row projection of the same state. Runtime and native readers continue accepting non-null subtitles from already-persisted and already-sent cards, but workout presentation ignores that legacy field.

Tracked workout detail requires a canonical tracking marker in durable transcript context. The native URL strips the event id and snapshot time.

Generic compact tables keep the existing schema-version-3 native envelope. Enhanced workout tables use the bounded schema-version-4 envelope. Both stay under the existing 2,048-character URL ceiling.

The readable response-card contract remains object-shaped for authoring and runtime validation. Only the immutable V4 native wire uses positional exercise tuples `[name, sets]` and set tuples `[status, target, actual]`; removing repeated wire keys keeps realistic six-exercise, four-set initial, late-active, and completed snapshots below the same URL ceiling without adding another projection owner.

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

The bitmap remains rectangular and badge-free because Messages owns the outer
mask and app icon, but its header keeps the provider's upper-left icon footprint
clear. Removing the image-owned logo must not move title text beneath the
provider overlay.

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
fallback complements the canonical App Store identity in Linq's card payload;
neither path changes the installed-extension route or application authority.

## Plan versus actual

Targets and actual results must remain distinct:

- planned targets come from the verified workout format;
- completed actuals come from the verified canonical workout event;
- a target is never evidence that a set was completed;
- pending planned sets become skipped only when the workout is explicitly finished;
- additional actual sets beyond the format are included with no target.

An active workout may have zero pending sets after the final result is logged; it remains active until the member explicitly finishes it.

## Command loop

The native app composes explicit one-based commands such as:

- `Log workout exercise 2 set 1: `
- `Correct workout exercise 2 set 1: `
- `Finish this tracked workout.`

The assistant resolves the command only when one tracked workout is unambiguous in the same private conversation. It may prefer the latest verified snapshot only when no second session is plausible; the inserted text itself is never identity or write authority. This keeps the common path to one tap and one sent reply. An ambiguous older card deliberately requires one narrow clarification instead of carrying a native correlation token, canonical event id, or write authority.

The command numbers are one-based presentation positions, not canonical workout-order values. For set commands, the assistant resolves the exact active event, checks that the card's ordered exercise names and set counts still map unambiguously to it, and translates each display position to the current canonical `exercise.order` and `set.order`. It invokes the targeted `workout set log` or `workout set clear` command with the canonical workout id, exact displayed exercise name, and mapped orders. The card never offers a generic “complete at target” shortcut because range, AMRAP, null, and qualitative targets are not concrete actual performance. Card-driven set logging requires the mapped set to exist, so a stale name, order, or position fails instead of appending a new set.

Finish branches before the active-only set preflight. The assistant invokes the exact event's idempotent `workout finish` command and accepts an already-completed return as convergence, allowing a refreshed completed card after an earlier response or delivery failure. The command owner preserves unrelated state and returns the verified canonical event; only that success permits a refreshed immutable card.

## Rollout

Deploy the native schema-version-4 reader first, the shared Web image route
second, and the Worker and runner producer last. Older app versions retain
truthful captions and the static image but do not provide the drill-down workout
interface. Keep the Web route available while any sent image URL may still be
fetched.

The backend also has a persisted-state compatibility floor. Deploy V4-capable Worker and runner bundles before any V4 card can be emitted. The accepted outbox intent and hosted delivery side effect both persist the full response card; after the first V4-bearing record exists, those bundle versions are the rollback floor. A warm older bundle must not process that state because its strict parser rejects the workout branch, and the local runner can quarantine the pending intent out of the retry inventory. Recovery is a coordinated forward fix or explicit restoration of the quarantined intent after the compatible bundle is live, not rollback below the floor. Focused local-outbox and hosted-side-effect round-trip tests pin both persisted owners.

Static rollout also requires physical macOS and no-extension iPhone proof of the
final balloon, image-failure behavior, accessibility behavior, and App Store
affordance. Provider acceptance, direct route renders, and delivery receipts do
not prove those device behaviors.
