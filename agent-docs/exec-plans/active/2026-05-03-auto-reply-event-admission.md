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
- Active.

Done:
- Loaded required repo routing, architecture, product, security, reliability, and verification docs.
- Removed the pre-Codex email body-unavailable skip and late-input defer gate.
- Added degraded email body-unavailable prompt notes and hosted email metadata fallback text.

Now:
- Add focused integration/regression tests.

Next:
- Patch event-first policy and add focused integration coverage.

Open questions (UNCONFIRMED if needed):
- Whether removing `primaryCapture: InboxShowResult['capture']` is contained enough for this turn.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/src/assistant/automation/input-summary.ts`
- `packages/assistant-engine/src/assistant/channels/types.ts`
- `packages/assistant-engine/test/assistant-automation-runtime.test.ts`
- `packages/assistant-engine/test/assistant-automation-reply-event-path.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
