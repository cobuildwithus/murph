# Exercise image visual audit and repair

Status: active

## Goal
Visually audit all 1,748 exercise carousels (5,340 images) with GPT-6 Sol reviewers, record concrete confusing or inconsistent slides, and repair confirmed visual defects using built-in image generation only.

## Scope and method
- Freeze the catalog at the task base; review each exercise against its steps, labels, and sibling slides.
- Split the full inventory into ten non-overlapping review lanes. Record every exercise as reviewed, uncertain, or unavailable, and retain slide-specific findings.
- Inspect flagged originals before repair; preserve subject, camera, equipment, style, and accurate movement phases.
- Keep downloaded images, contact sheets, reviewer ledgers, generation prompts, and replacements in ignored local task artifacts.
- Never use an image generation API key. Do not publish assets until the concrete replacements have passed visual review.
- Validate inventory coverage and asset integrity; run catalog tests and typecheck if catalog data changes.

## Progress
- Isolated task branch created; source inventory located.
- All 1,748 exercise carousels and 5,340 source images reviewed by ten GPT-6 Sol lanes.
- Confirmed 125 exercise-level fixes after correcting two false positives through full-resolution limb tracing.
- Replacements are generated with the built-in image tool and receive independent review bound to exact file hashes.
- Full before/after gallery, source receipts, prompts, replacement sequences, and review ledgers are retained in ignored task artifacts.
- Live catalog integration remains pending: the available Cloudflare login is denied Images access. ST208 and ST679 remain blocked by image-generation output moderation; no alternative API-key generation was used.

## Verification
Coverage and source checksum validation passed. All 125 finding records assemble without errors; 122 repair sets passed independent current-hash visual review. EX347 awaits a user perspective choice, and ST208/ST679 are blocked by output moderation. Replacement file/prompt checks and the public-artifact privacy scan passed. No application code, configuration, or catalog entries changed; application tests and typecheck are not applicable to the current artifact-only change.

## Remaining work
- Resolve EX347 camera choice and finish its opposite-side correction.
- Resolve ST208/ST679 tool-moderated generation through an allowed future path; no filter workarounds or alternative generation API keys were used.
- Publish approved images through authorized Cloudflare Images access, then regenerate and verify the catalog at its CSV source.
- Keep this plan active until unresolved generation and publication work is handled.

## Delivery boundary
No live catalog or deployment has changed. The audit report and local replacement artifacts are an intermediate, reviewable result. No changelog entry is needed until member-visible catalog changes ship; complexity metrics do not apply because no JS/TS is authored.

## Check details
- `python3 .tmp/exercise-image-audit/validate_audit.py`: passed complete coverage, 5,340 original SHA-256 checksums, finding references, and replacement/prompt existence.
- `python3 .tmp/exercise-image-audit/assemble_repairs.py`: all 125 records assembled with zero errors; accepted-only delivery contains 122 repair sets.
- `bash scripts/check-agent-docs-drift.sh`: unavailable because the isolated checkout lacks the repo-tools consumer shell helper. Next-best proof: changed-document link validation, privacy scan, and `git diff --check`.
- No source, runtime configuration, or catalog changed, so application tests/typecheck and a member changelog are not applicable.
