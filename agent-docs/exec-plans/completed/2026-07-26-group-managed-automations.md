Goal (incl. success criteria):
- Extend hosted managed automations into an explicit group lane without allowing personal managed automations to execute in group runtimes.
- Ship a recurring Sunday superlatives automation for authenticated group chats only when the exact group has at least 100 eligible inbound human messages in the preceding seven local calendar days.
- Specify, but do not activate, a future weekly one-person call-out until every supported group provider has authoritative current-participant and safe-display-label selection.
- Success means owner scope is revalidated at reconciliation and fire time, the activity threshold is evaluated privately before model/provider/outbox work, ineligible or unavailable checks fail closed, and the group social output follows the durable group-chat safety contract.

Constraints/Assumptions:
- Web owns committed mailbox truth and the closed activity-eligibility decision. The model must not receive raw message counts, mailbox contents, participant handles, or identifiers from this gate.
- The synthetic group runtime remains the group automation owner; ordinary scheduled delivery and retry/outbox behavior remain unchanged.
- Count canonical committed inbound group message envelopes, excluding Murph-authored and reaction-only events, in `[same local wall clock seven calendar dates earlier, occurrenceAt)`.
- Use the occurrence's immutable route, occurrence time, and vault timezone. Do not derive eligibility from transcript residue, room-model evidence, or runtime input retention.
- Do not add a scheduler, queue, dependency, migration, or new persisted state owner unless concrete implementation evidence proves it necessary.
- Avoid the active experiment-lifecycle working set; preserve its current owner and behavior.
- Preserve unrelated worktree and coordination-ledger edits.

Key decisions:
- Keep `member` and `authenticated-group` as the managed owner scopes. Built-in managed seeds missing a scope remain personal by default; caller-supplied custom seeds retain their existing compatibility behavior.
- Archive nonterminal built-in records whose current route no longer matches their managed owner, including paused records, and revalidate exact managed identity plus owner scope before executing a due occurrence.
- Implement Sunday superlatives as a hosted-only, authenticated-group managed seed using the existing weekly schedule/spread and ordinary notification delivery.
- The activity gate is a closed, model-inaccessible control action. Web returns only eligible, ineligible, or unavailable; unavailable skips delivery.
- Superlatives celebrate a few moments, recurring bits, or room dynamics without winners/losers, sensitive-trait judgments, health disclosures, popularity ranking, shaming, or raw participant identifiers.
- Defer the random weekly call-out seed and ID. It needs provider-current active-human membership, a safe current display label, low-pressure wording, and repeat avoidance; unsupported authority must skip rather than guess.
- Deploy the activity-decision consumer before the producer/seed so mixed Web and Cloudflare versions fail closed.

State:
- In progress.

Done:
- Traced current managed seed reconciliation, scheduled execution, hosted group routing, mailbox admission, transcript/evidence, and participant authority.
- Confirmed prior group managed-automation support landed, including explicit owner scopes and a group-owned room-model maintenance seed.
- Completed and audited the first ReviewGPT planning pass.
- Accepted the Web-owned canonical mailbox activity gate, owner-scope hardening, and deferred participant-selection boundary.

Now:
- Ask ReviewGPT to implement the accepted staged patch against the isolated task worktree.

Next:
- Inspect and apply the returned patch.
- Run focused verification and product-experience review.
- Push an exact-head PR, run the preliminary completion-specialists pass, resolve findings, then run final ReviewGPT concurrently with CI.

Open questions (UNCONFIRMED if needed):
- None. A live first Sunday occurrence still depends on merge/deploy timing; implementation must not fake or backdate it.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/managed-automations.ts`
- `packages/assistant-engine/src/assistant/automation/execute.ts`
- `packages/assistant-engine/src/assistant/automation/**`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/hosted-execution/src/**`
- `apps/cloudflare/src/**hosted**`
- `apps/web/app/api/internal/**`
- `apps/web/src/lib/hosted-mailbox/**`
- focused tests in matching package/app test directories
- `packages/assistant-engine/skills/group-chat/SKILL.md`
- `agent-docs/product-specs/group-managed-automations.md`
- relevant architecture, security, reliability, testing, and product-spec indexes
- ReviewGPT thread `6a65bd64-daf0-83ea-8535-7bc85cf15b10`
- `pnpm test:diff ...`
- `pnpm verify:acceptance`
Status: completed
Updated: 2026-07-26
Completed: 2026-07-26
