# Distinguish Linq route projection rejection causes

Status: completed
Created: 2026-10-06
Updated: 2026-10-06

## Goal

- Distinguish the existing Linq route-projection rejection conditions through the current private error diagnostic, without changing authorization or delivery behavior.

## Success criteria

- Actual route tests distinguish missing chat/key, inconsistent chat/key, missing sender, and inconsistent sender/key while preserving the exact public rejection and successful routing.
- Only closed diagnostic values enter the existing warning; no content, identifiers, new reads, writes, logs, or provider calls.
- ReviewGPT authors the change; focused proof, final review, and required exact-head CI pass before telemetry-only merge. Canonical deployment and natural emission are verified separately.

## Scope

- In scope: current member-route projection guard, existing error reason allowlist, focused route/HTTP tests, and owner documentation.
- Out of scope: route repair, altered authorization, provider effects, retries, schemas, deployment configuration, and unrelated sweep findings.

## Constraints

- Preserve guard ordering and short-circuit lookup operations, public error shape, transaction count, and quiet success paths.
- A diagnostic identifies the rejected condition; it does not prove delivery recovery or authorize repair.

## Risks and mitigations

1. Classification could accidentally change authority or evaluate additional private values.
   Mitigation: ordered existing predicates, exact rejection/success tests, no duplicate classification reads, strict output allowlist.

## Tasks

1. Reproduce the ambiguous classification using synthetic actual-route fixtures.
2. Obtain and inspect ReviewGPT's minimal telemetry patch.
3. Run baseline-failing regressions, focused suites, typecheck, privacy and complexity checks.
4. Commit, push, obtain final ReviewGPT and CI, then use authorized telemetry-only merge and canonical deployment.
5. Preserve the bounded natural-traffic query and any unexercised emission gap.

## Decisions

- Extend the current reason vocabulary instead of adding another telemetry field or pipeline. Existing production evidence identifies the composite guard but cannot distinguish its conditions.
- Independent open PR diffs were inspected; none owns this diagnostic or its route guard.

## Verification

- Baseline: actual egress engagement and HTTP suites, 112 tests pass before the new diagnostic regressions.
- Run focused Web tests, Web typecheck, scoped ESLint, documentation drift/gardening, complexity diff and whitespace checks. Require unchanged public HTTP output and no unauthorized effects.

## Candidate evidence

- ReviewGPT authored the runtime change and focused tests; parent inspected the
  full patch and placed the documentation with the existing Web diagnostic owner.
- Regressions against unchanged production source: 23 failures and 134 passes.
  With the diagnostic change, both focused suites pass all 157 tests.
- Web typecheck, scoped ESLint, documentation drift, and whitespace checks pass.
- Complexity debt is unchanged. The existing authority-hint resolver remains
  at 45 and is not modified; the projection resolver keeps the original checks.
- No product or provider-input change; changelog and real-model journeys are
  not applicable. Public error JSON and headers, current/pending success paths,
  lookup order, read/write counts, and omission of malformed metadata are covered.
- Final ReviewGPT passed on pushed candidate
  `f55fd8a0bbdaf4dd6e99dfb7c35a5e2f46ef975f`, with no accepted findings.
  Parent final review confirms unchanged behavior, private closed values,
  unchanged complexity, and the absence of new runtime work.
- Implementation and focused proof are complete. Plan closure and its index
  pointer are the only later edits; required exact-head CI remains a merge gate.
- Telemetry-only merge is authorized after CI passes. Canonical Web deployment
  and natural emission verification remain separate operational follow-ups;
  absence of traffic will not establish a fixed route or recovered delivery.
Completed: 2026-10-06
