# Simplify hosted runtime group response parsing

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Remove repeated group-summary response validation while preserving the hosted wire contract exactly.

## Success criteria

- Preserve accepted values, normalized results, rejected values and error labels across the changed actions.
- Focused parser tests, package typecheck and complexity guard pass; parent candidate review, exact-head ReviewGPT and required CI pass before completion.

## Scope

- In scope: read_current, create_join_link, update_display_name and post_join_offer response parsing and direct boundary proof.
- Out of scope: request parsing, authorization, effect delivery, schema changes and new parser frameworks.

## Constraints

- Technical constraints: retain action-specific success shapes, keysets, validation order and nullish semantics. No dependencies or new owners.
- Product/process constraints: internal behavior-preserving refactor; no product UX change, provider-input change or changelog entry. Keep isolated draft PR until parent review.

## Risks and mitigations

1. Risk: merging action paths accidentally accepts a sibling status or changes validation order.
   Mitigation: retain explicit success guards and exercise cross-action status/keyset boundaries plus baseline differential proof.

## Tasks

1. Consolidate common result/status and unavailable handling within the current parser.
2. Add protocol boundary tests and run focused tests, typecheck, complexity and differential proof.
3. Review and commit the candidate; open draft PR and obtain parent review before Ready, ReviewGPT and CI.

## Decisions

- Group-unavailable responses intentionally normalize any group value to null; this refactor must not tighten that established contract.

## Verification

- Passed: `pnpm exec vitest run --config packages/hosted-execution/vitest.config.ts --no-coverage` with parsers, hosted-runtime-control, disclosure-contracts, group-context-handoff, group-journal-fact and signup-referral-link-parser test paths: 169 tests across six suites.
- Passed: `pnpm --filter @murphai/hosted-execution typecheck` and `pnpm complexity:diff` (debt 194 and maximum 149 unchanged).
- Passed: 10,284 synthetic baseline/head differential comparisons of values and exact error names/messages. The temporary comparison harness was removed after verification.
- Added 43 permanent boundary cases. An initial broader package run passed 626 cases and exposed four incorrect expected primitive error labels in new tests; corrected expectations and final focused proof passed.
- Outcome: 82 net production lines removed; no parse result or error changes observed. Final ReviewGPT and required CI remain PR gates.
- Frog: inspected existing entries after the ordinary frozen install; no new qualifying repository friction.
Completed: 2026-09-04
