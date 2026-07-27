Goal (incl. success criteria):
- Resolve the accepted preliminary specialist coverage finding for PR #987.
- Add one production-faithful hosted-local scenario proving an eligible Sunday superlatives occurrence crosses the Cloudflare platform factory, signed Web callback, canonical mailbox decision, assistant-runtime handoff, redacted recap evidence, and ordinary group outbox.
- Success means the scenario uses the real owners and contracts rather than replacing the eligibility reader or notification executor with seam mocks, and asserts both delivery and privacy boundaries.
- Correct the production defect exposed by the proof so an explicitly retimed managed group occurrence resolves the same authoritative timezone for both activity eligibility and recap evidence.

Constraints/Assumptions:
- Preserve the shipped threshold, recurring schedule, prompt behavior, schemas, dependencies, queues, and state ownership.
- Keep the production correction narrow: resolve the existing managed-group timezone fallback once and reuse it for the activity decision and recap evidence.
- Reuse the existing scheduled-reminder hosted-local harness and synthetic data helpers.
- Keep all fixtures synthetic and free of direct identifiers or private data.
- Preserve the already completed group-managed-automations plan as an immutable snapshot.

Key decisions:
- Accept preliminary specialist finding 1 as actionable.
- Do not rerun the substantive preliminary pass after remediation.
- Keep frontend review not applicable and preserve the no-finding product-experience result.
- Seed exactly 100 admitted canonical group messages as consumed synthetic history, using negative lane sequences so they cannot be replayed as live inbound work.
- Keep the existing group-newsletter fixture outside the proof window so the Sunday recap is the sole group-automation outbox in the scenario.
- Use the vault/system default timezone when a one-shot retime omits the managed source timezone; this matches the runtime's existing schedule-resolution authority and avoids two clocks for one occurrence.
- Accept the isolated eligible-group proof and the combined suite's clean personal-lane proof as direct evidence; classify the later combined-run MinIO restart during initial group setup as unrelated harness infrastructure because it occurred before the 100-message fixture or eligibility route was reached.

State:
- Complete.

Done:
- Preliminary specialist ReviewGPT pass completed against pushed head `7cfa3b4063`.
- Prompt lens reported no concrete defect.
- Coverage lens identified the missing cross-runtime eligible-path proof.
- Added the production-faithful hosted-local eligible-group scenario to the existing Telegram scheduled-reminder lane.
- Proved the signed Web decision is eligible at exactly 100 canonical messages, the real Cloudflare/assistant-runtime path emits one recap outbox, and the recap prompt contains neither raw message bodies, member identifiers, nor the count.
- Added focused regression coverage for the retimed-occurrence timezone defect and corrected the shared production timezone resolution.
- Rebuilt and ratcheted the Cloudflare runner bundle within measured size limits.
- Passed focused engine, Cloudflare, Web, helper, bundle, and hosted-local scenario tests and typechecks.
- Passed `pnpm test:diff ARCHITECTURE.md agent-docs apps/cloudflare apps/web packages/assistant-engine packages/assistant-runtime packages/hosted-execution`.
- Passed `pnpm verify:acceptance`.
- Completed parent final review and privacy/diff hygiene checks.

Now:
- Commit and push the exact verified head, then update the PR description.

Next:
- Run final ReviewGPT round 1 concurrently with CI, merge after both pass, and retire the task worktree.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/test/hosted-local-telegram-scheduled-reminder-e2e.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.ts`
- `apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.test.ts`
- `apps/web/test/support/hosted-web-testkit.ts`
- `packages/assistant-engine/src/assistant/cron/execution.ts`
- `packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- `apps/cloudflare/scripts/runner-bundle/bundle-entrypoint.ts`
- `apps/cloudflare/test/runner-bundle-entrypoint-bundle.test.ts`
- `pnpm test:diff ...`
- `pnpm verify:acceptance`
Status: completed
Updated: 2026-07-26
Completed: 2026-07-26
