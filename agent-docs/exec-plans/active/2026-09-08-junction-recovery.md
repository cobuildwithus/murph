# Make Junction operator recovery truthful and usable

Status: active
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and ownership

Operators can distinguish a shared Junction account from its selected source,
request one refresh, and see the provider outcome and a fresh source status.
Device-syncd owns provider requests and safe response interpretation. Existing
Web ops routes own authorization and target resolution. Source persistence and
the hourly reconciliation owner remain authoritative; diagnostics do not write
connection state or infer freshness from a successful read.

## Evidence and approach

Synthetic delayed responses reproduce a client deadline shorter than the
requested upstream refresh wait. The diagnostic accepts contradictory success
envelopes and the current UI exposes no recovery action or selected-source
error. Extend these existing owners; add no dependencies, queue, persistence,
automatic provider retries, or member messages.

## Product UX

- Entry: Ops runtime maintenance, existing Junction diagnostic form.
- Outcome: source status/error, one manual refresh of the shared account, and
  automatic status read after the attempt; an explicit read-only status check
  supports delayed recovery without repeating the mutation.
- Journeys: source error under an active parent; rejected/no-op refresh;
  partial/in-progress refresh; timeout with unknown outcome; connected source;
  status read failure; changed form target; denied operator access; mobile.
- Proof: provider fixtures, composed route tests, client interaction tests,
  and an inert design study of the production recovery panel.

## Tasks

1. Correct refresh deadline and timeout diagnostics without automatic POST replay.
2. Interpret provider-declared errors and empty results truthfully; expose the
   selected source status using bounded provider-list reads.
3. Reuse ops endpoints for refresh and status checks; omit irrelevant backfill
   reads during recovery and pin actions to the inspected public connection ID.
4. Compose a small recovery panel beside existing diagnostics and add focused proof.
5. Review privacy, authority, complexity and rendered states; run tests/typechecks,
   update the owner documentation, and commit the scoped change.

## Verification and delivery

Focused device-syncd client/diagnostic tests; Web ops-route and UI tests; affected
typechecks; complexity diff; browser rendering with synthetic fixtures. Exercise
provider failure and parent cancellation separately. Preserve disconnect fences
and existing diagnostic authorization. Additive response fields tolerate older
callers. Internal ops changes do not require a member changelog. Final external
review follows the completion workflow for the cross-package provider boundary.

## Progress

- Implementation complete. Existing diagnostic owners now classify refresh
  outcomes, preserve timeout identity, and expose an independent source status.
- Focused proof: 39 client tests and 46 provider diagnostic tests passed;
  22 Web route/client tests passed. Both affected typechecks passed.
- Product UX: Ready. Verified rejected refresh, partial/in-progress response,
  unknown timeout outcome, status-read failure, disconnected source denial,
  inspected-target pinning, changed-target clearing, and operator access guards.
- Rendered the real panel through the synthetic ops design study at 390 and
  1280 pixels. Inspected error and pending states, UTC receipt time, disabled
  controls, and no horizontal overflow. Removed the temporary capture spec.
- Complexity guard passed: no added debt; diagnostic runner and request failure
  handling are simpler. Existing unrelated dispatch and matrix hotspots remain
  outside this bounded change.
- Parent candidate review completed: no secrets, production rows, persistence,
  new scheduling, dependencies, or member messaging added. Existing account and
  source selection retain one authority. Shared request timeout classification
  preserves parent cancellation and never retries mutations.
- Delivery pending: candidate commit, isolated preview, required CI and final
  ReviewGPT for the provider/Web boundary.
