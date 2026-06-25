Goal (incl. success criteria):
- Address PR 284 ReviewGPT findings while preserving the product decision that the agent may approve low-risk calendar event creation.
- Keep calendar writes limited to server-allowlisted create-event slugs and make provider failure/ambiguous outcomes fail closed.
- Land the follow-up OpenWeather connected-app patches with server-held weather auth and restrained weather guidance.

Constraints/Assumptions:
- Do not remove the calendar-create path; the user explicitly accepts agent-approved calendar writes.
- Do not broaden connected-app writes beyond Google Calendar and Outlook create-event slugs.
- Weather tools are read-only, accountless service tools; the OpenWeather key stays web-owned and must not enter runner env or prompts.
- Weather should inform near-term outdoor advice, not reschedule future plans based on unknown conditions.
- Keep implementation local to the existing connected-app primitives unless a durable idempotency primitive is unavoidable.
- Composio/provider payloads remain untrusted content and must not become authorization proof.

Key decisions:
- Rename the schema flag from user-confirmation language to agent approval language.
- Validate direct Composio execute envelopes instead of treating every HTTP 2xx as success.
- Treat ambiguous direct calendar-create failures as non-retryable until a durable write-grant/idempotency primitive exists.
- Execute OpenWeather through direct Composio custom auth so the API key stays server-side; keep ordinary service tools on the Tool Router session.

State:
- Ready to commit and push.

Done:
- PR 284 is open and green in CI.
- ReviewGPT round 1 completed with findings on calendar write approval, direct-execute success detection, and duplicate-prone retry behavior.
- `OPENWEATHER_API_KEY` is configured in Vercel production and preview as a sensitive env var.
- Calendar create execution now requires agent approval, validates direct-execute success envelopes, and treats ambiguous create outcomes as non-retryable.
- OpenWeather direct execution uses server-held custom auth for allowlisted read tools only.
- Focused connected-app tests, hosted-execution tests, assistant-engine tests, typecheck, docs drift, full `pnpm test:diff`, whitespace, privacy, secret, and lazy-cast scans pass.

Now:
- Commit and push the follow-up.

Next:
- Rerun ReviewGPT and PR CI.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether Composio direct execute supports a native idempotency key; assume not unless official docs show one.

Working set (files/ids/commands):
- PR: https://github.com/cobuildwithus/murph/pull/284
- Branch: `codex/connected-apps-service-tools`
- Files expected: `.env.example`, `apps/web/.env.example`, `apps/web/src/lib/connected-apps/{composio,config,service}.ts`, connected-app tests, `packages/hosted-execution/src/connected-apps.ts`, assistant dynamic tool docs/tests, architecture/security docs.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
