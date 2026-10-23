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

343 focused game/changelog tests pass. All eight game PostgreSQL suites pass
57 tests, including real-auth Request/Response API smoke through the dev routes.
Privacy proof poisons a locked payload, confirms the locked reader does not open
it, then restores it and proves recap reveal. Kind validation rejects samples,
coordinates and oversized rep arrays; the API rejects a third attempt across
kinds. Web typecheck/lint, complexity (zero hotspots), logs guard and docs drift
pass. Invite design proof passes at 390px and 1280px and the phone rendering was
inspected. The source preview is published.

The focused real-Codex any-artifact chat photo journey passes on gpt-6.1-sol via
local subscription with exactly one read and one write. Reply review: Ready.
No production prompt changes. Requested read-only Astra deep review is running.
ReviewGPT and exact-head CI remain release gates.

## Status

Implementation and focused proof complete; finishing candidate review, plan closure and release gates.
