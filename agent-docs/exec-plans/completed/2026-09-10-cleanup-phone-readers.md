# Remove phone plaintext readers behind a predeploy guard

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Retire phone-call plaintext readers and the one-time cleanup/backfill capability after authorized legacy deletion, while retaining physical columns until the final held contract PR.

## Success criteria

- Predeploy rejects any retained private JSON or missing/empty brief ciphertext without modifying content.
- Generated Prisma model and current readers/writers use encrypted fields exclusively.
- Current replay, consultation, result CAS, reconciliation, history, and shared local E2E seed paths remain valid.
- Focused tests, migration proof, typechecks, complexity and owner documentation support a held dependent draft.

## Scope

- In scope: predeploy guard, plaintext model/read/write removal, obsolete scripts/service/route removal, current encrypted test fixtures, owner docs.
- Out of scope: production operation, deployments, secrets, physical column DROP, billing changes.

## Constraints

- Depends on the deletion capability PR and completed hosted deletion proof.
- Preserve ciphertext first-writer fences, encrypted field AAD, active provider authority, and notification lock order.
- Physical column DROP belongs to a separate held PR after encrypted-only reader function and Workflow drain.

## Risks and mitigations

1. Old private content or missing ciphertext could be stranded.
   Mitigation: validate both whole-table plaintext emptiness and required brief ciphertext before deploying readers.
2. Fixtures could hide current-runtime regressions.
   Mitigation: convert canonical fixture content to encrypted fields while retaining replay, conflict, failure, and ordering assertions.

## Tasks

1. Add predeploy constraints and remove obsolete plaintext code.
2. Adapt encrypted fixtures and shared Retell testkit.
3. Verify changed behavior and update current owner.
4. Open a held dependent draft; do not execute hosted cleanup or deploy.

## Decisions

- Every supported writer already encrypts briefs before reservation; the predeploy guard can enforce that invariant and make the Prisma field required.
- The contract executor runs automatically on deployment, so this stage retains physical columns and the final DROP PR stays held separately.

## Verification

- All 18 focused phone suites passed: 321 cases, including eight executable PostgreSQL predeploy guard cases against synthetic temporary tables in a task-owned loopback database.
- Production migration owner/guard suite passed: 69 cases.
- Web prepared typecheck and Cloudflare typecheck passed after declared package build prerequisites.
- Complexity diff passed against the deletion capability head. Existing result lifecycle hotspots are unchanged; ciphertext-only result presence checks remove branches.
- Shared Retell local E2E fixture now encrypts briefs through the production helper. Its full local worker/provider journey was not rerun; encrypted lifecycle behavior is covered by the focused phone suites and the shared fixture is included in both typechecks.
- Documentation drift, documentation gardening (zero issues), and whitespace checks passed.
- Independent read-only completion challenge found no actionable issue in the guard, supported writer skew, nullable result semantics, canonical result CAS, or notification lock/existence checks.
- No production access, deployment, deletion operation, real provider request, or secret retrieval was performed.
Completed: 2026-09-10
