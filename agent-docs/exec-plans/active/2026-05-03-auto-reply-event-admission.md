Goal (incl. success criteria):
- Fix assistant auto-reply event-first admission regressions so safe `AssistantInputEvent` messages reach Codex even when inbox projection/enrichment is missing or degraded.
- Success means stale/missing inbox projection no longer prevents Codex, email body-unavailable inputs render a degraded prompt instead of pre-Codex skip, hosted Telegram unknown directness is not converted into group-chat false, synthetic capture compatibility remains schema-valid while it exists, and non-fatal enrichment failures are observable.

Constraints/Assumptions:
- Preserve unrelated dirty work in the shared checkout.
- Do not expose local identifiers, secrets, raw message bodies, prompts, or contact details in logs/tests.
- Inbox projection remains best-effort enrichment only.
- Keep the fix narrow to assistant auto-reply admission, prompt preparation, hosted Telegram input semantics if required, and directly coupled tests.

Key decisions:
- UNCONFIRMED until code inspection: prefer removing the synthetic capture bridge if the change stays contained; otherwise repair it and add tests that fence the bridge bugs.

State:
- Active.

Done:
- Loaded required repo routing, architecture, product, security, reliability, and verification docs.

Now:
- Inspect current auto-reply implementation and tests.

Next:
- Patch event-first policy and add focused integration coverage.

Open questions (UNCONFIRMED if needed):
- Whether removing `primaryCapture: InboxShowResult['capture']` is contained enough for this turn.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/test/assistant-automation-runtime.test.ts`
- Directly coupled assistant-runtime hosted Telegram ingestion tests if required.
