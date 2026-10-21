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
- [x] Candidate review and scoped commits; two final ReviewGPT rounds passed.

Physical WHOOP recording and live server deployment remain separate evidence.

## Completion evidence

The final behavior is in backend PR 4284 and native PR 205. Round 2 ReviewGPT
passed at fa8e32905df789fdb5dfbb7178314e3b8af50b87 with no qualifying findings.
The CI-discovered migration routing omission was corrected through the existing
compatible-migration owner. The real guarded migration entrypoint passes on a
fresh isolated database, followed by all 20 game service tests. The 71 deployment
guard tests, Web typecheck and complexity guard pass. Synthetic invite rendering
passes at phone and desktop widths.

This completion receipt changes no runtime behavior. Required CI on the final
commit remains a landing gate. The native game release hold and physical iPhone,
WHOOP 4 and Oura verification gaps remain recorded in the native counterpart.
Status: completed
Updated: 2026-10-21
Completed: 2026-10-21
