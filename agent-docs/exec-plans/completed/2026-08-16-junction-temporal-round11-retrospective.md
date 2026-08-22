# Junction Temporal Features Round 11 Retrospective

Status: completed decision record for PR #1703 ReviewGPT round 11 remediation.

## Original requirement

Existing Junction sync makes bounded, trustworthy within-day oxygen and stress
patterns queryable without retaining raw timelines or requiring a new member
action. Only a response that proves complete closed-day authority may replace
temporal facets, and healthy repeated operation must not grow canonical state.

## Recurrence and root cause

- Round 10 accepted that a lossy successful response could mint replacement
  authority and closed it by requiring structurally complete collections. The
  selected implementation still routes a payload without a `groups` member
  through the generic compatibility parser, so `[]`, `{ data: [] }`,
  `{ results: [] }`, and similar envelopes count as structurally complete
  zero-record collections. The compatibility path — kept for noncanonical
  envelopes and the raw-body SDK-parse fallback — silently upgrades itself
  into destructive replacement authority. The preceding round's accepted
  mechanism therefore remained reachable one parser earlier.
- Rounds 8–10 made the scheduled reconcile replay every horizon coordinate on
  every cadence and bounded the resulting `device_job` history, but every
  temporal import stamps `revisionAt` from the import wall clock and that
  value becomes each facet's source version. Canonical reconciliation treats
  identical content under a strictly newer version as a superseding event-spine
  revision, so a healthy hourly cadence appends dozens of redundant canonical
  revisions for unchanged days — unbounded ledger growth and ever-costlier
  identity-context scans one layer below the job store. The history-growth
  mechanism recurred in the canonical owner.

## Shape and decision

- Replacement authority requires grouped proof. Under
  `requireStructurallyCompleteCollection`, a successful payload without a
  `groups` member is a retryable incomplete collection; the generic
  compatibility parser can never certify a complete source day. `{ groups: {} }`
  and explicit empty group data arrays remain the only authoritative empties.
  Ordinary non-authorized fetches keep compatibility parsing unchanged.
- Temporal facet sets adopt the repository's existing unversioned
  complete-set reconciliation semantics, the same rule the stacked base uses
  for daily sums and feature envelopes: the import wall clock is no longer a
  facet source version, identical replacement sets collapse as no-ops on the
  canonical event spine, and growth, change, and removal reconcile through the
  existing serialized per-account imports. Canonical appends for an unchanged
  cadence are zero, so the ledger and its identity-context scan cost stabilize.
- Implementation attempt proved a gap the base rule cannot cover: temporal
  facets are the repository's only unversioned family subject to set-driven
  retraction, and after an authoritative-empty tombstone an identical
  repopulated delivery carries no signal that orders it above the retraction —
  the wall clock amplifies, day-scoped constants sort below the tombstone, and
  content identity carries no order. The ordering authority is therefore the
  authoritative event-set seam itself, which the per-account fence already
  serializes. Decision: complete that existing seam symmetrically in core. A
  set that declares a facet current while canonical state holds it live and
  identical remains a no-op; a set that omits a facet retracts it (unchanged);
  and a set that declares a facet current while canonical state holds it
  retracted reasserts it as the next serialized revision. Canonical state
  converges to the declared set, ordering derives from serialized set arrival,
  and no new state owner, version scheme, or comparator is introduced.
- The hourly horizon replay is retained deliberately. Late provider data and
  source widening still converge within one cadence, per-cadence work stays at
  the previously reviewed fetch/import ceiling, and with no-op convergence its
  canonical cost is flat. Gating temporal replay on generic account completion
  was rejected because it would repeat the round-3 starvation mechanism, and
  any persisted replay cursor, fingerprint, completion table, or cleanup
  service would repeat the round-8 invalid-permanent-completion mechanism.
- Add no new parser, state owner, retention process, or reconciliation loop.

## Required proof before another review round

- Regressions seed live temporal facets and replay every generic-empty
  HTTP-200 transport envelope (`[]`, `{ data: [] }`, `{ results: [] }`,
  resource-keyed empties, and the raw-body SDK-parse fallback) proving a
  retryable failure, zero canonical import, and unchanged facts, while
  `{ groups: {} }` still retracts and a valid populated grouped response still
  replaces.
- A production-composed regression runs repeated unchanged hourly cadences
  across the horizon and asserts exact bounds: zero new event-spine revisions,
  zero new evidence artifacts, and stable canonical state, followed by a
  genuine data change proving normal reconciliation still lands.
- Existing facet-only import, fail-closed row normalization, ordinary-owner
  immutability, terminal-row sweep, restart, timezone, and widening proofs
  remain green.
- After remediation and exact-head green CI, the loop continues under the
  owner's recorded run-to-completion authorization toward an exact-head `PASS`.
