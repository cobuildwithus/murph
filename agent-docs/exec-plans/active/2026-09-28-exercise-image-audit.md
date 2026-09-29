# Exercise image visual audit and repair

Status: active — catalog candidate complete; final review and merge pending.

## Goal and delivered scope
Audit every exercise carousel with GPT-6 Sol reviewers, list confusing visuals, and publish the repairs that pass independent review using built-in image generation only. The audit covered all 1,748 exercises and 5,340 original images. Of 125 confirmed exercise-level findings, 123 have accepted repairs integrated into the catalog candidate. ST208 and ST679 remain unchanged because image-generation output moderation blocked their replacements.

## Product UX
- Outcome: corrected poses, movement phases, and side changes are easier to follow in exercise demonstrations.
- Reaches: existing exercise-catalog consumers, including CLI and hosted runtime exercise lookups; no new interface or permissions.
- Proof: full original/replacement sequence review, independent file-hash QA, verified public delivery URLs, source-row and generated-catalog readback, and package runtime tests.
- Result: Ready for the 123 integrated repairs. The two blocked exercises remain explicitly deferred.

## Implementation
- Ten GPT-6 Sol audit lanes reviewed the complete frozen inventory; two false positives were cleared by full-resolution limb tracing.
- All image generation used the built-in image tool, never an image-generation API key. EX347 uses the user-approved consistent top-down perspective.
- Independent QA accepted every integrated replacement. Final integration also corrected ST024's contradictory head-turning reset arrow and re-reviewed the full sequence.
- Cloudflare Images OAuth authorization was granted. All 225 replacement references were uploaded with distinct public URLs and verified against 219 unique reviewed PNG files. Existing assets remain available.
- Exactly 123 exercise rows changed in three source CSVs. The other 1,625 rows remain byte-identical. Generated runtime artifacts contain 5,350 distinct public image URLs.
- Only ST024 and ST303 change movement instructions, correcting pre-existing title/description contradictions using the primary NHS sources linked in the audit report.
- Existing catalog test fixtures and image counts were updated; no production implementation or configuration changed.
- Member release note: `2026-09-29/clearer-exercise-demonstrations`, source PR #3804.

## Verification
- Complete audit coverage and all 5,340 source SHA-256 checksums passed against frozen catalog SHA-256 `b35ab2e78f79391da955baed4efaea7f00c957113eeb189b38c08d508ad53610`.
- All 125 finding records assemble without errors; 123 have current-hash independent acceptance.
- Upload receipts, ordered final catalog URLs, changed-ID scope, allowed field scope, and unchanged-row byte comparisons passed. Missing receipts and stale source rows fail closed in the local integration utility.
- `pnpm --dir packages/exercise-library verify`: passed typecheck, six runtime tests, and generated-artifact parity.
- `pnpm --dir apps/web changelog:generate`: passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx`: ten tests passed.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm complexity:diff`: passed; no authored production JS/TS to analyze.
- Documentation drift, whitespace, privacy, source/replacement checksums, and delivery ZIP integrity passed.

## Remaining completion work
- Final ReviewGPT on the stable pushed head, concurrently with required CI, because two exercise-form instruction corrections are health-safety sensitive.
- Parent final review and user-authorized merge of PR #3804 after required checks pass.
- ST208 and ST679 remain blocked follow-up work. No moderation workarounds or alternate generation API keys were used.

## Delivery boundary
Public image uploads are verified. Catalog changes ship through the existing package and hosted release pipelines after merge; this task does not manually deploy the Worker or Web. Original images remain available for existing readers. Local source images, exact prompts, repair packages, full before/after gallery, QA ledgers, and upload receipts are preserved in ignored task artifacts and the delivery package.
