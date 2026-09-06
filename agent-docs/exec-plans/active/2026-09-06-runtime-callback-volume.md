# Reduce redundant hosted runtime callbacks

Status: active
Created: 2026-09-06
Updated: 2026-09-06

## Outcome and invariants

Reduce empty runtime recurrence and repeated Junction inventory/projection work.
Accepted messages must remain runnable, schedule truth must converge through the
existing checkpoint owner, and every canonical device import must retain current
source authorization. No production data or identities belong in this plan.

## Owners and evidence

The workspace assistant phase derives wake state; the workspace checkpoint owns
its durable projection. Inspection found stale-wake correction is requested on
one maintenance exit but is not propagated through all empty exits. Reproduce
that gap before changing it. This is not yet proof of the precise historical
production trigger.

DeviceSyncService owns each bounded worker drain. Junction currently reloads and
projects inventory separately for resource jobs in that drain. Projection adds a
hosted source read; canonical import authorization is an independent live read.

## Design

Reuse the existing projection-checkpoint request for disproved schedules. Keep
real pending input and unavailable authority retryable. Add no retry scheduler.
Give provider execution an explicit pass lifetime so Junction can reuse successful
inventory/projection work within that bounded lifetime. Keep provider reuse keyed
to connection/source lifecycle, discard failed work, and retain live import reads.
No TTL, persisted cache, protocol migration, or production configuration change.

## Tasks

1. Add focused failing regressions for empty wake projection and duplicate inventory.
2. Apply corrections at the current owners; exercise pending-input, failure,
   disconnect/reconnect, and new-pass boundaries.
3. Run affected suites, typechecks, complexity review, and required completion gates.
4. Update owner documentation and commit the scoped change.

## Verification

Focused assistant phase and runtime checkpoint tests; Junction resource tests and
service drain lifetime tests; both affected package typechecks. Inspect the final
diff for architectural simplicity, authority preservation, and private data.
Production percentage savings require a comparable post-release measurement and
are not a unit-test or local completion claim.

## Implementation and candidate evidence

- Reproduced an empty assistant phase returning no projection-checkpoint request
  after disproving a due default wake. The regression failed before the fix and
  passes with both an empty schedule and a future cron wake. A second corrected
  invocation does not request another correction. Entrypoint proof confirms the
  checkpoint removes the obsolete default wake.
- Added an optional provider pass executor at the existing worker-drain boundary.
  Junction owns its resource inventory loader; live import authorization is
  unchanged. Two ordinary resource jobs use one inventory and three source reads,
  versus two inventories and four source reads with independent job execution.
- Covered disconnect during provider fetch, reconnect/source epoch, connection
  generation, failed authorization reads, independent passes, and historical work.
- Assistant foreground/scheduling suites: 146 tests passed. Device-sync service,
  resource, and source-reuse suites: 208 tests passed. Focused runner and entrypoint
  checkpoint proofs passed. Both affected package typechecks passed.
- Complexity guard passes with unchanged maximum complexity and debt. Existing
  large functions remain; the added loader isolates inventory lifetime rather
  than expanding the resource job or worker control flow.
- Internal-only invocation/callback reduction; no member-visible copy, prompts,
  tools, or UI change, so no public changelog or model-based reply proof applies.
- Candidate review completed locally. Required external review and final-head CI
  remain pending. No production deployment or percentage reduction is claimed.
