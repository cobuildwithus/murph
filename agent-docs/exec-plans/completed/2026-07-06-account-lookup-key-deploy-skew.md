Goal (incl. success criteria):
- Restore `accountLookupKey` emission on new hosted Linq route-authority, mailbox-wake, and group-tool payloads while keeping readers tolerant of missing keys.
- Preserve chat-id-based routing/authorization; `accountLookupKey` remains compatibility metadata only.
- Success means old deployed web/runner code still receives the legacy required field during deploy skew, and new tolerant readers still accept missing fields for a later phase-2 removal.

Constraints/Assumptions:
- Do not revert optional reader/contracts changes.
- Do not change route lookup, authorization, membership, billing, or provisioning gates.
- No new persisted state, tables, columns, managers, or schedulers.
- Preserve unrelated branch and ledger edits.

Key decisions:
- Populate emitted compatibility fields from the current recipient line lookup key already available in the webhook path.
- Keep egress group-tool/delivery propagation preserving any populated authority field without using it for route assertion.

State:
- Implementation and verification complete; commit next.

Done:
- Read required repo workflow, architecture, security, reliability, verification, product, and fix-brief docs.
- Audited the branch diff for removed `accountLookupKey` emissions.
- Restored current-line `accountLookupKey` emission in hosted Linq route authorities and mailbox wakes.
- Preserved populated `accountLookupKey` in runtime-injected group-tool Linq thread context while deduping by chat id.
- Added/updated web, hosted-execution, and assistant-runtime regression coverage for emitted compatibility fields and tolerant readers.
- Updated the stale hosted-web dispatch assertion to verify chat-id route revalidation.
- Verified package typechecks and focused/broader touched tests.

Now:
- Commit with `scripts/finish-task`.

Next:
- Handoff with changed files, tests, verification output, and deploy-skew notes.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
- apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts
- apps/web/test/hosted-onboarding-linq-thread-route.test.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-runtime/test/hosted-runtime-group-tool-linq-context.test.ts
- packages/hosted-execution/src/parsers.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/hosted-execution/test/hosted-execution-builders-hosted-email.test.ts
- packages/hosted-execution/test/parsers.test.ts
- Verification: `pnpm --dir apps/web typecheck`; `pnpm --dir packages/hosted-execution typecheck`; `pnpm --dir packages/assistant-runtime typecheck`; `pnpm --dir packages/operator-config typecheck`; `pnpm --dir apps/web test:prepared -- hosted-onboarding-linq-thread-route.test.ts hosted-onboarding-linq-egress-engagement.test.ts hosted-runtime-linq-delivery-route.test.ts`; `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-thread-route.test.ts apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts apps/web/test/hosted-runtime-linq-delivery-route.test.ts`; `pnpm --dir packages/hosted-execution test -- hosted-execution-builders-hosted-email.test.ts parsers.test.ts`; `pnpm --dir packages/assistant-runtime test -- hosted-runtime-group-tool-linq-context.test.ts`; `pnpm --dir packages/operator-config test`; `git diff --check`.
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
