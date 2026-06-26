# PR 295 ReviewGPT round 6 fixes

## Goal

Resolve the accepted high-impact ReviewGPT round 6 findings for the hosted
Retell phone-calling PR without expanding the architecture.

Success criteria:

- Duplicate phone-call request keys replay only within the signed hosted member
  scope; different members can legitimately use the same stable tool key.
- Retell calls fail closed before provider start unless deployment config
  declares the agent/version storage mode as basic attributes only.
- Focused tests and owner typechecks pass before pushing and rerunning
  ReviewGPT.

## Constraints

- Keep idempotency owned by the web control-plane route and signed member
  context; do not expose member identity to the model/tool input.
- Do not add task tables, attempt tables, provider event tables, supervisors,
  queues, or a policy gateway.
- Do not persist raw Retell transcripts, webhook bodies, function bodies,
  recordings, or audio.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Change `HostedPhoneCall` request-key uniqueness to `(memberId, requestKey)`.
2. Update duplicate lookup and tests to use the composite member/request key.
3. Require `RETELL_AGENT_DATA_STORAGE_SETTING=basic_attributes_only` before
   building the Retell create-call request.
4. Document the new required Retell storage-mode env and add focused tests.
5. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready for scoped commit.

## Notes

- Round 6 accepted finding 1: `requestKey` was globally unique, so equal stable
  request keys across distinct hosted members could collide before provider
  start.
- Round 6 accepted finding 2: Retell storage mode was only observed after
  `call_analyzed`, which cannot protect the first provider-side call if the
  agent/version is misconfigured.
- Fixed by changing the persisted phone-call request-key uniqueness and replay
  lookup to `(memberId, requestKey)`.
- Fixed by requiring `RETELL_AGENT_DATA_STORAGE_SETTING=basic_attributes_only`
  before the Retell create-call request can be built.
- Verification passed:
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts --no-coverage`;
  `pnpm --filter @murphai/hosted-web typecheck`;
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-phone-calls.test.ts`;
  `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-local-e2e-support.test.ts --no-coverage`;
  `git diff --check`.
- Existing local hosted E2E blocker remains: `pnpm hosted-local e2e
  codex-image-media-delivery` cannot create the isolated local Postgres test
  database in this environment.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
