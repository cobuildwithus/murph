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
- Exact-base isolated worktree created; patch application and current-main reconciliation are in progress.

Done:
- Read the required repository workflow, architecture, product, security, reliability, and completion guidance.
- Confirmed the supplied base commit exists locally.
- Inspected the coordination ledger and identified overlap with generated-media E2E, media-catalog deletion, and experiment-lifecycle work.
- Confirmed the primary checkout is unsafe for task edits and created a dedicated worktree through the repository helper.

Now:
- Validate and apply the supplied patch against its exact base, then inspect every changed owner and resolve missing integration coverage.

Next:
- Update durable owner docs and design-catalog proof for the changed browser share flow.
- Reconcile with current `origin/main`.
- Run focused and canonical verification plus direct hosted delivery/browser scenarios.
- Complete product, preliminary specialist, parent-final, and final ReviewGPT review gates.
- Close the plan with the scoped final commit, push the branch, open the PR, and prove green CI plus merge readiness.

Open questions (UNCONFIRMED if needed):
- Whether current Linq group-avatar APIs now expose a provider-native byte upload path; absent direct evidence, retain the fail-closed behavior.
- Whether the hosted generated-image E2E can reuse the active scenario owner without conflicting with its separate worktree; coordinate by updating only this branch and noting the overlap.

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
