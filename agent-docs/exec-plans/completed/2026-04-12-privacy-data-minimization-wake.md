# Goal (incl. success criteria):
- Land the watched ChatGPT privacy patch only where it still applies on current `HEAD`.
- Success means the touched privacy seams keep behavior intact while storing less durable data, required verification and audit passes run, the same-thread follow-up review is sent, and the next wake hop is armed.

# Constraints/Assumptions:
- Keep the diff scoped to the returned artifact's actual intent.
- Preserve unrelated dirty work across `apps/cloudflare`, `packages/assistant-runtime`, `packages/cloudflare-hosted-control`, `packages/messaging-ingress`, and other active lanes.
- Treat hosted persistence, webhook receipts, and outbox retention as high-sensitivity surfaces and fail closed on incompatible legacy data.

# Key decisions:
- Merge the returned patch as behavioral intent, not overwrite authority, and adapt only the still-applicable hunks.
- Prefer the repo's coverage-bearing `pnpm test:diff` lane if it truthfully covers the touched owners; otherwise fall back to the owner-level required commands.
- Keep Linq side-effect compatibility read-only for legacy stored rows while pruning newly persisted result data to a delivery flag.

# State:
- in_progress

# Done:
- Read the repo routing, verification, completion, and security docs.
- Read the watched thread export and downloaded `murph-privacy-data-minimization.patch`.
- Confirmed the patch scope is limited to assistant usage persistence, token audits, hosted outbox payload retention, and hosted Linq side-effect result storage.
- Landed the still-applicable privacy-minimization changes and updated focused tests for the touched seams.
- Ran `pnpm typecheck` and `pnpm test:diff packages/runtime-state packages/assistant-engine apps/web`; both remain blocked by unrelated pre-existing assistant target-session typing drift in `packages/assistantd/**` and `packages/assistant-cli/**`.
- Ran `pnpm test:smoke` successfully.
- Ran focused proof that passed:
  `pnpm --dir packages/runtime-state exec vitest run test/assistant-usage.test.ts`
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-service-runtime.test.ts`
  `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/prisma-store-token-audits.test.ts apps/web/test/hosted-execution-outbox-payload.test.ts apps/web/test/hosted-execution-outbox.test.ts apps/web/test/hosted-onboarding-webhook-receipt-transitions.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- Sent the requested same-thread attached-file review prompt; the browser reported `commit-timeout`, but the tool observed a matching new user-turn signature with the attached audit package.
- Armed the next detached wake hop at `output-packages/chatgpt-watch/69daf0a8-53c8-8398-a0ce-449ada53251e-2026-04-12T021601Z/`.

# Now:
- Close the active plan and create the scoped commit for the touched privacy slice.

# Next:
- Let the detached wake child continue the same-thread review loop when the next attachment arrives.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED when the queued same-thread review response will arrive; the next wake child is armed to handle it.

# Working set (files/ids/commands):
- Files: the touched runtime-state, assistant-engine, and hosted-web privacy seams plus focused tests and this plan.
- Commands: `git status --short`, `pnpm test:diff packages/runtime-state packages/assistant-engine apps/web`, `pnpm typecheck`, audit-pass commands, `pnpm review:gpt --send ...`, `pnpm exec cobuild-review-gpt thread wake ...`
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
