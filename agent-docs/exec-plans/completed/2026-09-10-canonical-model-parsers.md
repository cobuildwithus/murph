# Use canonical parsers for goal targets and assessment writes

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Use the existing canonical schemas for metric-goal targets and new assessment records. Remove duplicate interpretation while preserving canonical writes and historical reads.

## Product UX

- Outcome: saved goal rules retain their meaning; new assessment links satisfy the existing contract.
- Reaches: goal progress in SQLite/browser projections, assessment imports, and historical intake reads.
- Proof: policy/default/invalid-input cases, canonical import and audit roundtrip, historical assessment reads, and projection refresh tests. Patch effort; result Ready after focused verification.

## Scope and constraints

Contracts remain the shape owner; core remains the canonical writer. Health metrics retains its dependency-free computation interface. No canonical migration, private data, new dependency, or external runtime operation. Query adaptation retains omitted target identity/kind and metric alias handling. New assessment writes validate the entire record; a schema-derived legacy read profile preserves previously accepted string links and ignores unknown historical fields without rewriting evidence.

## Risks and mitigation

- Invalid goal policies must be omitted rather than silently turned into another policy. Preserve schema defaults and valid qualifiers.
- Existing assessment evidence must remain readable. Test the explicit read compatibility profile separately from strict writes.
- Existing projections must converge without a canonical edit. Increment the existing SQLite version and browser replica generation and prove rebuild/freshness behavior.

## Tasks

1. Add focused failing regressions and replace duplicate parsing.
2. Update projection versions and durable owner notes; decide changelog scope.
3. Run focused source tests, relevant typechecks, complexity and privacy review.
4. Commit, open draft PR, mark ready after candidate review, and start required ReviewGPT concurrently with CI.
5. Complete local remediation and archive the implementation plan; finish exact-head CI on PR #3138 before final handoff.

## Verification

- Query: 84 focused tests passed across goal parsing, nutrition goals, metric/browser projection, replica generation, and provider projection compatibility.
- Core: 139 tests passed across assessment writes/legacy reads, storage failures, import/projection provenance, and canonical core behavior.
- Contracts: 2 browser generation tests passed.
- Core, query, and contracts package typechecks passed.
- Complexity guard passed: four changed source files, zero functions above 20; goal parser maximum falls from 20 to 11.
- Changelog: `2026-09-10 / goal-progress-saved-rules`, linked to PR #3138. All 10 changelog archive tests passed.
- Continuation confirmed the worktree and pushed PR head match the implementation handoff. Parent candidate review found no additional required source edits.
- Final ReviewGPT round 1 passed at `3d35cbef75c840a3f24883d74f82c0118f4fa3c5`: zero findings. Vonneumann lane; exact committed-turn signature and response hash match the captured `gpt-6-pro` model. Response wait was at least 425 seconds. The reviewer checked the full snapshot and all 11 changed blobs. No review tooling retries; the owned target closed normally. Local tests and CI, not the source-only review, provide automated execution evidence.
- Web typecheck and all 10 changelog archive tests passed.
- Initial Ready CI passed 29 checks. Platform coverage exposed five stale version assertions: four pinned browser generation 15 and one pinned SQLite version 26. They now enforce the original compatibility floor while the owning contracts test pins the current browser generation. Production source is unchanged after ReviewGPT.
- Remediation verification: 33 query browser compatibility tests, 10 hosted-execution tests, and the focused v24 SQLite rebuild test passed. Query and hosted-execution typechecks passed after their final test edits. The other 102 tests in the broad query file were deliberately excluded from that focused command; broader coverage belongs to CI.
- Parent final review: five test-only corrections retain the existing behavioral assertions and production contracts. No new source, dependencies, persisted state, or generated artifacts. These isolated proof changes and this plan closure are exempt from another substantive ReviewGPT round.
- Final exact-head CI is pending the remediation push and Ready admission. The completion owner remains responsible for observing it on PR #3138. This archived record does not claim a future CI or deployment result.

Completed: 2026-09-10
