# Fix hosted run adopted-wake commit and drain retry reliability

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Fix the reported hosted run reliability gaps so newly adopted runtime wake events are not committed as processed without explicit proof, hosted wake draining stays bounded and retryable, transient side-input hydration failures backpressure instead of quarantining, and dead private helpers are removed.

## Success criteria

- Runtime commit merging never synthesizes successful results for projection-only adopted events.
- Drain-loop cap exhaustion exits through the retry/backpressure path.
- Side-input hydration distinguishes deterministic unavailable side inputs from transient/config/network/parse failures.
- Candidate cursor cleanup and unused helper simplifications are behavior-preserving.
- Focused Cloudflare tests cover the high-risk paths, and the required repo verification/audit flow is completed or any unrelated blocker is documented.

## Scope

- In scope:
  - `apps/cloudflare/src/user-runner.ts`
  - `apps/cloudflare/src/user-runner/runner-run-processor.ts`
  - Focused `apps/cloudflare/test/**` coverage for the changed hosted-run behavior
- Out of scope:
  - Hosted web run ownership schema changes
  - Linq delivery semantics outside directly coupled cleanup metadata
  - Runner supervisor/container boundary hardening already covered by an adjacent active plan

## Constraints

- Technical constraints:
  - Preserve web-owned HostedRun/cursor authority.
  - Do not invent processed-event proof when the runtime result did not provide it.
  - Do not add dependencies or weaken existing hosted execution invariants.
- Product/process constraints:
  - Preserve unrelated dirty-tree edits and coordinate with adjacent active Cloudflare ledger rows.
  - Keep the plan and coordination ledger in sync.

## Risks and mitigations

1. Risk: Commit cursor changes could strand legitimately processed adopted events.
   Mitigation: Advance only through explicit event results and leave unproven events for acquire/retry.
2. Risk: Side-input classification could quarantine transient web failures.
   Mitigation: Use typed side-input errors and add non-OK/config regression coverage.

## Tasks

1. Inspect current run acquisition, adoption, commit, finalize, and side-input reader paths.
2. Implement commit merge and drain cap/backpressure fixes.
3. Type side-input hydration failures and update quarantine/backpressure behavior.
4. Remove dead helper branches and unused private helpers.
5. Add focused regression tests.
6. Run scoped verification, required audit passes, and final checks.

## Decisions

- Use explicit runtime event results as the only commit proof for adopted wake completion.
- Treat drain cap exhaustion as backpressure so the existing retry alarm machinery applies.
- Quarantine side-input hydration only for typed deterministic missing side inputs; transient/config/non-OK/parse errors rethrow into the existing retry path.

## Verification

- Commands to run:
  - Focused Vitest for the touched hosted-runner tests.
  - `pnpm --dir apps/cloudflare verify` or truthful diff-aware equivalent.
  - Required completion workflow audit passes.
- Expected outcomes:
  - All task-relevant checks pass, or unrelated pre-existing failures are named with evidence.

## Progress

- 2026-04-24: Implemented explicit-result-only adopted event commit merging, bounded drain cap exhaustion retry, typed deterministic side-input missing errors, transient side-input backpressure, and dead helper cleanup.
- 2026-04-24: Required `coverage-write` pass added sibling vault-sync missing-side-input coverage and concluded focused coverage is sufficient.
- 2026-04-24: Required `simplify` pass found no behavior-preserving simplification worth making.
- 2026-04-24: Required `task-finish-review` pass found no issues.
- 2026-04-24: Focused Vitest passed for `apps/cloudflare/test/user-runner-resume-finalize.test.ts` and `apps/cloudflare/test/runner-run-processor.test.ts` (`72` tests).
- 2026-04-24: `pnpm --dir apps/cloudflare verify` is blocked by unrelated active dirty-tree errors in `apps/cloudflare/src/runner-container.ts` and `packages/assistant-engine/src/assistant/providers/openai-compatible.ts`.
Completed: 2026-04-24
