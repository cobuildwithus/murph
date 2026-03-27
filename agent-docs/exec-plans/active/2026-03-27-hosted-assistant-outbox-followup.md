# 2026-03-27 Hosted Assistant Outbox Follow-Up

## Goal

Land the smallest safe hosted idempotency follow-up for assistant replies only:

- hosted runs queue assistant replies during the one-shot execution
- the worker still durably commits bundle state before any external assistant send
- after commit, the runner drains pending assistant outbox intents
- previously journaled hosted deliveries are reconciled without re-sending
- local assistant behavior stays unchanged

## Constraints

- Keep this scoped to hosted assistant replies only.
- Do not broaden into a general hosted side-effect framework.
- Preserve the current durable event-commit path for hosted execution.
- Avoid regressing local CLI assistant delivery, outbox, or cron behavior.
- Work carefully on top of the current dirty Cloudflare and assistant-runtime tree.

## Planned Shape

1. Add a queue-only assistant delivery mode for hosted automation so turns can create durable outbox intents without dispatching them immediately.
2. Skip the normal outbox drain during hosted one-shot execution.
3. After the runner records the durable event commit, drain the hosted assistant outbox with Cloudflare-backed reconciliation hooks:
   - consult a hosted delivery journal before sending
   - record successful sent deliveries in the hosted journal
   - mark journaled deliveries sent locally without re-sending
4. Return final post-drain bundles from the runner and let the worker reconcile its live bundle refs to those updated bundles.

## Verification Target

- Focused Cloudflare runner tests for queue-only hosted delivery and post-commit reconciliation.
- Focused assistant/outbox tests if the new queue-only or hook surfaces change shared runtime behavior.
- `pnpm typecheck`
- Targeted Vitest slices for touched Cloudflare and assistant files.

## Risks

- Hosted runner crashes after an external send but before journal persistence still remain a residual edge; this change is intended to eliminate pre-commit duplicate sends and make post-commit reconciliation explicit, not to solve every external transport exactly-once problem.
- Assistant runtime changes overlap active local assistant lanes, so keep the new surfaces narrow and additive.
