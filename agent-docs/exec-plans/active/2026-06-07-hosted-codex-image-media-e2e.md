Goal (incl. success criteria):
- Add a hosted-local end-to-end test and CI gate proving a Codex turn can send an attached image through the hosted image/media dynamic tool path.
- Success means the scenario is available through `pnpm hosted-local e2e codex-image-media-delivery`, is wired into hosted E2E CI, and durable CI/verification docs name the gate.

Constraints/Assumptions:
- Preserve unrelated dirty work in the checkout.
- Keep Cloudflare as execution adapter; do not add a new hosted scheduler or delivery owner.
- Use synthetic media/test payloads only; no real user/provider identifiers or secrets.
- Keep logs and artifacts metadata-only/redacted.

Key decisions:
- Exercise the turn-local `murph.attach_response_media` Codex dynamic tool directly, then assert Linq receives URL media parts on final delivery.
- Do not add another CLI directive or staging escape hatch; keep response media on the existing Codex result and delivery path.

State:
- Implementation added; final hosted-local scenario execution is blocked by an unrelated unresolved exercise seed CSV conflict.

Done:
- Read required repo workflow and hosted runtime docs.
- Confirmed `7071ad2a` already added the turn-local response media dynamic tool implementation.
- Traced final delivery: Codex provider results carry response media into the existing assistant delivery/outbox path, and Linq sends image URL media parts.
- Added the focused hosted-local scenario using `murph.attach_response_media`.
- Added the hosted E2E CI job and durable verification/CI map references.
- Passed `pnpm --dir packages/hosted-local-harness exec vitest run --config vitest.config.ts test/e2e-suite.test.ts --no-coverage`.
- Passed `pnpm --dir packages/hosted-local-harness typecheck`.
- Passed `pnpm --dir apps/cloudflare typecheck`.

Now:
- Waiting on the unrelated exercise seed CSV conflict to be resolved before rerunning the hosted-local scenario.

Next:
- Rerun `pnpm hosted-local e2e codex-image-media-delivery`.
- Commit/finish the task after the unrelated conflict no longer blocks the scoped commit path.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/hosted-local-harness/src/e2e.ts`
- `apps/cloudflare/test/hosted-local-codex-image-media-delivery-e2e.test.ts`
- `.github/workflows/cloudflare-hosted-e2e.yml`
- `agent-docs/references/testing-ci-map.md`
- `agent-docs/operations/verification-and-runtime.md`
