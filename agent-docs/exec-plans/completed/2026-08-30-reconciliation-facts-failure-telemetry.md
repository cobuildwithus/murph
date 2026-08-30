# Reconciliation facts failure telemetry

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make the next hosted reconciliation-facts 500 failure distinguishable by a
  closed processing stage and bounded error class through the existing Vercel
  failure log, without changing reconciliation behavior.

## Success criteria

- Failure-only telemetry identifies whether canonical facts, visible-access
  enrichment, or notice/recheck work failed, plus a safe low-cardinality error
  classification.
- No messages, payloads, prompts, health values, member/contact identifiers,
  request paths, raw errors, stacks, provider text, credentials, or query text
  enter the log.
- The patch adds no success-path event, database/provider call, retry, write,
  state owner, queue, scheduler, response change, or user-visible behavior.
- Focused tests, privacy/log guards, Web typecheck, exact-head ReviewGPT gates,
  and required CI pass.

## Scope

- In scope: the existing Web-owned reconciliation-facts failure boundary,
  focused tests, and the durable hosted Web observability contract.
- Out of scope: functional reconciliation changes, Temporal behavior, database
  or provider state, device sync, retries, alerts, or production traffic.

## Constraints

- ReviewGPT exclusively authors production implementation and remediation; the
  parent applies only an exact inspected patch.
- Reuse the existing failure log and emit one bounded record only when the
  route already fails.
- Keep stage and error-class values closed and low-cardinality; preserve and
  rethrow the original error unchanged.

## Risks and mitigations

1. Risk: instrumentation changes response or retry behavior.
   Mitigation: assign only closed stage values, log in the existing failure
   path, and rethrow the identical error; prove the response remains unchanged.
2. Risk: error metadata leaks private or high-cardinality values.
   Mitigation: log only closed enums and explicitly allowlisted stable codes,
   with exact negative assertions for raw messages, stacks, IDs, paths, and
   payload values.
3. Risk: adjacent work is mistaken for duplicate ownership.
   Mitigation: exact-diff review found no active PR, issue, plan, or branch
   answering this telemetry question; nearby cold-runner, Codex upgrade, and
   call-circle work is semantically independent.

## Tasks

1. Obtain the smallest ReviewGPT-authored telemetry, test, and documentation
   patch from a privacy-safe implementation packet.
2. Inspect question coverage, privacy, cardinality, runtime overhead, behavior
   preservation, device-lane isolation, and deployment compatibility.
3. Apply the accepted patch exactly and run focused proof.
4. Commit, push, open the telemetry-only PR, and run specialist/final ReviewGPT
   concurrently with CI.
5. Merge and deploy only if every autonomous telemetry gate remains satisfied;
   otherwise leave the PR ready and report the exact external action.

## Decisions

- Seven-day Vercel evidence contains five reconciliation-facts 500 responses,
  including one in the preceding four-hour window and none in the latest four
  hours. Temporal has no terminal non-device workflow failure or queue backlog,
  but the retained Vercel fingerprint does not classify the failing owner step.
- The exact later query will aggregate the new stage and error class for the
  fixed failure message from deployment readiness until the next natural
  occurrence. No synthetic production traffic will be generated.
- Internal-only observability is not member-visible, so no changelog item is
  required.

## Verification

- Run focused reconciliation-facts and visible-route tests.
- Run targeted lint, Web typecheck, logging/privacy guards, and `git diff --check`.
- Run preliminary `completion-specialists` with the coverage lens and final
  sensitive ReviewGPT on the exact pushed head, concurrently with CI.

## Completion evidence

- ReviewGPT-authored implementation patch SHA-256:
  `68da1a193879343c297a96ca410493d84647b35edf719414bacef9b54cba67bc`.
- ReviewGPT-authored privacy-guard remediation SHA-256:
  `fe91889032d739c54564b8ae291e572d1db9e81a5b6f3c7d1889153f7d82081e`.
- Four focused Vitest files passed all 83 tests; Web typecheck,
  `pnpm logs:guard`, targeted ESLint, and `git diff --check` passed.
- Preliminary coverage-specialist ReviewGPT returned
  `SPECIALIST_OUTCOME: PASS` with no findings on
  `153b7c091648f1acd713b09e25c1999eaf196b5b`.
- Final sensitive ReviewGPT returned `ROUND_OUTCOME: PASS` with no findings on
  the same immutable head; all required GitHub checks passed.
- Draft PR: https://github.com/cobuildwithus/murph/pull/2579
Completed: 2026-08-30
