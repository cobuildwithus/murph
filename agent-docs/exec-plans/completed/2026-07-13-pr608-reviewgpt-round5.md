Goal (incl. success criteria):
- Resolve the three accepted High findings from PR #608 ReviewGPT round 5 with the smallest durable ownership shape.
- Success means one newsletter capability allows one prepare and at most one send attempt per notification turn, newsletter delivery is persisted through the existing assistant outbox before provider entry, and a scheduled newsletter occurrence is consumed only after an explicit terminal newsletter outcome.
- Complete focused verification, required completion audits, another zero-accepted-finding ReviewGPT round with valid model evidence, green CI, and merge PR #608.

Constraints/Assumptions:
- Preserve the final web-owned authorization proof check immediately before recipient resolution and provider entry.
- Reuse the existing assistant outbox parent/child group-fanout lifecycle; do not add a table, queue, route, scheduler, or second delivery service.
- Preserve one shared authorized MIME `To` audience while each child intent sends one member envelope.
- Treat ambiguous non-idempotent provider entry as terminal/reconciliation-owned rather than blindly replayable.
- Keep the first-send opt-out-window behavior distinct from newsletter-authorized occurrence retry behavior.
- Preserve unrelated working-tree and coordination-ledger edits.

Key decisions:
- Own the one-shot prepare/send capability in the per-notification-turn hosted tool context so a later cron retry receives a fresh model context and capability instance.
- Persist a deterministic occurrence/group newsletter outbox parent and member-scoped children before any provider call; dispatch may remain immediate.
- Extend the existing hosted email intent payload only with the newsletter fields required to reconstruct the already-supported HTML/proof send.
- Record one privacy-blind newsletter execution result for prepare, send, local preflight, and exception exits; fail closed on missing terminal results only after newsletter authority was granted.

State:
- The one-shot capability, existing-outbox parent/child delivery, explicit cron outcome, and full-audience MIME behavior are implemented. Required audits and local completion verification are resolved; the change is ready for the plan-closing commit.

Done:
- Captured the original exact-head ReviewGPT response after browser-lane restart without sending a duplicate review.
- Confirmed the repeated-prepare laundering path, direct non-durable provider fanout, and missing-result cron no-op path are reachable.
- Identified the existing assistant outbox and group-fanout planner as the durable delivery owner to extend.
- Removed the newsletter tool's direct provider call and replaced it with a proof/HTML-carrying parent intent in the existing outbox.
- Added per-turn one-shot prepare/send closure, durable child-state resolution, sent/ambiguous replay suppression, safe pre-provider retry, and explicit `accepted` status.
- Made authorized cron occurrences retain on accepted, unavailable, or missing newsletter outcomes while preserving the no-authority opt-out window.
- Preserved one envelope recipient per child while building MIME with the full authorized `To` audience.
- Added focused assistant-engine, hosted-execution, assistant-runtime, cron, notification, parser, and Cloudflare email regressions; the first focused runs are green after correcting test expectations and command routing.
- Completed the required security/privacy audit with zero medium-or-higher findings.
- Completed the required coverage-write audit and added the accepted duplicate-address terminal-state regression; its focused suite passes.
- Corrected the broad prompt-contract regressions and proved both unrelated parallel-fanout timeouts pass in isolation.
- Completed the serial diff-aware owner/reverse-dependent lane through setup-cli; its unrelated wizard interaction failure passed immediately on the complete 124-test owner rerun.
- Passed full Cloudflare verification (1,775 tests plus typecheck/Workers lanes), hosted-web typecheck, diff/whitespace checks, and the parent scope/privacy review.

Now:
- Create the scoped plan-closing commit.

Next:
- Reconcile the branch with current `main`, push, and restart the exact-head ReviewGPT/CI loop.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/hosted-execution/src/{runtime-control,side-effects}.ts and parsers/tests as required by the narrow persisted payload extension
- packages/assistant-engine/src/assistant/{outbox,notification-turn,cron/execution}.ts
- packages/assistant-engine/src/assistant-codex/dynamic-tools.ts
- packages/assistant-engine/test/*newsletter* and outbox-focused tests
- packages/assistant-runtime/src/hosted-runtime/{workspace-assistant-phase,callbacks}.ts
- packages/assistant-runtime/test/hosted-runtime-group-tool-linq-context.test.ts and callback/outbox tests
- apps/cloudflare/src/hosted-email/transport.ts and focused hosted-email tests
- agent-docs/product-specs/group-health-newsletter.md and architecture/reliability docs only if the durable contract changes materially
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
