# Heart-rate challenge check-ins

## Outcome

A player records live Bluetooth heart rate during a challenge, sees the
full Start-to-Stop graph, and taps Stop & share to post the day's check-in.
Native work lives in the separate iOS heart-rate-checkins branch based on the
held game build-48 branch. This backend adds the artifact vocabulary and enforces the shared requirement.

## Invariants and approach

Reuse entry/media owners: one rendered JPEG, no sample telemetry or new health
store. Preserve game membership, encrypted media, post-to-unlock, day boundary,
idempotency, two attempts and server scoring. Add the database constraint
before clients submit the new kind. Old clients require an update to download
the new graph kind. No production mutation is authorized by local work.

## Product UX and proof

Challenge setup chooses Photo or Heart rate for both players. Heart rate
requires explicit sensor selection, fresh readings, Start and Stop & share. Empty/interrupted capture and failed
uploads stay truthful. Synthetic command, rules, view and Postgres tests prove
validation, graph readback, privacy and photo/graph shared attempt caps. Native
packet, lifecycle, simulator and physical WHOOP evidence belong to the iOS plan.

## Progress

- [x] Trace entry kind, schema constraint, media and scoring owners.
- [x] Add graph kind and bounded image validation.
- [x] Focused tests and typecheck: 56 unit and 20 isolated Postgres tests; Web typecheck passed.
- [ ] Candidate review and scoped commit.

Physical WHOOP recording and live server deployment remain separate evidence.
