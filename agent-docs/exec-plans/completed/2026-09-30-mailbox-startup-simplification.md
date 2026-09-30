# Simplify hosted mailbox startup and database work

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Reduce real foreground mailbox latency by removing unnecessary work at existing Web and database owners. Preserve callback authentication, replay protection, current runtime fencing, access, consent, and usage admission.

## Evidence and architecture

First-operation telemetry separates substantial client preparation and connection acquisition from short physical database round trips. There is also measurable delay before the handler starts. A direct-driver nonce change alone may merely move compiler startup into the subsequent Prisma transaction; measure the complete path before choosing it. ReviewGPT and the explicitly requested Opus 5.5 provide independent read-only design consultation.

No new authoritative state, service, cache, dependency, scheduler, or configuration is planned. Prefer deletion, narrower existing public imports, and reuse of fresh request-local projections. Keep external crypto outside transactions and preserve canonical owner lock ordering. Any SQL reduction must prove equivalent live authority rather than reuse stale admission.

## Scope

- In scope: mailbox fetch, its callback/authentication and database dependencies, startup import graph, redundant SQL or body work, focused regression and performance proof.
- Out of scope: ingress typing changes owned by another PR, unrelated checkout edits, changing provider behavior, database schema or production tuning without evidence.

## Tasks

1. Trace the complete existing path and establish reproducible local baselines.
2. Consult ReviewGPT and Opus 5.5; evaluate proposals against current invariants.
3. Implement only demonstrated reductions, with no substitute state owner.
4. Run focused real-database/route tests, relevant typecheck and lint, and before/after measurements.
5. Review the candidate, commit, and complete the required PR/review workflow under existing authorization.

## Risks and mitigation

- Moving latency rather than reducing it: measure total first-fetch work, not just nonce timing.
- Weakened authority or replay rejection: preserve owner boundaries and run adversarial focused tests.
- Import changes break optional runtime branches: exercise ordinary, empty, usage-denied, and group/crypto branches as applicable.
- Local timing differs from production: report the distinction and use existing production telemetry after any authorized rollout.

## Decisions

- Both ReviewGPT and Opus 5.5 consulted on the existing path. Accepted narrow public imports and separating the existing mailbox parser/projection implementations; retained their old public exports for compatibility.
- Folded optional worker ingress-envelope workspace admission into one bounded SQL read. Reused the existing signed-envelope verifier; no provisioning behavior changes.
- Kept callback body/auth processing unchanged after ReviewGPT identified header-rejection ordering differences in the JSON helper. Its minor allocation saving does not justify expanding authentication scope here.
- Kept Prisma nonce execution, pool settings, and transaction locks unchanged. A direct-driver nonce may only move initialization into the next operation; no proven whole-request saving supports another driver path.
- Narrowed usage settlement to its existing owner rather than its broad barrel. No new runtime state, dependency, or feature flag.
- Internal performance/ownership cleanup; no member-facing behavior or promised production latency threshold changes, so no member changelog fragment.

## Verification

- Local bundled application startup graph: 658,565 to 461,963 bytes, 150 to 82 modules, with external dependencies excluded. Unrelated metric definitions and device-sync modules disappear. This is a diagnostic build, not a deployed latency result.
- Both production-mode Next builds pass. Static startup chunks fall from 1,450,347 bytes / 28 chunks to 976,795 bytes / 20 chunks. Across 20 fresh processes per build, alternating order after two warmups, median module load falls from 122.9 ms to 109.1 ms; CPU falls from 144.2 ms to 130.6 ms. This local Node 24 comparison excludes platform, network and first Prisma operation latency.
- Focused parser/helper/vault-share/observability package tests: 241 passed. Mailbox/logging/consent tests: 82 passed. Route/import/crypto tests and real PostgreSQL callback/nonce tests pass.
- Real PostgreSQL proof requires one envelope query and retains missing-workspace, cross-member, missing-envelope, and malformed-envelope rejection. Existing signed callback tests retain replay and stale-owner rejection.
- Web typecheck and targeted lint passed (one pre-existing unused fixture parameter warning). Complexity guard passed; moved function bodies are exact moves with unchanged complexity debt.
- Production-mode Web build, TypeScript compatibility check, all 387 Health Commons trace checks, and relocated emitted-route checks passed. Snapshot tests: 6 passed; usage allowance/credits tests: 186 passed.
- Synthetic same-pool first-raw-query experiment: direct pg reduced the first operation from 66.3 ms to 10.1 ms but increased the following Prisma transaction from 24.2 ms to 77.8 ms; total changed only from 112.2 ms to 108.9 ms. This is a local initialization probe, not a complete authenticated callback benchmark; it does not justify another production driver path.
- Final ReviewGPT round 1 passed on `82ea4d16998188a3b314a8889f40527246bd8b44`, with zero findings. The managed Mountain lane selected GPT-6 Pro, captured the exact full snapshot and completed after more than ten minutes. Reviewer independently checked source/AST equivalence and authority flow; it did not run the repository test suite. One pre-send packaging retry moved ignored diagnostic bundles out of application source directories; it was not a substantive review round.
- CI exposed an outdated public-export allowlist and an incomplete billing mock. Test-only corrections retain the explicit export allowlist and real capacity constants. Full hosted-execution suite: 805 passed, one existing opt-in skip. Stripe reconciliation: 58 passed. Web typecheck passed after these corrections. No production changes followed the reviewed commit.
- Parent final review found no remaining implementation changes. Exact-head CI, merge and deployed telemetry remain external completion gates on PR #3933; no deployed latency result is claimed here. The temporary baseline checkout was retired through the guarded helper.
Completed: 2026-09-30
