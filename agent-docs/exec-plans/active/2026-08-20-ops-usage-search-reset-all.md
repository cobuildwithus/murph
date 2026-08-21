# Add Ops usage search and reset-all recovery

Status: active
Created: 2026-08-20
Updated: 2026-08-21

## Goal

Make `/ops/usage` fast to use during support recovery by letting an authorized
operator find a member from identifiers already supported by the hosted privacy
model, reset that one member through the existing safe action, or explicitly
reset every currently eligible hosted allowance.

Success means:

- search filters the complete matching result set without paginating search
  results, while the ordinary unfiltered list keeps its current bounded cursor
  pagination;
- member ID, exact verified email, and phone last-four searches require no
  contact decryption scan;
- the global action is visually prominent, unambiguously ignores the active
  search, and requires typed destructive confirmation;
- reset-all reuses the canonical per-member reset semantics, preserves
  immutable usage history and purchased credits, and performs bounded database
  and runtime work per request; and
- partial completion, stale state, in-flight notices, and pending runtime wakes
  are reported truthfully and can be retried without duplicating Starter
  recovery grants.

## Product UX

Effort: Feature. This adds a new operator-wide recovery authority and a new
identifier-based entry path to an existing billing-adjacent surface.

### Outcome

An authorized operator can quickly locate the right hosted member and restore
one or all eligible allowances without exposing decrypted contact data or
silently changing historical usage and credit truth.

### Entry and promise

The operator enters through `/ops/usage`. Search returns one non-paginated,
bounded matching set. A row reset keeps the existing confirmation and recovery
path. `Reset everyone` ignores any filter, explains its whole-population scope,
requires the operator to type the confirmation phrase, and shows batch progress
through a final reset, skipped, pending-wake, and failed summary.

### Affected people and recovery

- Operator locating one member: an exact verified email uses the existing
  blind index, phone last four uses the persisted masked hint, and member ID
  uses the hosted-member owner. The result exposes no decrypted email.
- Operator resetting paid, Family-sponsored, or group-container usage: current
  included spend and blocking are cleared through the existing compare-and-swap
  transaction; history and purchased credits remain unchanged.
- Operator resetting an exhausted Starter member: the existing canonical reset
  appends one policy-sized recovery grant. A retry after commit cannot append a
  duplicate grant.
- Member with concurrent usage or an in-flight notice: stale or temporarily
  unsafe work fails closed for that member and remains visible in the final
  batch result instead of making the global action look fully successful.
- Member with valid included allowance but no materialized zero-usage period:
  the member-locked owner records a stable skip without creating a period and
  the batch advances; later accounting remains later usage on replay.
- Interrupted operator: each request handles a fixed small batch. Retrying from
  the last acknowledged cursor, or recovering from the beginning after an
  ambiguous response with the same operation UUID, reuses immutable member
  receipts rather than applying a second reset.
- Member created after the confirmed population walk: wake recovery pages only
  the operation's existing wake-required receipts, so the later member cannot
  be reset or granted capacity under the old confirmation.

### Deliberate exclusions

- No partial or fuzzy email search; encrypted email values are never scanned or
  decrypted to build results.
- Search does not change whole-population summary totals.
- Reset-all is not atomic across the whole population and does not pause new
  usage while later members are processed.
- No new queue, scheduler, persisted campaign, or duplicate usage read model;
  the only new persisted authority is the per-member immutable effect receipt
  required to make retry safe after later included usage or grant consumption.

### Done when

- Desktop and narrow layouts keep search, the global action, row actions,
  confirmation, progress, and recovery readable and reachable.
- Search results are complete up to a documented safety cap and clearly ask for
  a narrower query if that cap is exceeded; search results have no page controls.
- Reset-all processes only a small fixed batch per authenticated same-origin
  request and reports partial completion without claiming an atomic reset.
- Focused service, route, rendered-client, and privacy regression tests pass,
  followed by the required Web typecheck, exact-head CI, specialist ReviewGPT,
  sensitive final ReviewGPT gate, and parent final review.

## Implementation

1. Extend the existing hosted Ops usage read owner with normalized search and a
   bounded non-paginated search result mode. Reuse the verified-email blind
   index and persisted masked phone hint; never decrypt contact fields for
   search.
2. Add the URL-backed search form, clear/recovery states, result count/cap copy,
   and query-preserving ordinary pagination. Reuse installed base-UI/shadcn
   primitives and the existing Ops usage design study.
3. Add one authenticated same-origin reset-all operation that reads and applies
   a fixed small ID-ordered batch through the canonical per-member reset owner,
   atomically records its stable outcome in one per-member receipt, then
   performs runtime rechecks only after each database transaction commits. Once
   population work completes, recover pending wakes from the operation's
   receipt set without re-reading live members or re-entering reset work.
4. Add a prominent destructive control, typed confirmation, progress and final
   outcome UI. Disable conflicting row mutations while the global action runs.
5. Add focused regression coverage and update the owning hosted usage contract,
   Web documentation, reliability/load notes, and existing design study only as
   required by the final behavior.

## Verification

- Run focused Vitest suites for the Ops usage service, mutation route, and
  rendered client, including exact email blind-index search, phone hint search,
  member-ID search, result capping, global batch bounds, partial failures,
  ambiguous retry safety, and responsive interaction states.
- Run the Web app typecheck and focused lint/static proof selected by the testing
  map, plus `git diff --check` and a secret/identifier scan of the final diff.
- Render the real production component from the existing Ops usage design study
  and inspect desktop and phone states for search, confirmation, progress, and
  partial completion.
- Push the candidate, run preliminary Product UX/frontend/coverage ReviewGPT and
  the sensitive final ReviewGPT gate concurrently with exact-head CI, resolve
  accepted findings, and complete the parent final review before merge.

## Deployment

Deploy the additive Web database migration before the Web build; there is no
Cloudflare protocol change. The prior Web build remains compatible after the
table exists, so rollback does not require dropping the receipt table. After
deploy, use synthetic or staging data to prove one exact-email lookup, one
phone-hint lookup, one single-member reset, an included reset whose response is
replayed after new usage, and a consumed Starter grant replay. Confirm each
same-operation replay reuses one receipt and that pending runtime wakes recover
without reapplying usage mutation or admitting a member created after the
original population walk.
