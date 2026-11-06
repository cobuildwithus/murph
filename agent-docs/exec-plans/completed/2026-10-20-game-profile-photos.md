# Synced weekly game profile photos

## Outcome and invariants

Members explicitly upload their own profile photo once and see it across their
devices and games. Viewer-private contact overrides remain private, with separate
canonical URLs for shared exports. Public invite previews do not gain photos.

## Owner and implementation

`game_profile.photo_key` owns the reference; the existing sealed game media store
owns bytes. Existing profile writes lacked photo state, while contact labels
already held independent private references. Extend that owner with nullable,
additive state and partial updates rather than adding another service. A photo-only
write does not read then overwrite unrelated name/time-zone fields; its reply
comes from the database write. Require owned completed uploads before persistence.
Canonical media reads require self or shared game/addressed-rematch participation;
entry unlock authorization remains independent. Removal changes only the profile.

## Product UX proof

Exercise initial setup, explicit save and cross-device readback, join defaults,
private-override precedence and export separation, replacement/removal, concurrent
name/photo writes, missing/foreign uploads, stranger denial, public-preview
exclusion and addressed rematch defaults. Native rendering belongs to the parent.

## Deploy and recovery

Expand schema before Web, then native. Old name/time-zone calls preserve photos.
No backfill or auto-upload of private local photos. Rollback Web may leave the
nullable column in place; new clients require the new Web profile reply to save.
No deployment or merge authority delegated to this task.

## Progress

Implementation complete. Product UX backend walkthrough: Ready. Fifty-one
focused command/view/route/media cases and nineteen real PostgreSQL service
cases pass, including cross-device readback, join defaults, override/export
separation, update/removal, concurrent partial updates, wrong/missing uploads,
stranger refusal, public-preview exclusion and addressed rematch defaults.
All migrations, including the nullable profile column, applied successfully to
an isolated local test database. Hosted-Web typecheck, focused oxlint,
`git diff --check` and `pnpm complexity:diff` pass (zero hotspots above 20).
Native rendering, physical-device upload and production rollout belong to the
parent release. Required exact-head CI and ReviewGPT follow the candidate commit;
no merge or deployment is included in this delegated work. Public changelog is
not applicable yet: this dark backend foundation requires the unreleased native
photo editor before members can experience it.
Status: completed
Updated: 2026-10-20
Completed: 2026-10-20
