# Prepare held phone plaintext column removal

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Prepare the final held contract PR to drop empty phone-call plaintext columns after the separately deployed encrypted-only reader cut.

## Success criteria

- SQL refuses to drop columns before the predeploy reader-removal guard or while plaintext remains.
- Synthetic PostgreSQL proof preserves encrypted fields and rejects unsafe states.
- The draft PR explicitly holds merge until all older phone functions and deployment-pinned Workflows drain.

## Scope

- In scope: final contract SQL, local SQL proof, deployment owner.
- Out of scope: production execution/deployment, secret access, deletion capability, plaintext readers, backfill removal.

## Constraints

- Existing automatic deployment contract owner executes shipped SQL; an opt-in flag is not an operational hold.
- No private production evidence or identifiers in artifacts.
- The earlier capability and reader-removal PRs must deploy in order first.

## Risks and mitigations

1. Old Prisma readers still select the dropped columns.
   Mitigation: hold merge until exact encrypted-only reader deployment and complete old function/Workflow drain are proved.
2. Retained plaintext could be a sole copy.
   Mitigation: require applied reader-cut guard and recheck plaintext emptiness under an exclusive table lock.

## Tasks

1. Add bounded contract SQL and synthetic proof.
2. Document the automatic executor and merge hold.
3. Verify and open a dependent draft PR.

## Decisions

- Physical column removal is separate from the reader cut because automatic postdeploy contract execution does not prove Workflow drain.
- No production operation is part of this task.

## Verification

- Nine focused PostgreSQL contract cases passed, including an actual prepared encrypted-only Prisma client full-row read and result write after the exact predeploy guard plus DROP.
- Existing production/contract migration owner suite passed: 69 cases, including checksum-tracked apply/replay behavior. Raw contract SQL is intentionally once-only; the owner skips an already applied matching checksum.
- Exact new SQL and test files were mirrored byte-for-byte into the clean, dependency-prepared reader checkout for focused tests and Web prepared typecheck, which passed. Both temporary mirrors were removed afterward; the reader head was unchanged.
- Independent read-only SQL challenge passed eleven synthetic unsafe/empty/replay cases against task-owned loopback PostgreSQL. No production rows or provider calls were involved.
- Filtered root-only frozen install supplied declared repository tooling; no additional Web dependency install was needed.
- Documentation drift, gardening (zero issues), whitespace, and complexity checks passed. No authored production JavaScript/TypeScript functions changed.
- Recorded task-owned CI friction: a repository guard fixture calls live GitHub Markdown rendering and can fail with HTTP 403 despite successful app checks; the proposed deterministic fixture seam is documented without changing production behavior.
- Production merge, deployment, execution, and complete old-function/Workflow drain evidence remain explicit operator gates.
Completed: 2026-09-10
