# Workspace read latency and warm target attribution

Status: active
Created: 2026-09-22
Updated: 2026-09-22

## Goal

- Attribute workspace callback latency and remove avoidable preparation work
  only where a cause is proven. Distinguish retained-container reuse from
  new invocation startup.

## Success criteria

- Preserve callback auth, replay protection, fresh usage/model authority, response
  shapes and deadlines. Prove timing isolation, privacy and failure behavior.
- Complete focused tests, typecheck, parent review, final review and exact-head CI.
- Verify deployment and subsequent production evidence before claiming improvement.

## Scope

- In scope: workspace callback phases, query/pool attribution, supported latency corrections.
- Out of scope: new caches, schedulers, persisted state, or changed admission policy.

## Constraints

- Reuse the existing Prisma timing collectors; add no database or network calls.
- Parallel read durations overlap and must not be summed as request latency.
- Logs exclude private incident data, identifiers, request contents and error prose.
- Outcome: make invocation delay attributable while preserving personal/group,
  managed/custom inference, denied usage and invalid-auth journeys.
- Proof: composed route regressions, privacy/failure tests and deployed observation.

## Risks and mitigations

1. Diagnostics could alter error or concurrent-read behavior.
   Mitigation: preserve the original response/failure and scheduling; test both.
2. Local measurements could be mistaken for production proof.
   Mitigation: distinguish measured local costs, observed production boundaries,
   and hypotheses. Web-only optional headers need no Worker protocol rollout.

## Tasks

1. Finish bounded lifecycle and callback diagnosis.
2. Add request-local timing and focused proof; make only supported optimizations.
3. Validate, review, commit and open a draft PR.
4. Run final review concurrently with exact-head CI, then ship via the release owner.

## Decisions

- The workspace callback is awaited even when reusing a retained warm target.
  Its auth then parallel workspace/configuration/usage reads lack phase attribution.
- Existing container readiness logs already distinguish warm and cold starts.
- No private production rows or incident identifiers belong in this plan.

## Verification

- Passed the focused workspace timing and composed internal-route suites:
  126 tests, including parallel reads, custom inference, usage and auth failures.
- Web typecheck, focused ESLint, complexity guard and diff checks passed.
- The synthetic timing proof separates a 300 ms pool acquisition from a 320 ms
  auth query and overlapping 500/200 ms reads without changing the 825 ms total.
- Parent review found no new datastore/network calls, policy changes, persisted
  state or dependency. Headers and logging preserve original errors and responses.
- Production root cause below the callback boundary remains unproven. The current
  candidate is instrumentation, not a claimed latency fix; rollout enables the
  next targeted investigation. Final review and exact-head CI are pending.
