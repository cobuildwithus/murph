# Require fresh live canary business outcomes

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Live canaries must exercise actual provider journeys and verify persisted business outcomes; successful workflow bookkeeping must not substitute for execution.

## Success criteria

- Native canaries execute on their six-hour schedule even with unchanged source.
- Linq verifies the actual protected-main deployment and one correlated canonical action exactly once.
- Stripe advances a real sandbox test clock and proves renewed downgraded entitlement through production readers.
- Garmin compares actual provider data with canonical query results after normal hosted orchestration, then disconnects.
- Focused tests, typechecks, complexity review and exact-head PR verification report missing live evidence truthfully.

## Scope

- In scope: existing native, Linq, Stripe and Garmin canary owners; fixed-target Linq readback; immutable private Garmin dispatch; focused tests and owner docs.
- Out of scope: local production sends, credential acquisition/copying, production reset semantic changes, general runtime state or retry machinery.

## Constraints

- Technical constraints: reuse canonical product state/readers, fixed canary identity, protected environments, bounded polling, content-free output, and cleanup ownership.
- Product/process constraints: candidate PR code never receives private repository or production authority. Missing private sandbox configuration fails closed. Live calls run only through protected hosted lanes.

## Risks and mitigations

1. Stale bookkeeping hides missing provider proof. Remove same-revision native suppression, bind Linq to deployed revision, require completed business outcomes.
2. Stripe time differs from app wall time. Read the production gate at the actual vendor frozen time without a global app clock override.
3. Garmin connection precedes data arrival. Keep browser connected while callback-owned orchestration produces canonical rows; bounded absence fails.
4. Cross-repository migration overlaps a provider account. Wait for previous public provider-bearing runs to terminate before the private executor starts; never force-cancel provider work.

## Tasks

1. Implement native recurrence and Linq deployed-revision selection.
2. Add narrowly authorized correlated canonical Linq action readback.
3. Integrate delegated Stripe lifecycle and Garmin data outcomes.
4. Bind private Garmin dispatch to immutable run identity and content-free completion receipt.
5. Verify, review privacy/failure paths, update owner docs, commit and open draft PR.

## Decisions

- Existing persisted product state remains canonical; receipts contain only finite outcomes, timing and immutable revision/correlation metadata.
- Stripe and Garmin specialists edit disjoint owner modules in this worktree; this session owns integration and the PR.

## Verification

- Controller/native/Linq/PR policy Node suite: 63 tests passed; private-dispatch identity, stale/skipped receipt, timeout, ambiguous-response, and no-cancellation failure paths are exercised.
- Linq fixed observer/route/runner: 49 focused tests passed, including real encrypted Browser Vault decoding, pending-conversation/checkpoint/reset races, zero-to-one total/title/unique-id cardinality, auth, and no-store responses.
- Stripe: 24 live-support tests and 27 CI-guard tests passed; `pnpm hosted-billing:ci-guard` passed. Real-clock provider execution remains protected CI evidence.
- Garmin: 53 browser tests, 31 environment partition tests, seven configuration tests, two production importer/query oracle tests, and six workflow contract tests passed. Seven opt-in full-stack cases were intentionally not executed locally.
- Web prepared, Cloudflare, harness, and tools typechecks passed. Scoped Web ESLint, `pnpm complexity:diff`, docs drift/gardening, and diff/privacy checks passed.
- Parent candidate review found no blocker. Existing complexity hotspots remain unchanged; new proof owners stay at or below the threshold.
- Draft PR, exact-head CI, and final ReviewGPT are handed to the parent completion owner. No production deployment, environment provisioning, or live-provider acceptance is claimed by local verification.
- Protected live provider proof is not run locally; unavailable credentials are never represented as passing evidence.
Completed: 2026-09-10
