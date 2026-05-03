Goal (incl. success criteria):
- Fix assistant auto-reply event-first admission regressions so safe `AssistantInputEvent` messages reach Codex even when inbox projection/enrichment is missing or degraded.
- Success means stale/missing inbox projection no longer prevents Codex, email body-unavailable inputs render a degraded prompt instead of pre-Codex skip, hosted Telegram unknown directness is not converted into group-chat false, synthetic capture compatibility remains schema-valid while it exists, and non-fatal enrichment failures are observable.

Constraints/Assumptions:
- Preserve unrelated dirty work in the shared checkout.
- Do not expose local identifiers, secrets, raw message bodies, prompts, or contact details in logs/tests.
- Inbox projection remains best-effort enrichment only.
- Keep the fix narrow to assistant auto-reply admission, prompt preparation, hosted Telegram input semantics if required, and directly coupled tests.

Key decisions:
- Removed the synthetic `InboxShowResult['capture']` bridge from the reply decision path; channel eligibility and self-echo checks now read event-native primary input data.
- Hosted Telegram mailbox conversation input is treated as direct because the hosted Telegram path represents direct bot chats.

State:
- Complete; implementation, verification, and required audits are done.

Done:
- Loaded required repo routing, architecture, product, security, reliability, and verification docs.
- Removed the pre-Codex email body-unavailable skip and late-input defer gate.
- Added degraded email body-unavailable prompt notes and hosted email metadata fallback text.
- Removed the synthetic inbox-capture primary decision bridge from auto-reply evaluation.
- Made `sourceMetadata` part of the required event-native prompt input surface.
- Added non-mocked reply-path coverage for stale projection enrichment and enrichment abort control flow.
- Added/confirmed hosted Telegram directness and degraded email body-unavailable regression coverage.
- Added nonblocking attachment bundle failure diagnostics and prompt projection `not_attempted` wording.
- Removed stale hosted mailbox local-capture dedupe/capture-persist public residue.
- Verification passed:
  - `pnpm --dir packages/assistant-engine test -- assistant-automation-prompt-builder.test.ts assistant-automation-reply-event-path.test.ts assistant-automation-runtime.test.ts assistant-automation-support.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-mailbox-conversation-import.test.ts`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff ...`
- Required audits passed: security/privacy no findings, simplify addressed, coverage-write no changes, task-finish-review no findings.

Now:
- Closing the execution plan and coordination ledger row.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/src/assistant/automation/input-summary.ts`
- `packages/assistant-engine/src/assistant/channels/types.ts`
- `packages/assistant-engine/test/assistant-automation-runtime.test.ts`
- `packages/assistant-engine/test/assistant-automation-reply-event-path.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
