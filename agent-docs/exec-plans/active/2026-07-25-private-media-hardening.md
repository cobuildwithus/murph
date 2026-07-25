Goal (incl. success criteria):
- Make private member-generated images private by default across canonical capture storage, durable assistant response media, hosted retries, and final Linq/Telegram delivery.
- Remove data-bearing public experiment-card URLs and fail closed on group-avatar and automated progress-card paths that currently require public URLs.
- Success means private bytes survive checkpoint/restart without a public URL representation, are hash/size/type verified before provider dispatch, reach Linq and Telegram through provider-native byte uploads, and every retired public route fails closed.

Constraints/Assumptions:
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Start from the supplied exact base commit, then reconcile with current `origin/main` before final verification.
- Preserve existing intentionally public catalog/exercise images.
- Preserve user-critical generated-image delivery through Linq and Telegram; text fallback remains valid only where the existing response-media contract already supports it.
- Do not introduce another media service, queue, persisted state owner, or Cloudflare-specific private-media abstraction.
- Keep private media, health values, local paths, credentials, and direct identifiers out of logs, review artifacts, fixtures, docs, and PR text.

Key decisions:
- Add one shared `vault_image` response-media variant whose descriptor binds a normalized vault-relative ref to SHA-256, byte count, filename, MIME type, and bounded display metadata.
- Keep canonical generated image bytes in capture-owned vault storage and defer byte loading until the final channel boundary.
- Reuse Linq's existing attachment upload and Telegram's existing multipart delivery model.
- Preload and verify private media before recording provider-dispatch start so retry state cannot bless changed bytes.
- Tombstone legacy public upload/card endpoints instead of retaining a second private/public representation.
- Remove model-visible group-avatar generation until the provider supports a genuinely private ingestion lifecycle.

State:
- Implementation is stable on current `origin/main`; focused, full assistant-engine, and direct hosted delivery proof are green. Product/preliminary/final review gates and final canonical verification remain.

Done:
- Read the required repository workflow, architecture, product, security, reliability, and completion guidance.
- Confirmed the supplied base commit exists locally.
- Inspected the coordination ledger and identified overlap with generated-media E2E, media-catalog deletion, and experiment-lifecycle work.
- Confirmed the primary checkout is unsafe for task edits and created a dedicated worktree through the repository helper.
- Applied the supplied patch against its exact base, repaired malformed patch hunks, and reconciled the result onto current `origin/main`.
- Added and verified the shared `vault_image` contract, vault byte verifier, durable side-effect persistence, callback preverification, Linq attachment delivery, Telegram multipart delivery, and hosted generated-image capture path.
- Tombstoned the public generated-image upload and experiment-card URL routes; removed group-avatar generation from the model-visible action schema; changed scheduled experiment summaries to private text/optional voice.
- Reworked explicit browser result sharing to an authenticated same-origin POST with a private no-store PNG response, native File sharing/download, loading/retry states, and real production-component design studies.
- Updated the affected architecture, security, reliability, capture, experiment, group-chat, Cloudflare deployment, and test-owner documentation.
- Regenerated the CLI command metadata through the supported repository generator after the source-only generator entrypoint proved unavailable without workspace builds.
- Passed focused contract, channel, callback, CLI, Cloudflare, Web, automation, and typecheck coverage.
- Passed the full assistant-engine owner suite: 173 files passed, one explicitly skipped; 2,666 tests passed and five explicitly skipped.
- Passed `pnpm hosted-local e2e codex-image-media-delivery`: both public catalog URL delivery and private generated-image vault capture, Linq attachment upload/send, and next-turn reference reuse completed.
- The first complete `pnpm test:diff` rerun passed every preflight, affected typecheck, assistant-engine test, and assistant CLI test before one untouched assistant-runtime clinical-records preemption test timing-flaked; its exact isolated rerun passed.
- Added the required design-catalog component and section registrations. The mandated browser runtime exposed no installed target, so desktop/mobile rendered captures remain unavailable.
- Attempted the required Claude Fable UI double-check; it stopped at explicit usage-credit exhaustion, so policy forbids an Opus fallback.

Now:
- Resolve the required product-experience audit, commit/push the review candidate, and run the preliminary unified prompt/frontend/coverage ReviewGPT pass.

Next:
- Resolve preliminary findings, run the parent final review, rerun canonical diff/acceptance verification, and close this plan with `scripts/finish-task`.
- Push the final head, run final ReviewGPT concurrently with CI, and prove merge readiness against current `main`.

Open questions (UNCONFIRMED if needed):
- Whether a browser target can be attached before final handoff so the required desktop/mobile design-catalog evidence can be captured; current browser discovery returned no targets.
- Whether current Linq group-avatar APIs will later expose provider-native byte upload; the current patch deliberately retains fail-closed behavior until that capability exists.

Working set (files/ids/commands):
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/assistant-engine/src/assistant/{response-media.ts,channels/**,vault-file-send.ts}`
- `packages/assistant-engine/src/assistant-codex/{generate-image-tool.ts,dynamic-tools.ts}`
- `packages/hosted-execution/src/side-effects.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `apps/cloudflare/src/{hosted-provider-effects.ts,runner-outbound/generated-images.ts}`
- `apps/web/src/lib/experiments/share-card.ts`
- `apps/web/app/(dashboard)/experiments/**`
- `packages/cli/src/commands/experiment.ts`
- focused tests, hosted-local E2E, design catalog, and current owner docs
- `pnpm test:diff ...`
- `pnpm verify:acceptance`
