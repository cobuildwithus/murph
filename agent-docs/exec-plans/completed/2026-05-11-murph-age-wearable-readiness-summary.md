# Murph Age wearable readiness summary

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Expose a public-safe Murph Age wearable bridge readiness summary so callers can see which wearable data families are present, which remain quality-limited, and that none are score-bearing yet.

## Success criteria

- Display summaries distinguish lab score-bearing features from wearable bridge candidates.
- Public summaries include only aggregate-safe readiness metadata, not point ids, row values, predictions, or coefficients.
- Existing Murph Age lab scoring behavior is unchanged.
- Focused package tests, typecheck, smoke, and required audits pass or have a named unrelated blocker.

## Scope

- In scope: `packages/health-metrics` Murph Age summary contracts and focused tests; `packages/query` public summary expectations if needed.
- Out of scope: making wearables score-bearing, adding user-facing claims, changing model coefficients, downloading/scoring new cohort data, or changing the frozen lab anchor.

## Constraints

- Technical constraints: keep the summary deterministic and derived from existing context-only feature statuses.
- Product/process constraints: preserve Murph Age research-only/product authorization boundaries and privacy guardrails.

## Risks and mitigations

1. Risk: wearable data looks like it affects the score.
   Mitigation: every bridge readiness object carries explicit non-score-bearing and not-estimated fields.
2. Risk: public summary leaks local point ids or participant-level detail.
   Mitigation: keep readiness to metric keys/families/statuses and add tests around public output.

## Tasks

1. Done: add bridge readiness types and summary derivation.
2. Done: thread the readiness summary through full and public display summaries.
3. Done: extend focused tests for strong, thin, and public-safe outputs.
4. Done: run required verification and audits; close the plan with a scoped commit.

## Decisions

- Wearables remain a research bridge layer only; lab/BP/body cards remain the only score-bearing path in this slice.

## Verification

- Passed: `pnpm --dir packages/health-metrics test:coverage`.
- Passed: `pnpm --dir packages/query test:coverage`.
- Passed: `pnpm --dir packages/health-metrics typecheck`.
- Passed: `pnpm --dir packages/query typecheck`.
- Passed: `pnpm test:smoke`.
- Passed: `git diff --check`.
- Root `pnpm typecheck` was green before the final public-boundary test hardening, then failed on an unrelated dirty hosted-runtime file: `packages/assistant-runtime/src/hosted-runtime.ts(388,9)`.
- Audits: simplify no findings; security/privacy low product-authorization finding fixed; coverage-write added public-safety assertions; final review low public sanitizer allowlist finding fixed.
Completed: 2026-05-11
