# Complexity collapse roadmap and device runtime-config adoption

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Record the ordered complexity-collapse program and complete its first high-confidence lane by making device runtime configuration reuse the canonical provider configuration owners.

## Success criteria

- Runtime configuration reads, serializes, and parses provider settings through the existing canonical helpers.
- Junction explicit resource selections retain the canonical required defaults.
- Unknown fields, provider admin secrets, incomplete credentials, array aliasing, and missing runtime gates remain fail-closed.
- The package loses the duplicate provider registry and parser implementation without a replacement abstraction.
- The six-wave roadmap remains preserved in this completed plan snapshot.

## Program roadmap

1. **Wave 1 — high-confidence consolidation.** Land four isolated PRs: device runtime-config adoption; redundant Vitest alias deletion; one lookup-ID family owner; and proven micro-deletions.
2. **Wave 2 — privacy-policy ownership.** Consolidate exact duplicate diagnostic safe-text redaction under the hosted observability owner, remove the dead Cloudflare object walker, centralize structural persisted-JSON allowlisting separately, and add only the demonstrated signed-callback JSON helper. Keep structural redaction and diagnostic text redaction as distinct contracts.
3. **Wave 3 — runner write-fence hard cut.** Remove unread runner-state projections, legacy-named test adapters, inert wake/backoff state, stale liveness remnants, and obsolete documentation while preserving dormant-object migration of active invocation identity and the public status contract.
4. **Wave 4 — measurement-gated compatibility retirement.** Query production-shaped state and close explicit rollback windows before deleting legacy snapshot restore/GC paths, historical runtime-control kinds, Linq authority fallbacks, vault-share capability fallbacks, and foreground-pending compatibility.
5. **Wave 5 — ownership boundaries.** Delete unused automation-pass ports and the private hosted-local programmatic harness after active lanes settle; move device control implementation from operator-config to CLI; move the typed assistant daemon HTTP client to assistantd. Do not introduce generic RPC or lifecycle frameworks.
6. **Wave 6 — build, docs, and process compression.** Collapse non-web Vitest aliases first, then matrix the repeated Cloudflare deploy gates, retire package-boundary tombstones, compress the always-read architecture/index corpus, and delete stale seam-review documents after overlapping PRs resolve.

Each later wave is a recommendation, not authorization to implement it in this PR. Re-check current main, production evidence, active ledger rows, and open PR overlap before opening any later lane.

## Scope

- In scope: `packages/device-syncd/src/config/runtime-config.ts`, canonical provider configuration helpers, focused tests, this plan, and the coordination ledger.
- Out of scope: provider behavior changes, device control-plane work, new registries, later roadmap waves, and unrelated open-PR fixes.

## Constraints

- Keep public runtime-config shape and missing-config behavior stable.
- Reuse the current provider-config and serializable-config owners; do not add an intermediary abstraction.
- Preserve fail-closed secret and field validation.
- Keep this PR independently reviewable and deployable.

## Risks and mitigations

1. Risk: canonical Junction default merging changes hosted/local parity.
   Mitigation: add focused parity coverage and treat the canonical provider reader as the intended source of truth.
2. Risk: serialization accidentally admits secret/admin fields or aliases mutable arrays.
   Mitigation: exercise the existing canonical parser and clone helpers directly in runtime-config tests.
3. Risk: a broad cleanup collides with open device PRs.
   Mitigation: limit the diff to runtime configuration and its focused tests.

## Tasks

1. Re-check current-main and open-PR overlap.
2. Replace duplicate provider readers/registry/parsers with canonical helpers.
3. Add or update focused parity and fail-closed tests.
4. Run owner-scoped verification and the required coverage-write audit.
5. Complete final review, archive this plan, commit, publish a draft PR, and run the PR review gates.

## Decisions

- Preserve the multi-wave program in this completed execution-plan snapshot rather than create a permanent speculative architecture roadmap.
- Keep later compatibility deletion explicitly evidence-gated.

## Verification

- `pnpm test:diff packages/device-syncd`
- Focused device-syncd runtime-config tests selected by the diff lane.
- Required write-capable `coverage-write` audit.
- ReviewGPT and PR CI on the exact pushed head.
Completed: 2026-07-15
