# Classify blocked generated-image retention

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and protected invariant

Classify why generated-image capture retirement cannot proceed using the existing bounded warning. Preserve every retention decision, canonical write, integrity check, retry deadline, abort, and failure-isolation rule. This is telemetry only.

## Evidence and current owner

The core retention owner catches six existing finite VaultError codes and reduces all of them to blockedCaptureCount. The hosted idle-maintenance owner emits that count in an existing warning. Synthetic damaged bytes and missing event/manifest evidence can reach different branches yet produce indistinguishable observations. Existing telemetry does not retain the distinguishing code. No private evidence belongs in this plan or its review packet.

## Scope and design

- Extend the core operation's ephemeral result with bounded counts for the existing recognized reasons, and project them into the existing hosted warning.
- Derive classification from the existing allowlisted code owner. No raw errors, content, identifiers, filenames, paths, prompts, or arbitrary codes.
- Keep the same event frequency and correlation pipeline. No new logger, provider call, database query, state, schema migration, scheduler, or retention policy.
- ReviewGPT implements the substantive patch and tests. Parent checks simplicity, semantics, privacy, and cost.

## Ownership and compatibility

Fresh sanctioned worktree from b3440779650. Open PR diffs and recent retention changes inspected; no exact collision found. Core and runtime ship in the same runner bundle; the additional diagnostic fields are optional observations. Old bundles retain their old warning until normal rollout. No Web consumer or persisted format depends on the fields.

## Tasks

1. Obtain ReviewGPT patch using guarded public source context.
2. Prove distinct synthetic failure reasons remain fail-closed while a valid neighboring capture retires; abort and unrelated errors preserve existing behavior.
3. Run focused core/runtime tests, relevant typechecks, complexity/privacy/docs guards, and parent review.
4. Commit and open a draft PR, mark Ready when locally verified, obtain final ReviewGPT plus exact-head CI.
5. If telemetry-only gates and canonical deployment approval permit, merge/deploy and verify exact revision through read-only evidence. Otherwise record the precise outstanding gate and preserve the query.

## Verification

ReviewGPT authored the two production files, two focused test files, and Reliability contract. Parent applied the captured patch unchanged, then added the required index entry. The source change adds six ephemeral counters and selects six numeric fields on the existing warning; it adds no branch, awaited work, or persisted state.

- Fail-before proof: the mixed missing-event/changed-bytes test and both nonzero hosted-warning cases fail original production source only because the new counts are absent. The no-warning case already passes.
- Pass-after proof: all 16 core retention cases and all 42 hosted idle-maintenance cases pass, including valid-neighbor progress, six recognized reasons, per-pass reset, unknown-error propagation, abort precedence, bounded warning shape, and privacy exclusion.
- Both affected package typechecks and the core emitted build pass. Log privacy guard passes. Complexity is unchanged: core retention loop 23, hosted maintenance 44; the added counting and log projection introduce no branches, so broader refactoring is not justified here.
- Final ReviewGPT round 1 PASS at `4ffe0b8ac46e2cab7a338059c019c5f779e292a1`; captured model verification confirms the requested model. Zero findings; parent final review complete. Source and tests remain unchanged by plan closure.
- PR #3133 owns final-head CI and merge evidence. Implementation and review are complete; the automation memory tracks the separately authorized telemetry-only deployment, exact revision verification, and bounded natural-traffic query. No production replay or data mutation is part of this work.

## Deferred sweep work

Device-sync failures belong to the separate lane. Historical provider receipts, partial scheduled runs, and observability access/retention gaps remain separate investigations; this one-change run selects only retention diagnostics.
Completed: 2026-09-10
