Goal (incl. success criteria):
- Persist and correlate Linq `message.sent` webhooks so SMS first-contact sends have durable provider-sent evidence.
- Preserve the distinction between provider-sent, carrier/handset-delivered, and failed outcomes.
- Success means duplicate-safe signed webhook ingestion records `message.sent`, correlates it to the existing delivery row without claiming delivery, and focused tests prove the state transitions.

Constraints/Assumptions:
- Web remains the owner of provider webhook verification, persisted delivery observability, and line-health effects.
- `message.sent` must not be treated as a handset delivery receipt or trigger delivered-only behavior.
- Preserve existing retry, idempotency, line-health, alerting, and first-contact behavior.
- Do not add a new queue, polling loop, schema column, or provider reconciliation service unless the existing provider-event and delivery state model cannot represent the fact correctly.
- Preserve unrelated worktree and coordination-ledger edits.

Key decisions:
- Extend the existing Linq provider-event pipeline at its current ownership boundary.
- Prefer existing persisted event metadata and delivery correlation over new state.
- Treat provider/dashboard webhook enablement as external rollout context; this repository change handles the event once received.

State:
- Implementation and local completion gates complete; PR gate pending.

Done:
- Production incident audit proved the affected member runtime is healthy and isolated the missing `message.sent` observability path.
- Static tracing confirmed the webhook event is accepted by Linq configuration but ignored by hosted provider-event parsing.
- Added privacy-safe parsing for both supported Linq webhook shapes, durable provider-event persistence, and explicit no-op line-health/alert semantics.
- Added hosted-local subscription parity and focused parser, store-correlation, webhook-route, and registration coverage.
- Focused tests passed: 136 hosted-web tests and 25 hosted-local webhook tunnel tests.
- Diff-aware verification passed after building the isolated worktree's Cloudflare workspace dependency artifacts: hosted-local harness 391 passed / 1 skipped, hosted web 5,225 passed / 140 skipped, Cloudflare 1,833 passed, plus typechecks, lint, and production build.
- Required `coverage-write` audit passed with no edits; existing proof covers both payload versions, privacy, exact message correlation, nonterminal delivery state, no operational side effects, and local subscription parity.
- Parent final review found no unresolved correctness, privacy, or architecture finding.

Now:
- Close the execution plan and create the scoped commit.

Next:
- Rebase onto current `main`, open the PR, and run CI plus the required ReviewGPT gate.

Open questions (UNCONFIRMED if needed):
- None. `message.sent` remains nonterminal evidence in the provider-event ledger; delivery status remains `accepted` until a delivered/failed receipt.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/linq-provider-events.ts
- apps/web/src/lib/hosted-onboarding/linq-provider-event-store.ts
- apps/web/src/lib/hosted-onboarding/linq-line-store.ts
- apps/web/test/hosted-onboarding-linq-observability-store.test.ts
- apps/web/test/hosted-onboarding-linq-provider-events.test.ts
- apps/web/test/hosted-onboarding-webhook-idempotency.test.ts
- packages/hosted-local-harness/src/dev-hosted-local/linq-webhook-tunnel.ts
- packages/hosted-local-harness/test/dev-hosted-local/linq-webhook-tunnel.test.ts
- agent-docs/operations/imessage-deliverability.md
- `pnpm test:diff <touched paths>`
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
