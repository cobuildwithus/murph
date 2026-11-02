# Exact links for older meal photo uploads

## Outcome and order

Ship exact historical upload links first, then implement private retained meal
thumbnails in a separate PR. No iOS changes, timestamp inference, member messages,
production writes outside deployed code/jobs, or inspection of private meal content.

## Evidence and design

The canonical app import already stores `externalRef` with system
`meal-photo-capture`, resource type `photo`, and the server capture ID. Automatic
capture IDs equal the phone upload ID. Manual capture IDs are member-bound hashes
and cannot recover the original UUID. Existing member-bound mailbox dedupe keys
separate automatic enrollment uploads from manual uploads without decrypting content.

Project only the meal ID and exact capture reference into the existing encrypted
core entity attributes. At API read time, match those candidates against retained
automatic mailbox metadata in one set query. Keep explicit canonical upload IDs;
leave unmatched, manual-only, texted and typed meals null. Never change canonical
vaults or fetch photo bytes. Existing saved snapshots gain evidence on ordinary
publication; Web safely accepts old snapshots during rollout.

## Work

- [x] Trace upload, canonical import, projection and retained metadata owners.
- [ ] Implement read-time exact recovery with bounded metadata output.
- [ ] Prove automatic/manual/foreign/missing/removed cases and list/detail parity.
- [ ] Focused tests, typecheck, candidate review and ReviewGPT alongside exact-head CI.
- [ ] Merge, deploy Web/runtime, verify production metadata and report coverage limits.

## Product UX

Patch. Automatic older uploads regain local phone associations after publication.
Unrecoverable manual and texted meals remain plain tiles. Explicit IDs and meal
removal retain their existing behavior. Thumbnail delivery is the subsequent PR.

## Environment

The supplied checkout failed repository worktree authorization during install.
Created a sanctioned checkout with the repository helper and continued on
`codex/meal-photos-exact-approved`. No guard overrides or forced cleanup.

## Candidate evidence

- Query projection: 14 tests pass, including encrypted core round-trip provenance.
- Web Meals routes: 32 tests pass, including legacy recovery in both endpoints,
  final authority revalidation, no provenance response leakage and removal bypass.
- Real local PostgreSQL through the production Prisma adapter proves automatic
  duplicate receipts deduplicate, manual hashes and foreign/wrong-kind rows fail
  closed, missing receipts stay null, explicit IDs win and removed meals stay absent.
- Query and Web typechecks pass. Complexity guard passes with no hotspots over 20.
- Product UX: Ready for server release; legacy snapshots wait for ordinary
  publication. No iOS code or forced runtime wake is part of this change.
- Changelog decision: server association groundwork for the separate native
  integration; no newly accessible application presentation in this PR.
Status: completed
Updated: 2026-11-02
Completed: 2026-11-02
