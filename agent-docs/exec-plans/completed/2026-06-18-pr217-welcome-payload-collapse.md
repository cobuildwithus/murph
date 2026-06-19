# PR 217 welcome payload collapse

Goal:
- Resolve PR 217 conflicts with current `main` and address review feedback by collapsing the durable member-activation signup welcome payload to the fields that vary.
- Success means activation welcome payloads persist only `route` and `text`, runtime behavior derives fixed idempotency and dispatch policy from the member activation wake, legacy readers remain compatible with already-emitted payloads, and focused tests/typecheck pass.

Constraints:
- Preserve the PR's existing dual-reader deployment strategy.
- Do not reintroduce generic hosted notification wakes.
- Do not add new persisted state or migration-only branches beyond the temporary legacy reader needed for rolling deploy compatibility.
- Keep route/text behavior unchanged for current signup welcome delivery.

Working set:
- `packages/hosted-execution/src/contracts.ts`
- `packages/hosted-execution/src/parsers.ts`
- `packages/hosted-execution/src/builders.ts`
- `packages/assistant-runtime/src/hosted-runtime/events.ts`
- `apps/web/src/lib/hosted-onboarding/member-activation.ts`
- `apps/cloudflare/test/helpers/hosted-local-linq-support.ts`
- `packages/hosted-local-harness/test/hosted-local.test.ts`
- Matching hosted-execution, assistant-runtime, hosted-web, and hosted-local tests.

Plan:
1. Merge current `main` into the PR worktree and resolve conflicts.
2. Collapse the durable welcome payload shape and derive fixed runtime policies.
3. Update focused tests around parsing, builders, web activation, and runtime event handling.
4. Run scoped verification, required audits, final review, and finish with a scoped commit.

Risks:
- Rolling deploys may still read old payload rows, so parsers/runtime must tolerate legacy constant fields while builders stop emitting them.
- Web must not deploy before the parser/runtime consumer for this payload-shape change; the temporary legacy notification wake preserves old queued rows and consumer-first rollout, but an old consumer cannot decode a newly emitted route/text-only activation item.
- Welcome idempotency must stay per member activation and queue-only.
- Conflict resolution must not disturb unrelated deletions in this PR.
- The merged branch exposed an existing hosted-local workflow assertion drift; keep that test-only fix aligned with the checked-in workflow commands.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
