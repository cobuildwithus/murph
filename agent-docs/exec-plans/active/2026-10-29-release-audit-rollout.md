# Release audit rollout and native canary recovery

Status: active
Created: 2026-10-29
Updated: 2026-10-29

## Goal

Ship the reviewed audit fixes to production Web and hosted runtime, verify iOS TestFlight delivery, and recover both protected native canaries.

## Authority and constraints

The user explicitly authorized backend, iOS and TestFlight deployment and native canary fixes. Preserve unrelated checkouts. Production secrets remain in protected workflows. No production identity reset, rollback or App Store review submission is authorized. Completed audit evidence remains immutable.

## Tasks and gates

1. Merge current main into the owned backend fix branch, complete focused proof, publish PR 4397 and run final ReviewGPT concurrently with CI.
2. Qualify reviewed native main revisions with green main CI through protected live runs on new immutable tags before promoting controller pins. Run controller contract tests and repeat protected canaries after the policy and deployed Web converge.
3. Merge the backend only with resolved review, exact-head checks and mergeability; verify production Web and dispatch the normal protected gradual Cloudflare rollout with predeploy and live smoke gates enabled.
4. Establish current iOS upload state. The release PR records successful upload of 1.1.24 (57); do not duplicate an already uploaded build. Confirm TestFlight processing and tester availability through supported authenticated access if available.
5. Diagnose remaining native failures using closed stage summaries. Correct proven causes without weakening assertions or exporting private logs.
6. Record actual receipts, external blockers and final rollout status; close this plan only after the task outcome is established.

## Evidence so far

- Backend merged current main cleanly. All 66 focused auth/deletion tests pass, including real PostgreSQL proof across the encrypted session boundary.
- Standalone Web typecheck exposed missing DOM async-iteration declarations for the existing bounded asset-import stream. Add the standard library declaration without changing runtime code.
- iOS main 49c2994b9cf709a281bd93995fb0679430fe9fe5: CI 40580321375 passed. Includes protected inbox probing and closed login diagnostics absent from the old controller pin.
- Android main 916813760e1585ec84dc7ac1f1dcf75f874eae48: CI 40412071292 and instrumentation 40412071279 passed. Includes first-party auth and removal of the old Privy dependency.
- New native tags point directly to these reviewed commits. Advancing source does not itself prove recovery; the real protected journeys must pass.
- iOS release PR 284 records build 57 upload success and Apple processing acceptance; TestFlight availability was not verified there.

## Candidate review and CI recovery

- Round 1 ReviewGPT passed on fe6f3003c7515ecfa28726b5ab3d87aac8dbaafa using the Mountain managed lane. Eragon failed model selection before submission; it produced no review result.
- CI exposed a retained inline type import from the homepage server-only helper in the dev compiler. An explicit whole-declaration type import erases that dependency. Nine focused real Chromium journeys and Web typecheck pass after the correction.
- The broader Core suite expected duplicate archive recovery after an interrupted append. Prepared-append rollback now invokes that existing reconciliation first, preserving the original archive byte-for-byte and removing its identical plain duplicate. The expectation now checks that restored preimage and a successful subsequent append/replay. All 52 focused Core tests and its typecheck pass.
- Regenerated the CLI skill hash after the Zod update; config schema and generated types did not change. Package-shape verification and CLI typecheck pass.
- Complete first-provider input capture with the current production builders and installed Codex, using the locked prior Zod 4.5.4 versus candidate 4.6.6, reports identical byte lengths: individual 167088, group 145632, group tools available 154646. Registered tool bytes are 43065, 44811 and 69310 respectively. The scripted-loopback capture excludes only prompt_cache_key; no exact model tokenizer is available, so token counts are unclaimed. Runtime-generated request identities differ; equal byte length alone is not byte equality.
- Earlier protected iOS diagnostics already prove fresh email receipt and code entry, then post_code_messaging_setup. This is a fixture-onboarding blocker: the ordinary production contract requires a conversational phone or Telegram channel. Asked the user to complete normal setup or arrange an already-onboarded protected test identity. No bypass or production identity mutation was performed.

- Focused live schema journey passed with GPT-6.1 Sol using local subscription auth: one model/reasoning update, no duplicate effect, and a concise truthful next-message confirmation. UX verdict Ready. The canonical reminder journey could not start with either available binary because both lack the required native patch; no provider action occurred in those attempts. Existing Frog coverage records that launcher limitation.
- CLI dependency isolation reproduces the exact old fingerprint under Zod 4.5.4 and the regenerated fingerprint under 4.6.6. Both skill-hash tests pass. No independent CLI command topology change was introduced.

- The next platform shard reached Contracts and exposed two stale generated schema files after the Zod update. Regeneration adds only four starts_with format annotations to fields whose existing sha256 prefix patterns are unchanged. All 390 Contracts tests, emitted-artifact examples and both Contracts typechecks pass. No schema source or runtime validator changed.

- CLI import-surface CI measured 321 modules against a 320 ceiling. Isolated built-CLI probes with the locked Zod versions reproduce base 320 / candidate 321; the entire difference is zod/v4/locales/tg.js (96 versus 97 Zod modules), with no new package. Admit only that measured module.
- Pre-promotion protected canaries launched against verified production Web 207c9002802032ab689702395d4d1c4132c942f3: iOS run 40820646560 and Android run 40820648859. Both use non-destructive existing identities and reviewed immutable native tags; successful live qualification remains required before pin promotion.

- Android qualification run 40820648859 failed before app-stage proof with gradle_failed. Native main already repaired its separate synthetic workflow for proven Ubuntu emulator runtime/disk prerequisites in Android PR 64; the protected workflow lacks that repair. Investigating and applying it in an isolated Android checkout. Remove both unqualified pin rotations from the backend release until live qualification passes.
- CLI import-surface guard now passes all three tests at the measured 321 ceiling; CLI typecheck passes.
