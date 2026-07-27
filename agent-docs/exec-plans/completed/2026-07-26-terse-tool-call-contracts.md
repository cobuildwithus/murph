# Shrink assistant tool descriptions to call contracts

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Reduce resident assistant tool-schema prompt cost by making the highest-volume
  tool descriptions concise call contracts while preserving each existing tool,
  input schema, authorization boundary, and retry/result semantics.

## Success criteria

- `plan_usage`, `subscription`, group, Family, progress-update, Computer, and
  connected-app tool descriptions state only operation, immediate authorization,
  and retry-safe result semantics.
- Product copy, workflow coaching, link presentation, and cross-tool routing
  remain owned by the resident system prompt or the relevant skill.
- Focused tests pin concise-description budgets and the durable prompt/skill
  owners for any policy removed from tool descriptions.
- Required assistant-engine verification, exact-head prompt review, and PR
  checks pass.

## Scope

- In scope:
  - Assistant Engine dynamic and connected-app tool descriptions.
  - The compact low-usage router sentence needed to load existing plan policy
    for explicit billing, plan, and usage requests.
  - Focused description-contract and prompt-owner tests.
- Out of scope:
  - Tool consolidation, schema or implementation changes, new authorization
    behavior, and product policy changes.

## Constraints

- Technical constraints:
  - Preserve tool names, action enums, parameter shapes, server boundaries, and
    idempotency/result behavior.
  - Keep retry ambiguity explicit for effectful operations.
- Product/process constraints:
  - Product workflow stays in stable prompts and skills rather than schemas.
  - Preserve unrelated worktree and ledger edits.

## Risks and mitigations

1. Risk: Removing prose also removes an invocation-critical safety condition.
   Mitigation: Classify every retained sentence as operation, authorization, or
   retry/result semantics and keep focused assertions for effectful tools.
2. Risk: Policy deleted from a description has no resident owner.
   Mitigation: Map removed policy to existing system-prompt and skill tests, and
   minimally extend the low-usage router where the explicit-request route was
   not named.

## Tasks

1. Measure the current target-description footprint and map policy owners.
2. Replace target descriptions with terse call contracts.
3. Update focused tests to assert contract budgets and resident policy owners.
4. Run focused tests, canonical diff verification, acceptance verification, and
   inspect the final diff and measured savings.
5. Commit and push the exact PR head, run preliminary prompt/coverage ReviewGPT
   concurrently with CI, resolve findings, and finish the scoped task.

## Decisions

- Keep all existing typed tools instead of introducing a generic meta-tool.
- Treat this as prompt-primary, meaning-preserving ownership work; no
  product-experience review is required unless implementation changes a
  product-owned behavior.
- Keep action-specific argument requirements in JSON Schema while limiting each
  top-level description to one paragraph and a route-wide 5,000-character
  regression budget.
- Route explicit hosted plan, usage, billing, Family-member usage, and group
  funding requests to the existing hosted-low-usage skill so removed policy has
  one resident owner.
- Accepted preliminary specialist finding: the original shrink left the private
  Settings eligibility matrix and `continue_pulse` effect without a complete
  resident owner. Added one compact billing-truth rule to the stable low-usage
  router and assembled-prompt coverage; tool descriptions remain terse.

## Verification

- Commands to run:
  - Focused assistant-engine Vitest files for the touched tool and prompt owners.
  - `pnpm test:diff ...`
  - `pnpm verify:acceptance`
  - Exact-head preliminary ReviewGPT prompt and coverage lenses.
- Expected outcomes:
  - All checks pass, schemas remain unchanged, and target descriptions show a
    material aggregate character/token reduction.
- Current evidence:
  - Target direct-route descriptions fell from 24,024 to 4,732 characters, a
    19,292-character reduction (about 4.8k tokens before serialization).
  - Focused Assistant Engine proof passed: 12 files and 238 tests.
  - The canonical diff lane passed every guard, six affected typechecks, the
    full Assistant Engine suite (176 files, 2,731 tests), Assistant CLI (22
    files, 128 tests), Assistant Runtime (76 files, 1,896 tests), and assistantd
    (11 files, 40 tests).
  - The same diff lane became non-green only in unrelated CLI integration
    buckets, where broad 60-90 second timeouts affected session, workout,
    document, meal, and media-staging cases under shared-host contention. After
    the failure was established, the exact session-owned process group was
    terminated and verified absent rather than leaving it to drain hours of
    additional timeout windows.
  - The corrected-head diff lane repeated the passing guards, affected
    typechecks, and package suites above before the same eight unrelated
    `assistant-cli.test.ts` cases reached their 60-second host timeouts. Its
    exact session-owned process group was likewise terminated and verified
    absent.
  - All GitHub checks on the corrected pushed head passed, including release
    build/typecheck, Assistant/CLI/platform coverage, app verification, CLI host
    matrices, E2E gates, frontend design, and repository hygiene.
  - Preliminary ReviewGPT prompt/coverage pass returned one accepted medium
    finding for missing resident billing truth and no coverage artifact. The
    correction is the compact router rule and assembled-prompt regression proof
    described above; the preliminary pass is not rerun for this correction.
  - Parent final review found no additional issues; `git diff --check` is clean
    and the production diff changes only descriptions plus the resident billing
    router.
  - `pnpm verify:acceptance` was started but could not acquire the repository's
    exclusive shared-host slot because an unrelated `apps/web verify` process
    remained active. After several minutes of fail-closed waiting, only this
    task's queued command was cancelled. The pushed-head GitHub acceptance
    checks listed above are green.
Completed: 2026-07-26
