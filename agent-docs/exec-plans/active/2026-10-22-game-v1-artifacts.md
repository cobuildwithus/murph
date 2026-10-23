# Game v1 artifacts and locked previews

Status: active
Created: 2026-10-22
Updated: 2026-10-22

## Outcome and invariants

New games allow a different artifact each day: photo, words, heart-rate summary,
route summary, or rep tape. Legacy photo and heart-rate requirements still apply.
Keep the two-attempt limit. Data is sealed per poster before transactions and
opened only for visible entries. Locked partner days expose only posting time
and an optional device-rendered blur preview. Recap reveals live entries.
No raw heart-rate samples, route coordinates, server maps, or dare-bank endpoint.

## Scope and owners

Reuse command validation, pure rules, the locked service and viewer projection.
The previous PR owns all DDL, including nullable payload and blur columns.
One strict payload validator owns the three summary shapes and excludes unknown
fields. Terms store any for new games; chat omits that optional field and its
existing photo-save path permits any. Group-chat lifecycle and prompt changes
remain in lane A.

## Product UX

Effort: feature. Replay each artifact, invalid payloads, legacy kind enforcement,
partner-before-viewer lock, unlock after viewer posts, withdrawal/retake, and recap.
A corrupt locked payload must not be decrypted. No payload reaches chat or push.
Use focused request/response API smoke with real auth and local PostgreSQL.
No new Web presentation is needed: new invites describe free daily artifacts.

## Tasks

1. Add strict per-kind payload/media/text validation and optional blur metadata.
2. Seal data and expose it only through the existing visible-entry set.
3. Add command, rules, views, Postgres privacy and API smoke proof.
4. Update owning product/security docs and changelog; run focused checks.
5. Parent review, requested Codex deep review, scoped finish-task commit.
6. Push Ready candidate, sensitive ReviewGPT concurrently with exact-head CI.
7. Rebase onto main after PR 2, merge only with all gates green.
8. Verify production admission, health and exact-deployment identity.

## Verification

Pending. Focused game tests, game Postgres/API smoke, Web typecheck/lint,
complexity:diff, logs:guard and docs:drift. ReviewGPT and CI remain release gates.

## Status

Stacked on the rules candidate. Artifact implementation in progress.
