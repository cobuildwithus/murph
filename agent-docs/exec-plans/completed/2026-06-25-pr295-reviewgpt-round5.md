# PR 295 ReviewGPT round 5 fixes

## Goal

Resolve the accepted high-impact ReviewGPT round 5 findings for the hosted
Retell phone-calling PR, plus the Cloudflare E2E expectation drift caused by
the round 4 safety gate.

Success criteria:

- Phone-call request keys do not include runtime-local assistant turn ids.
- Retell `ask_murph` callbacks prove the stored Murph call row belongs to the
  live Retell call before returning approved facts.
- Automated hosted E2E tests no longer expect `create_phone_call` to be
  advertised in turns without phone-call-eligible manual input.
- Focused regressions and owner typechecks pass before pushing and rerunning
  ReviewGPT.

## Constraints

- Preserve the primitive set: call brief, hosted phone-call row, hosted runtime
  port, Retell runtime, consult path, and result handler.
- Do not add task/attempt tables, policy gateways, provider event frameworks,
  supervisors, queues, or Retell-specific assistant-engine logic.
- Do not expose secrets, direct user identifiers, local account names, home
  paths, Retell payload bodies, transcripts, or raw phone numbers in committed
  docs or logs.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Remove runtime-local turn id from phone-call request-key scope and hashing.
2. Add a regression that changing only the turn id leaves the key stable.
3. Bind Retell function callbacks to the stored provider call id and live
   status before consultation.
4. Add route regressions for provider-call mismatch and terminal calls.
5. Update Cloudflare E2E expected dynamic tools for non-phone-call turns.
6. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready for scoped commit.

## Notes

- Round 5 accepted finding 1: `createPhoneCallRequestKey` used
  `currentUserTurn.turnId`, so retry/replay with a new runtime turn could start
  a second real call for the same approved input and brief.
- Round 5 accepted finding 2: signed `ask_murph` callbacks fetched by Murph call
  id alone and could answer from approved facts even when Retell `call_id`
  mismatched the stored provider call id.
- Fixed by removing runtime-local turn id from the hosted tool request-key
  scope/hash and adding a regression that an extra runtime turn id does not
  change the generated phone-call request key.
- Fixed by requiring `ask_murph` consultation lookup to match Murph call id,
  Retell provider call id, provider, and live status before the brief can be
  used.
- Updated Cloudflare hosted-local dynamic-tool expectations so non-phone-call
  turns do not expect `murph.create_phone_call`.
- Verification passed:
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-phone-calls.test.ts`;
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts --no-coverage`;
  `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-local-e2e-support.test.ts --no-coverage`;
  `pnpm --filter @murphai/assistant-engine typecheck`;
  `pnpm --filter @murphai/hosted-web typecheck`;
  `pnpm --filter @murphai/cloudflare-runner typecheck`;
  `git diff --check`.
- Local hosted E2E attempt:
  `pnpm hosted-local e2e codex-image-media-delivery` was blocked before the
  scenario ran because the local Postgres user cannot create the isolated test
  database.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
