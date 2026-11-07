# Remove persona selection and onboarding ceremony

Status: completed
Created: 2026-10-19
Updated: 2026-10-19

## Goal

Remove main/supporting persona selection and its four-step website onboarding. Keep the existing Classic assistant defaults, explicit tone, voice and style-level preferences, contact-card setup, and account-owned onboarding completion.

## Scope and owners

- Delete the persona picker, visual study, preview audio and generator.
- Simplify existing settings and home handoff rather than adding replacement UX.
- Retire bespoke persona catalog and conversational selection at the contracts and assistant owners; normalize persisted retired values at existing read boundaries.
- Preserve `/compare`, contact avatars, generic voice previews and existing explicit accessibility/style preferences.
- Preserve installed companion response compatibility where its client lives outside this repository; do not introduce a new migration system or drop persisted columns.

## Product UX

- Outcome: new web members reach Home without personality questions; text members can still add Murph to Contacts.
- Entry and promise: pending account onboarding opens existing contact picker only for a text contact; add, skip or dismiss completes existing account onboarding. Other members complete without a dialog.
- Affected people: new text and non-text members, existing members with retired persona values, members with explicit tone/voice/style preferences, installed companion clients.
- Proof: focused home/contact, settings, preferences and prompt tests; relevant typechecks; assistant real-Codex journey and rendered settings proof where available.
- Done when: no selection UI or 36-persona behavior remains; retained controls and account completion work.

## Risks and mitigation

Existing companion clients use shared completion and catalog responses. Preserve their wire shape with Classic default compatibility and inspect deterministic route tests. Runtime and Web deploy separately; retain persisted read normalization and report any unsupported mutation skew.

## Tasks

1. Remove website picker, assets and onboarding ceremony; preserve existing contact and preference controls.
2. Remove runtime persona catalog selection and normalize retained data.
3. Update current documentation, tests and changelog; run focused verification.
4. Review diff/privacy, close plan, commit and push isolated draft PR for parent completion review.

## Verification

- Web UI/settings/home suite: 10 files, 123 tests passed; follow-up settings, style, onboarding, adapter and changelog suite: 7 files, 171 tests passed. Contact Safari handoff: 6 tests passed; account settings normalization: 18 passed.
- Web typecheck passed after generated Health Commons inputs were ready; the earlier prepared check lacked the generated biomarkers JSON.
- Actual retained production Settings controls rendered in Chromium at 390px and 1440px; both passed and screenshots were inspected. Only an inert representation was added to the existing design catalog; no replacement product interface was added.
- Contracts, hosted-execution and assistant-engine typechecks passed. Focused runtime, contract, core, and adapter suites passed; final compatibility regressions passed: core preferences 24, contracts/schema 25, hosted compatibility 17, engine persona/tool 14, engine group-tool 114, Web pending-group/adapter 54. Core typecheck also passed after canonical writer normalization.
- Real-Codex future preference and one-off tone journeys passed with GPT-6.1 Sol using local subscription after allowed alternate-home retries. Future preference produces exactly one tone update; one-off produces no writes. Both replies reviewed Ready.
- Complete scripted-provider request capture at baseline `3eb2eec191e4a58b663773443aaa872ad7235285`: individual 178609 to 177288 UTF-8 bytes (-1321; -0.739604%); group 155434 to 155434 bytes (0%). Baseline engine/delegation source uses candidate public dependencies, adapter, installed Codex and model catalog; prompt_cache_key excluded. Exact target-model tokenizer unavailable; no token estimate substituted.
- Complexity guard and docs drift pass; existing unrelated hotspots are unchanged. Added-content privacy and repository-local effective commit identity checks passed.

## Compatibility review

Parent/Claude review identified raw vault validation and rollout paths that bypassed preference read normalization. The final boundary accepts only finite known retired identifiers in stored data and old wire payloads, normalizes effective behavior to Classic, and keeps current model tools free of main/supporting selection. Shared pending-group parsing preserves stored setups in both Web and runner. No database migration, new state owner, or replacement UI is introduced.

## Remaining delivery evidence

Parent owns final Claude/ReviewGPT and exact-head CI. Exact tokenizer counts remain unavailable. The installed GitHub CLI lacks image attachment support, so inspected local screenshot artifacts were not published; branch preview currentness remains a parent review item.
Completed: 2026-10-19
