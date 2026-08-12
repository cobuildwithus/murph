# Junction temporal round-two ownership retrospective

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Original requirement

- Preserve enough within-day oxygen and stress shape for useful bounded health
  questions without retaining a timeline, raw arrays, or canonical samples.
- One genuinely complete calendar day must produce one deterministic set of
  scalar temporal facts. Partial, failed, empty, reordered, retried, or
  corrected inputs must not publish or strand misleading facts.

## Repeated mechanism

- The first-reviewed shape let an arbitrary importer payload derive temporal
  facts. Round one added transient `completeSourceDay` authority, but the
  provider minted it from UTC day windows while the importer grouped by
  provider offsets or the vault timezone. The fence moved without making one
  calendar-day owner authoritative end to end.
- Round one also added manual fixed-facet retractions only for aggregates that
  survived normalization. A successful empty resource or an omitted source had
  no aggregate, so it had no way to express authoritative absence.
- Equal-instant collapse became deterministic in the reducer, but fetch dedupe
  still discarded distinct stress or SpO2 values at the same source instant
  before the reducer saw them. The correction therefore lived downstream of
  the lossy identity owner.

## Shape comparison

- Immutable first-reviewed head: `33cdb72da0a96aeba872d448002c1924040b6d53`.
- Round-two reviewed head: `79edb1ceb2ea5191b0fbfcdef9902e1e58b71850`.
- The reviewed patch added a transient complete-day object, fetch-side date
  filtering, a temporal facet catalog, manual retractions, downstream
  equal-instant collapse, and real query tests. It still split calendar-day and
  equal-instant ownership between scheduler, fetch adapter, importer, and core.
- The correction will build on the existing summary-completeness owner branch,
  whose canonical `authoritativeEventSets` primitive already represents an
  empty current facet set. It will not duplicate that primitive.

## Requirement decisions

1. **Feature day:** the feature day is the vault-local IANA calendar day. The
   service reads the vault timezone through the existing importer/core boundary
   and passes that exact value to scheduling, fetching, and normalization.
   Provider offsets may describe a reading, but they do not redefine this
   feature's replacement day.
2. **Closure:** a vault-local day becomes authoritative only after its next
   local-midnight instant plus a conservative 24-hour lag. A reconcile near UTC
   midnight therefore cannot certify a still-open negative-offset day.
3. **Fetch window:** Junction documents that timeseries bounds accept ISO date
   times, while date-only bounds are expanded to `00:00:00` and `23:59:59`
   without documenting a timezone. The temporal owner will use one exact ISO
   half-open UTC window computed from the vault-local midnights. It needs no
   speculative adjacent-date fanout. The date-only source-day filter is
   deleted; the existing exact-window filter owns boundary trimming.
4. **Replacement domain:** each successful temporal resource/day response owns
   one connection + resource + vault-day domain across every source. It invokes
   the importer even with zero rows and emits one canonical authoritative event
   set whose current facets may be empty. Facets include the source identity,
   so omitting one source retracts only that source's old facets while retaining
   current facets from another source. Retryable failure or yield emits no set
   and therefore no retraction.
5. **Equal instants:** fetch dedupe remains the sole pre-import duplicate owner.
   Its stress and SpO2 keys preserve distinct values at the same source instant
   while collapsing exact duplicate deliveries. The reducer retains one
   deterministic mean collapse after every distinct value survives; no second
   fetch reconciliation mechanism is added.
6. **Base facts:** ordinary compact daily facts keep their existing identities
   and remain outside the temporal authoritative facet prefix. Empty or
   suppressed temporal replacement never retracts them.

## Architecture decision

- Continue the PR with an owner-boundary redesign and delete the round-one
  source-day filter plus manual `importEventBatch` retraction path.
- Reuse the vault metadata owner for timezone, the Junction provider for exact
  bounded collection, the importer for reduction, and core's existing
  `authoritativeEventSets` for canonical replacement.
- Add no queue, store, source-day lifecycle, reconciliation service, migration,
  or second canonical owner.

## Required proof

- Negative-offset scheduling near UTC midnight with no premature authority.
- Canonical `Z` and `+00:00` rows on both sides of vault midnight through the
  real client flatten/pagination, fetch window, importer, core, and query path.
- Populated to successful all-empty replacement; one source omitted while one
  remains; retryable resource failure and yield issue no authority.
- Equal-instant group/page permutations and retry converge to one query result.
- Base daily facts survive every temporal replacement, and no raw arrays or
  canonical samples are retained.

## Verification plan

- Focused Junction client/provider/service/importer/core/query tests.
- Affected package typechecks, generated schema/catalog checks, workspace
  boundary checks, docs checks, diff/privacy scans, and exact-base merge proof.
- Preserve the immutable ReviewGPT first-reviewed marker and do not launch
  ReviewGPT from this remediation.
