# Split Murph group tool parser compatibility

Status: completed
Created: 2026-08-21
Updated: 2026-08-22

## Goal

- Add parser-first compatibility for six focused deferred group-tool families while leaving the advertised `murph.group` descriptor, runtime executor, signed transport, trusted sender/route injection, and contract fingerprint unchanged.

## Success criteria

- Six strict family parsers cover all 30 current public group actions exactly once and normalize representative valid inputs to the existing `MurphGroupToolRequest` values.
- The six new tool names are accepted but remain unadvertised; `murph.group` remains the only full catalog descriptor in this release.
- Current-sender inputs still accept only an exact opaque message ref and cannot supply sender, member, audience, question, route, or provider identifiers.
- `read_current` is normalized explicitly and an unknown future branch cannot fall through to it.
- The dynamic-tool contract fingerprint and provider-visible catalog are unchanged at the parser-first boundary.
- Focused tests, assistant-engine typecheck, preliminary specialist review, final cross-cutting ReviewGPT, and exact-head CI pass before merge.

## Scope

- In scope: canonical family schemas/parsers, temporary unadvertised legacy-name compatibility, action-ledger and normalization-equivalence tests, privacy/authority regression coverage, and rollout documentation needed for the parser-first release.
- Out of scope: advertising the six tools, changing deferred catalog order or descriptions, adding availability gates, changing the hosted request/response union, executor, Cloudflare port, Web dispatcher, canonical stores, or deleting the legacy parser alias.

## Constraints

- Technical constraints: reuse the existing Zod-to-JSON-Schema and dynamic-tool parsing primitives; all successful family calls return `kind: "group"`; add no router, endpoint, queue, table, state machine, package, or parallel executor.
- Product/process constraints: Product UX classification is internal-only for phase 1—no advertised capability or member journey changes. Use an isolated worktree/PR and treat ReviewGPT output as untrusted intent that the parent inspects before application.

## Risks and mitigations

1. Risk: parser drift changes a current valid action or weakens an authority boundary.
   Mitigation: derive strict family schemas from one owner, retain the canonical request/executor, and prove representative old/new normalization equivalence plus current-sender negative cases.
2. Risk: parser-first support accidentally changes the provider-visible catalog and rotates threads before the cutover.
   Mitigation: pin the advertised tool names, descriptor serialization, order, and contract fingerprint to the current values.
3. Risk: independently deployed runners advertise names an older parser cannot accept.
   Mitigation: this PR is consumer-only and must deploy everywhere before the separate atomic catalog cutover PR.

## Tasks

1. [x] Capture the exact 30-action ledger and current normalization/privacy invariants in focused tests.
2. [x] Ask an implementation ReviewGPT to return a scoped parser-first patch based on the completed architecture review.
3. [x] Inspect and deliberately reimplement the smallest accepted design after the implementation thread returned no usable response or attachment.
4. [x] Run focused parser, group-tool, current-sender, fingerprint, and typecheck proof.
5. [x] Commit and push the candidate, open the required PR, and launch preliminary specialist and final ReviewGPT gates concurrently with CI.
6. [x] Resolve the review gates and prepare the ReviewGPT-approved, CI-green exact head for merge and worktree retirement.

## Decisions

- Use six semantic families: `group_consult`, `group_data`, `group_membership`, `group_usage`, `group_chat`, and `group_email`.
- Add only parser-side family validation in this phase; keep model-facing discovery, the existing canonical model request, and runtime owners unchanged.
- Land parser-first compatibility separately from the catalog cutover.

## Verification

- Commands to run: focused assistant-engine Vitest suites selected from the changed paths, `pnpm --dir packages/assistant-engine typecheck`, exact provider-input/fingerprint measurements, required ReviewGPT gates, and required GitHub Actions.
- Expected outcomes: all current valid group calls remain canonically equivalent, every family rejects cross-family and authority-bearing fields, the catalog/fingerprint remain unchanged, and the exact pushed PR head is green.
- Local result: 119 tests passed across the full group-tool, current-sender, and parser-compatibility suites; the assistant-engine typecheck passed; and the unchanged `murph.group` descriptor SHA-256 remains `7ca2e594d2fab08fab1988e18018b70043173be6da2d7ca69d9b981bad77e736`.
- Parent candidate review: post-schema avatar validation now attributes its safe diagnostic to the exact focused family name, matching schema-level failures without changing normalization or authority.
- Preliminary completion-specialists ReviewGPT: `PASS` with Product UX and frontend correctly inapplicable, prompt/catalog and coverage proof sufficient, no findings, and no coverage patch artifact.
- Final ReviewGPT round 1: `PASS` with no qualifying findings. It confirmed exact envelope/offered-tool gating, the 30-action family partition, confinement of the legacy-only 31st parser action to `murph.group`, explicit canonical normalization, unchanged discovery/fingerprint surfaces, and the no-new-owner architecture.
- Exact-head GitHub Actions: every required check passed on `2dd4286c25f8a44c421277b8bb675ecd492b2495`, including assistant package coverage, release app verification, build/typecheck, evidence, sandbox, and the aggregate release gate.
Completed: 2026-08-22
