# Retire legacy oxygen analytics

## Outcome and invariants
Stop generating legacy Junction oxygen feature envelopes and remove untouched legacy
feature events from the default entity, metric, and search projections. Preserve
ordinary oxygen observations, v2 temporal analytics, canonical source evidence,
member corrections, and complete query SQLite restore.

## Architecture and product decision
The importer owns production; shared query eligibility owns historical visibility.
Retire the exact v1 importer-owned class, not numerical zeros or metric prefixes.
Keep canonical historical evidence intact. Conservatively retain any revised event
because a later revision can be a member correction even when source remains device.
This avoids a new canonical migration, tombstone journal, or provenance owner.
The query schema transition rebuilds old restored projections under the new policy.

Product change: generic queries no longer expose untouched legacy v1 analytics;
ordinary oxygen readings and v2 outputs remain. Corrected legacy records remain
available. No UI or prompt change. Proof covers sparse and supported imports,
member revisions, direct/stored queries, search, and an old projection rebuild.

## Work
- [ ] Remove the legacy oxygen reducer and producer call; retain input bounds.
- [ ] Apply one exact eligibility predicate to entities, search, and metrics.
- [ ] Test importer and historical/current projection paths and typecheck owners.
- [ ] Parent review, changelog, scoped PR, exact-head CI and ReviewGPT.
