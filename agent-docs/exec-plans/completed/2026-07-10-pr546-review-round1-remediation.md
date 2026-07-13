# PR 546 ReviewGPT round 1 remediation

Status: completed
Created: 2026-07-10
Updated: 2026-07-12

## Goal

- Make the one-time Pulse Trial campaign merge-safe: Apply acts only on the
  exact local and Stripe state successfully previewed, all-member work can
  progress through bounded batches, and the temporary surface has an explicit
  retirement contract.

## Success criteria

- Preview returns opaque proof of the exact bounded local candidate page and
  each successfully classified Stripe target.
- Apply requires that proof, rejects local page changes before provider work,
  and refuses to mutate any target whose locked provider state differs from
  Preview.
- Incomplete previews cannot expose or authorize Apply.
- All-member work advances through deterministic, at-most-four-candidate pages
  and can reach a complete zero-work verification above four total candidates.
- The client applies only proof owned by its current preview page.
- Responses and logs remain aggregate-only and never expose candidate IDs.
- The fixed campaign keeps a concrete post-apply removal owner and condition.
- Focused regressions, routed audits, pushed-head ReviewGPT, and PR checks pass.

## Scope

- In scope: the existing Pulse Trial extension service, bounded pagination,
  ops route/client, focused tests, PR contract, and concise operator
  documentation.
- Out of scope: persisted preview state, a queue, recurring campaigns, a new
  secret, or a general billing confirmation framework.

## Constraints

- Keep the fixed campaign and existing Stripe idempotency/lock/reconciliation
  boundaries unchanged.
- Use the digest only as stale-snapshot evidence, not as authorization; hosted
  session, ops allowlisting, and same-origin checks remain the authority.
- Do not reveal candidate IDs or digest inputs in responses, logs, errors, or
  documentation.

## Risks and mitigations

1. Risk: eligibility changes between Preview and Apply widen the confirmed run.
   Mitigation: compare the exact bounded local page before provider work and
   compare each target's locked provider proof before mutating that target.
2. Risk: adding server-side preview lifecycle state broadens the one-time tool.
   Mitigation: use a deterministic opaque digest and add no persisted state.
3. Risk: a candidate changes after digest validation but before its lock.
   Mitigation: preserve the existing locked local re-read and fail-closed
   eligibility classification for every candidate.
4. Risk: a hard four-candidate abort prevents a larger campaign from finishing.
   Mitigation: use the existing ordered candidate source to select numbered,
   bounded pages without exposing member identifiers.
5. Risk: the deployed one-time tool remains armed after the campaign.
   Mitigation: restore the original explicit owner/removal condition after a
   complete paginated zero-work verification.

## Tasks

1. Add deterministic local-page and per-target provider proof with fail-closed
   Apply behavior.
2. Replace the hard candidate-limit abort with bounded numbered pages.
3. Bind proof and page state to the client preview; block incomplete previews.
4. Restore the fixed campaign retirement contract.
5. Add service, route, and client regressions plus operator documentation.
6. Run focused verification, required re-audits, and parent final review.
7. Close the plan with a scoped commit, push, and rerun ReviewGPT plus CI.

## Decisions

- Accept the ReviewGPT candidate after independent code-path validation: the
  current all-member Apply reruns discovery with only the fixed campaign key.
- Treat responses that report `MODEL_CONFIRMATION: UNKNOWN` as advisory only;
  they do not satisfy the formal ReviewGPT gate.
- Prefer a one-way deterministic digest over a database row or new signing key;
  the digest detects change and carries no independent mutation authority.

## Verification

- Focused Pulse Trial service, route, and client Vitest suites: 53 passed.
- Hosted-web prepared typecheck: passed.
- Focused ESLint and `git diff --check`: passed.
- `pnpm test:diff apps/web`: passed, including dependency/boundary/security
  guards, dev smoke, production build, lint with warnings only, and 4,290
  tests passed with 9 skipped.
- Required coverage-write audit added three focused regressions; the final
  security/privacy audit found no medium-or-higher issue.
- The frontend audit's three medium findings were accepted, fixed, covered,
  and cleared on re-audit; authenticated rendered inspection remained
  unavailable, so the audit used source and component-test proof.
- Pushed-head ReviewGPT rerun and final PR CI remain post-commit merge gates.
Completed: 2026-07-12
