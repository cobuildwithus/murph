# Simplify clinical records import and recovery

Status: active
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

- Composed Web page responses reach the real vault snapshot importer and save two lab results without outgoing pagination metadata.
- Focused tests cover catalog equivalence, received bytes, consent admission, entitlement-independent disconnect, partial bounds, warnings, saved authorization-ended outcomes, revision ordering, SUBSETTED resources, bounded reconnect and permanent outcome conflicts.
- Six PostgreSQL concurrency cases pass against an isolated synthetic database, including both callback/withdrawal orderings and callback/account-deletion orderings.
- Workspace incremental build and affected typechecks passed; rerun after final contract/schema edits.
- Phone (390 px) and desktop (1280 px) real-component studies and signed-out route inspected; Playwright overflow and keyboard proof passed. No live provider journey has been exercised.
- Postdeploy contract SQL applied successfully to the isolated database; the six concurrency tests still pass. Complexity guard passes with no increased per-file debt.
- All affected typechecks and the workspace incremental build pass. Changelog archive proof adds nine passing cases.
- PR #2918 is draft; 461 focused cases, the workspace build, affected typechecks, boundary and complexity guards pass. Screenshots are attached to the PR.
- Preview build exposed one obsolete refresh-token write in authorization expiry handling. Removed it and stale fixture fields; 52 affected tests and the production Next TypeScript check pass. Exact-head CI, a reachable preview and final ReviewGPT remain.

## Progress

- Implemented all five workstreams within existing owners; removed obsolete hosted protocols, duplicate state, policy registries, filesystem facade and UI steps/sidebars.
- Reconnect reuses source identity and encrypted patient binding. Limit to eight retained imports per source and twenty sources; retain immutable evidence rather than adding garbage collection.
- Expansion migration permits old database readers during deploy. Existing guarded post-deploy contract lane drops unused columns only after the new reader is deployed; this sets the rollback floor.
- The rollout aggregate was rechecked before PR creation and remained zero.
- Parent candidate review covers source and test deletions, frozen identities, partial outcomes, privacy, migration ordering and UI states. Live provider validation remains unavailable; synthetic proof is explicitly scoped.
