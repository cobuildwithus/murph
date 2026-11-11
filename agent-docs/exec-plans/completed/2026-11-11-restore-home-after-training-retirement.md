# Restore functional Home while retiring Training

Status: completed
Created: 2026-11-11
Updated: 2026-11-11

## Goal

Keep signed-in Home and its existing onboarding, messaging and usage actions. Retire Training and retain the proven group/billing simplifications without restoring unused browser cache, demand or polling machinery.

## Scope and ownership

Branch codex/simplify-web-20261110 resumes PR 4829 from clean reviewed head f60108e397d9d283a8cc20d142843a8735c672d1. The prior completed plan is historical and unchanged. Home, its actual dependencies, navigation, tests, owner docs and release notes are in scope. Voice belongs to a separate session and is untouched. Shared native replica contracts remain. The parent owns base reconciliation, final ReviewGPT, Ready admission and merge.

## Product UX

- Effort: Product change; restoration of the existing Home promise while removing Training.
- Outcome: ordinary authenticated entry reaches /home; members retain contact-card onboarding, Telegram first-message guidance, device/lab actions and usage recovery.
- Entries: normal sign-in, established accounts, pending first contact, old Home connection markers and current Settings callback URLs.
- Failure behavior: independent projection failures preserve useful actions; unknown lab state never means confirmed no labs. Existing retry UI remains. Device completion wins the marker tiebreak; initial contact onboarding waits until completion is dismissed.
- Proof: server-rendered Home journeys, contact picker/mark-completion API, usage reset/actions, authorized bounded lab projection, default destination tests, and phone/desktop browser rendering. Training stays absent from navigation and redirects to Settings.
- Done when: Home works in the selected ordinary/recovery journeys, focused checks and typecheck pass, and the parent accepts rendered evidence.

## Design decisions

Home needs one replica fact: hasLabBiomarkers. Read only the published core through the existing member/consent authority, control client and authenticated decoder. The read is bounded to two seconds and preserves empty onboarding when no replica is published and returns unknown on malformed/unreadable/timed-out data. It makes at most one replica-pointer read, one control request and one decode after existing authority checks. No refresh wake, browser provider, cache, metric-demand state or polling is added. Native/export readers remain unchanged.

Settings callback destinations remain; Home still recognizes previously issued completion query markers. Restore the actual initial-contact marker completion endpoint, not the removed Training or global provider consumers. Keep direct group handoff independent of the optional Home contact-card marker.

## Tasks

1. Restore Home and its used components/API with bounded server lab projection.
2. Restore ordinary Home navigation and login destinations; retain Settings account-management links.
3. Update focused regression coverage and real rendered proof.
4. Update current owner docs and release notes to the final scope.
5. Verify privacy, tests, typecheck, complexity and docs; close this plan and push only while Draft.

## Verification

Implementation complete. Local and remote head and clean checkout were verified before edits; PR remains Draft for parent review. Frog list reviewed; no new friction entry needed.

- Focused Web regression run: 555 passed across 31 files; four companion-enrollment PostgreSQL cases skipped without a test database. Includes original Home callback/contact/usage behavior, empty/unknown/timeout labs, restored default routing, Settings confirmations, billing helper, and group handoff.
- Web `typecheck:prepared` passed after final source changes.
- `complexity:diff --base 34d9f4edc1` passed across 63 changed source files; Home maximum remains 28.
- `docs:drift`, `docs:gardening`, added-content privacy scan and `git diff --check` passed.
- Chromium `settings-entry.spec.ts`: 3 passed. Real `/home` renders Welcome, Connect devices and Sync labs; five retired routes redirect to Settings with query preservation. Real navigation and plan confirmation plus Home onboarding/completed/unknown variants fit 390px and 1440px. The parent inspected selected synthetic screenshots. No browser replica requests occur. Local auth uses the existing secret-free smoke environment; no real sign-in, provider/payment transaction or production data was used.
- Native/export shared decoder and runtime publication remain unchanged by this follow-up. Voice-specific file overlap remains zero.

The parent owns final candidate review, ReviewGPT, exact-head CI and merge. Reconciliation with verified main is a separate integration commit, followed by affected focused proof. Final preview and selected screenshots are PR evidence, not production deployment.
Completed: 2026-11-11
