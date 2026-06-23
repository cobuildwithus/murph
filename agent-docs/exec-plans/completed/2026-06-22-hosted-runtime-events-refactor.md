Goal (incl. success criteria):
- Refactor `packages/assistant-runtime/src/hosted-runtime/events.ts` into smaller, composable modules without changing hosted mailbox behavior.
- Keep the mailbox dispatcher easy to scan, with notification/onboarding delivery and provider trace diagnostics owned by focused helpers.
- Preserve the existing onboarding follow-up prompt wording already edited in the working tree.
- Success means the refactor is behavior-preserving, focused assistant-runtime verification passes, and the final diff avoids speculative abstractions.

Constraints/Assumptions:
- `packages/assistant-runtime` remains the hosted execution owner for mailbox wake handling.
- Web still owns hosted product/control-plane facts; Temporal and Cloudflare ownership boundaries are unchanged.
- No new scheduler, queue, persisted state, runtime owner, or delivery fallback is introduced.
- Current checkout contains unrelated dirty prompt/skill edits; preserve them and scope this work to hosted-runtime code plus plan bookkeeping.

Key decisions:
- Prefer mechanical extraction over rewriting logic.
- Extract cohesive responsibilities only where they already exist: mailbox outcome helpers, assistant notification/onboarding follow-up handling, and provider trace diagnostics.
- Keep external imports from `events.ts` stable unless a direct internal caller can use the new owning module cleanly.

State:
- Implementation and required review passes complete; ready to close.

Done:
- Traced onboarding automation execution and definition locations.
- Identified the largest separable responsibilities in `events.ts`.
- Extracted notification/onboarding follow-up handling, mailbox outcome helpers, and provider trace diagnostics into focused hosted-runtime modules.
- Preserved the existing `executeHostedAssistantNotificationWake` export from `events.ts`.
- Passed `pnpm --dir packages/assistant-runtime typecheck`.
- Passed scoped `bash scripts/workspace-verify.sh test:diff ...` for the touched hosted-runtime files, including assistant-runtime tests and Cloudflare verify.
- Passed root `pnpm typecheck`.
- Security/privacy review found no medium-or-higher findings.
- Coverage/proof pass added focused tests for onboarding follow-up prompt preservation and maintenance-lane provider trace redaction, then reran focused assistant-runtime tests, scoped `test:diff`, and `pnpm typecheck`.
- Deep-review pass found two pre-existing delivery-semantics risks already codified in tests: follow-up seed failure is logged without retry after accepted welcome delivery, and non-signup first-contact failures can be skipped even with required-send policy. Both are intentionally left out of this behavior-preserving refactor because changing them would alter retry/delivery semantics.

Now:
- Close the active plan and preserve unrelated dirty prompt work.

Next:
- Handoff with verification and audit results.

Open questions (UNCONFIRMED if needed):
- Whether `pnpm test:diff` is sufficient for this refactor will be decided after the touched-file set is final.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/events.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/*.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-runtime/test/hosted-runtime-events*.test.ts`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <touched paths>`
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
