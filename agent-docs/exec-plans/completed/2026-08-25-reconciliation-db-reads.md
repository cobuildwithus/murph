# Remove redundant reconciliation database reads

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Remove database reads whose results cannot affect the deployed Temporal reconciliation response while preserving live access and existence authority.

## Success criteria

- Inactive reconciliation avoids the redundant core member existence read while retaining the canonical active-access decision.
- Workflow reconciliation does not read pending Environment interview state that the wire deliberately omits.
- Status/UI consumers continue receiving Environment interview state.
- Maximum query counts are asserted for inactive and active workflow paths.
- Focused proof, exact-head ReviewGPT, and required PR checks resolve.

## Scope

- In scope: runtime reconciliation-facts orchestration and focused Web tests.
- Out of scope: Temporal workflow cadence/coalescing, mailbox semantics, status/UI response shape, and new caching or persistence.

## Constraints

- Technical constraints: remove only reads proved redundant by an existing owner or stripped wire field; preserve missing-member, suspension, access, and workspace authority.
- Product/process constraints: internal performance change with coverage specialist review and sensitive final ReviewGPT because it touches hosted orchestration behavior.

## Risks and mitigations

1. Risk: Removing an existence read changes missing-member versus inactive behavior.
   Mitigation: trace and test the canonical access resolver's exact dispositions before deleting the sibling read.
2. Risk: A non-workflow consumer still needs Environment interview state.
   Mitigation: branch at the existing decision-source boundary and retain status/UI coverage.

## Tasks

1. Add failing call-count and response regressions for inactive workflow, active workflow, and status/UI paths.
2. Delete the redundant reads at their current orchestration owner without copying predicates.
3. Run focused reconciliation-facts and route tests; inspect maximum-cardinality query counts.
4. Commit, push, open the draft PR, launch both ReviewGPT stages in parallel with CI, resolve findings, close this plan, and push the final scoped commit.

## Decisions

- Delete unused work instead of adding a cache, batch owner, or workflow state.

## Verification

- Commands to run: focused hosted-orchestration reconciliation-facts tests, Web typecheck if required, and `git diff --check`.
- Expected outcomes: response semantics are unchanged, call-count assertions fall by one inactive read and two workflow interview queries, and UI/status paths retain their data.
Completed: 2026-08-25
