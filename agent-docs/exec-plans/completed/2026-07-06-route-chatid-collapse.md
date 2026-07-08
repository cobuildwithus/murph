Goal (incl. success criteria):
- Collapse hosted Linq existing-thread routing and reply-egress authority onto the stable chat-id key: `(channel, threadIdentityLookupKey/chatId)`.
- Delete the silent `thread-route-authority-mismatch` drop by routing existing provisioned chats through the chat-id lookup.
- Preserve backward compatibility for already-persisted egress authorities that still include `accountLookupKey`.
- Success means old authority payloads still authorize by `(channel, threadId, containerMemberId)`, new authority payloads may omit `accountLookupKey`, and provisioning/billing/membership gates remain unchanged.

Constraints/Assumptions:
- Do not touch billing/access gates or membership/home-line gates.
- Do not change new group container provisioning or owner/home-line selection.
- Preserve ambiguity, channel-validity, `isFromMe`, empty-parts, invalid-contact, and duplicate-mailbox gates.
- No new state, tables, columns, managers, or lifecycle machinery.
- Preserve unrelated working-tree edits and active ledger rows.

Key decisions:
- Use one chat-id-keyed route reader for existing-route lookup and egress assertion.
- Accept and ignore `accountLookupKey` in external thread-route authority payloads for deploy and persisted-state compatibility.

State:
- Implementation complete; verification passing.

Done:
- Read repo workflow/security/reliability/deliverability docs and implementation brief.
- Repointed hosted thread route lookup and egress assertion to the chat-id identity key.
- Removed the silent `thread-route-authority-mismatch` ingestion drop.
- Made external thread-route authority account lookup optional across hosted-execution and assistant outbox contracts.
- Added/updated focused route, webhook, delivery callback, parser, and runtime context tests.
- Verified required typechecks and tests.

Now:
- Close the plan with a scoped commit.

Next:
- Handoff with changed files, verification output, and compatibility notes.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-routing/thread-route-store.ts
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- packages/hosted-execution/src/contracts.ts
- packages/hosted-execution/src/parsers.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/hosted-execution/src/builders.ts
- packages/operator-config/src/assistant-cli-contracts.ts
- packages/assistant-runtime/src/hosted-runtime/callbacks.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- apps/web/test/hosted-thread-route-store.test.ts
- apps/web/test/hosted-onboarding-linq-webhook.test.ts
- apps/web/test/hosted-onboarding-linq-thread-route.test.ts
- apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts
- apps/web/test/hosted-runtime-linq-delivery-route.test.ts
- packages/assistant-runtime/test/hosted-runtime-group-tool-linq-context.test.ts
- packages/hosted-execution/test/hosted-execution-builders-hosted-email.test.ts
- packages/hosted-execution/test/parsers.test.ts
- Verification: `pnpm --dir apps/web typecheck`, `pnpm --dir packages/hosted-execution typecheck`, focused web Linq/thread-route/delivery tests, `pnpm --dir packages/hosted-execution test`, `pnpm --dir packages/operator-config typecheck`, `pnpm --dir packages/operator-config test`, `pnpm --dir packages/assistant-runtime build`, `pnpm --dir packages/assistant-runtime typecheck`, and focused assistant-runtime group-tool test.
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
