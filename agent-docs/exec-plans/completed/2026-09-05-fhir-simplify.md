# Simplify clinical records import and recovery

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Deliver find provider → authorize → useful saved results → recover/disconnect.
Remove duplicate policy, retrieval and UI machinery within existing owners.

## Success criteria

- Real Web pagination reaches the snapshot importer without manufactured metadata.
- Consent withdrawal fences acquisition and callback persistence, including failed runtime stop; disconnect survives expired entitlement.
- One authored query catalog and one current hosted slice/completion representation preserve current collection breadth.
- Completed valid slices survive unrelated bounded failures, warnings affect completeness, and saved outcomes remain visible after authorization ends.
- Compact source results link to useful existing destinations; retry/reconnect preserve patient binding, revision integrity and bounded evidence.
- Focused tests, typechecks, rendered journeys, candidate review, required exact-head CI and ReviewGPT pass before landing.

## Ownership and evidence

Web owns consent, portal credentials, frozen plans, provider egress and operational results. Runtime iterates; importer validates/maps; vault/core stage raw evidence and own canonical revisions. Audit source traces establish pagination mismatch, duplicated policy/state, lost partial outcomes and misleading UI. Implementation will reproduce through composed owners. No new service, queue, outbox or review workflow.

## Scope

The authorized September FHIR refactor covers correctness, policy/contract deletion, partial imports, UI subtraction and bounded repeat import. Preserve canonical resource identities, clinical holds, encrypted cursors, patient/base binding, signed runtime fencing, finite budgets and raw evidence referenced by canonical facts. No continuous sync, attachment crawler or general document browser.

## Tasks

1. Repair pagination, consent/disconnect, search normalization and received-byte accounting.
2. Collapse query policy and hosted retrieval representations; remove dead connection fields and test-only filesystem planner.
3. Finalize partial results and authorization-ended counts; preserve revision and completeness safety.
4. Simplify records/connect UI and real-component design proof.
5. Complete bounded retry/reconnect using existing identity, retention and revision owners.
6. Run focused evidence, update durable owners/changelog, review and land through the PR workflow.

## Decisions

- Current read-only aggregate shows no retained hosted clinical connections, runs, requests or unconsumed OAuth sessions. Do not persist private rows. Deployment reader compatibility still needs proof.
- Keep legacy local manifest compatibility only at the external importer boundary where supported; remove legacy ordinary hosted execution.
- UI uses existing design tokens and components, one import action, explicit provider search, concise collection disclosure, saved results and concrete recovery. No stepper or decorative sidebars.
- Repeat import must preserve every referenced immutable raw file and explicitly bound retained evidence. Resolve in the existing vault owner before enabling new generations.

## Verification

- 516 focused cases pass across Web, PostgreSQL, runtime, importers, vault, domain/contracts, Cloudflare and changelog. Direct Web response → vault import proof saves two lab results without manufactured pagination metadata.
- Ten PostgreSQL cases pass against an isolated synthetic database after the contract column drop. These cover callback/withdrawal and callback/account-deletion orderings, plus disconnect/withdrawal before and after authorization-ended finalization, second-generation same-patient import and stale outcome rejection.
- The new unresolved-finalization cases fail on the reviewed head and pass with the two cleanup-query corrections. Already-finalized outcomes remain unchanged.
- Workspace build and affected typechecks pass, including the additional production Next TypeScript check. Boundary, crypto and complexity guards pass. Clinical domain branch coverage is 78%.
- Real-component phone (390 px) and desktop (1280 px) studies and signed-out route inspected; Playwright overflow and keyboard proof passes. Branch preview is deployed and the design study returns HTTP 200. No live provider journey has been exercised.
- CI is green on the prior correction head. Final-head CI remains a merge gate; the latest Web build, typecheck and Web test lanes pass.

## Progress

- All five implementation workstreams are complete within existing owners. Obsolete hosted protocols, duplicate state, policy registries, filesystem facade and UI steps/sidebars are removed.
- Reconnect reuses source identity and encrypted patient binding, bounded to eight retained imports per source and twenty sources. Immutable evidence is retained without adding garbage collection.
- Expansion migration preserves old reader columns during deploy. The existing guarded postdeploy contract lane drops them only after the new Web reader is current and prior functions have drained; this sets the rollback floor.
- The production aggregate was rechecked before PR creation and remained zero. Recheck at actual rollout.
- ReviewGPT round one on c83331087764b8ccbfe154c767f16309f3b17c4a reported one high-severity original-PR finding. Parent accepted: disconnect/withdrawal could strand a timestamped needs_reauth run with no saved outcome. User resumed the required disposition boundary.
- The fix extends cancellation at the two existing cleanup owners to unresolved authorization-ended runs. It adds no state owner, dependency or abstraction. Finalized outcomes and generation/patient fences remain intact.
- CI corrections before the review result fixed obsolete fixture expectations, sharded test package resolution, direct predicate coverage and React selection state. The prior correction head passed all 33 non-skipped checks.
- ReviewGPT round two passed on d43b4ce33ad1162f4c7c52d4a74ac06683848d79 with verified GPT-6 Pro identity and exact response digest. It confirmed the accepted reconnect finding is resolved and reported no additional qualifying bugs or Complexity Collapse.
- Parent final review confirms the requested outcome, ownership, privacy, source deletion and proof. No accepted findings or implementation work remain. This closure changes only the historical plan; exact-head CI and mergeability still gate landing.
Completed: 2026-09-05
