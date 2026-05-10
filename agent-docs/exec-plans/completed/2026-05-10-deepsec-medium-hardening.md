# DeepSec Medium Hardening

## Goal

Fix selected DeepSec medium findings with simple shared boundaries:

- bounded pre-auth request-body reads for signed/internal routes
- replay-safe WhatsApp consent commands and fail-closed WhatsApp member lookup
- race-free agent bearer-session authentication
- safe default logging/redaction for sensitive error/command surfaces
- high-but-finite attachment/parser/model-evidence budgets
- symlink-safe export/device-daemon writes and constrained Health Commons R2 uploads

Explicitly out of scope: global analytics placement, vault-overview sensitive-context gating, and saved-phone invite prefill/phone-number disclosure.

## Constraints

- Preserve existing user-facing saved-phone invite prefill behavior.
- Prefer shared helpers and small boundary APIs over per-route bespoke fixes.
- Keep attachment limits high enough for normal real-world use but finite.
- Preserve unrelated active worktree edits and active ledger rows.
- Avoid broad architecture changes unless directly needed for these boundaries.

## Implementation Notes

- Default fail-closed body limits should live at helper boundaries, with larger route-specific opt-ins only when necessary.
- WhatsApp command idempotency should happen before consent mutations.
- Agent bearer auth should use a single conditional mutation or equivalent fail-closed transaction.
- Redaction changes should avoid echoing raw rejected input or unsafe command details.
- Symlink protections should be centralized where writes/materialization happen.

## Verification

- Add focused tests for each changed shared boundary.
- Run truthful scoped verification for touched apps/packages, plus typecheck unless blocked by unrelated working-tree state.
- Required completion audits: security/privacy, coverage-write where applicable, task-finish review.

## Outcome

- Implemented bounded body reads, replay/idempotency guards, fail-closed auth/session lookups, safer redaction defaults, finite attachment/parser budgets, and symlink/path write hardening.
- Preserved saved-phone invite prefill by request.
- Scoped commit was not created because overlapping pre-existing dirty work would make the commit unsafe.

## Verification Results

- `pnpm exec vitest run apps/cloudflare/test/index.test.ts apps/web/test/hosted-onboarding-whatsapp-service.test.ts packages/assistant-cli/test/assistant-ui-logging.test.ts packages/assistant-cli/test/assistant-ui-rendering.test.ts packages/cli/test/foreground-terminal-logging.test.ts packages/cli/test/assistant-cli.test.ts scripts/hosted-local.test.ts packages/parsers/test/parsers-coverage.test.ts packages/vault-usecases/test/helpers-public-seams.test.ts --no-coverage` passed.
- `git diff --check` passed.
- `pnpm typecheck` was blocked by an unrelated `packages/cli/test/inbox-cli.test.ts` fake runtime-store type error requiring `getAttachment`; touched apps/packages completed before that failure.
Status: completed
Updated: 2026-05-10
Completed: 2026-05-10
