# Remove deprecated Linq active-member cap application surface

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Delete the retired direct-member cap from Web configuration, line-store writes,
operator line sync, and the generated Prisma model. Preserve weighted line
assignment, sticky home routes, and independent proactive conversation quotas.

## Success criteria

- No current application reader or writer depends on the retired cap.
- Existing provider inventory and configured-line synchronization retain their
  privacy, key-rotation, and bounded database behavior.
- Focused tests, Web typecheck, lint, and complexity review pass.
- A draft code-release PR documents the separate physical-column drop gate.

## Scope

- In scope: Web env, line store, sync script, Prisma model, affected fixtures,
  and the existing Linq migration owner documentation.
- Out of scope: weighted planning policy, proactive quotas, new routing logic,
  production mutation, and the physical database-column drop.

## Evidence and architecture

The current assignable/healthy line projections omit the cap. Its only current
application path copies an env value into a legacy column and fills missing
values; the column is explicitly marked rollback compatibility. Existing line
owners remain authoritative. Removing the compatibility write also removes a
second configured-line database update; no new state or abstraction is needed.

## Risks and mitigations

Older generated Prisma clients can implicitly select the retired column during
whole-row upserts. Keep the nullable physical column throughout this code
release. A separate contract PR must require replacement deployment and alias
proof, the configured HTTP drain, old CLI completion/restart exclusion,
applicable deployment-pinned Workflow drain, and a compatible rollback floor.
No private operational evidence belongs in repository artifacts.

## Tasks

1. Done: remove the retired application and Prisma field surfaces.
2. Done: update focused tests and the existing deployment owner documentation.
3. Done: run focused unit and local PostgreSQL proof, Web typecheck, lint, and
   complexity review; inspect privacy and the complete diff.
4. Done: commit and open draft code-release PR #3182 for parent review.
5. Hand off the separate physical-drop draft to its own execution plan; it is
   outside this code-release implementation.

## Decisions

- Use separate code and contract releases because the existing automatic HTTP
  drain does not attest that older operator CLI invocations have completed.
- Internal cleanup only: no member-visible behavior or provider-input change.
- Root session owns Ready admission, final ReviewGPT, and required CI.

## Verification

- Passed: focused env, line-store, planning, home-routing, inventory, sync-script,
  and affected fixture suites: 13 files, 662 unit tests.
- Passed: isolated PostgreSQL inventory (12 tests) and home routing (20 tests)
  against all normal migrations with the nullable physical cap column retained.
- The PostgreSQL inventory proof exposed an existing keyring fixture that paired
  current v1 with future v2. Seed v1 alone, then rotate to v2 plus v1; production
  validation is unchanged. Recorded in Frog and reran the affected suite.
- Passed: `pnpm --dir apps/web typecheck`, scoped ESLint for every changed
  TypeScript file, and `pnpm complexity:diff --base 62609d5a09`.
- Complexity: line-store debt 3 to 0; maximum function complexity 23 to 19.
  No changed-file hotspots remain above 20.
- Expected: identical weighted/sticky/quota behavior with no legacy cap writes.

## Outcome

The application cleanup and focused verification are complete in draft PR
#3182. Required external review and exact-head CI remain PR completion gates
owned by the root session. The physical drop is a separate held cleanup.
Completed: 2026-09-10
