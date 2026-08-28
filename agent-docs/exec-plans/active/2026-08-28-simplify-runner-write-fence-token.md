# Simplify runner write-fence token

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Remove two redundant fields from Cloudflare's internal runner write-fence
  token without changing persisted state, external wire contracts, or any
  attempt/generation/user/workspace ownership check.

## Success criteria

- `RunnerWriteFenceToken` no longer carries the unused `expiresAt` field.
- `RunnerWriteFenceToken` has one generation source; external
  `leaseGeneration` fields derive from `token.generation`.
- Existing write-fence identity, provider-egress, runtime completion, and
  workspace-version checks remain intact.
- Focused Cloudflare tests and typecheck pass.
- Exact pushed head completes the required ReviewGPT gates and required CI.

## Scope

- In scope: the internal token type, its constructors, Cloudflare mappings to
  existing external `leaseGeneration` fields, and focused tests/types.
- Out of scope: persisted Durable Object schema, external runtime-control wire
  shapes, write-fence semantics, provider policy, deployment, and response-card
  behavior.

## Constraints

- Technical constraints: preserve all attempt/generation/user checks and the
  separate workspace-version CAS; do not rename the external wire field.
- Product/process constraints: internal-only behavior-preserving deletion;
  changelog not applicable; isolated worktree, scoped commit, draft PR, exact-
  head specialist and final ReviewGPT gates, and no merge.

## Risks and mitigations

1. Risk: accidentally weaken stale-runner or provider-effect fencing while
   deleting duplicate fields.
   Mitigation: change only token shape and boundary projection; inspect the
   final diff and run focused ownership/transport tests plus typecheck.
2. Risk: rename or remove the public `leaseGeneration` protocol field.
   Mitigation: retain every external field and derive it explicitly from
   `token.generation`.

## Tasks

1. [x] Inventory all internal token constructors and consumers on current main.
2. [x] Delete `expiresAt` and internal `leaseGeneration`; derive external values
   from `generation`.
3. [x] Update focused test fixtures and assertions only where the internal type
   requires it.
4. [x] Run focused tests, Cloudflare typecheck, and final diff/privacy review.
5. [ ] Finish the scoped commit, push, open a draft PR, and run sequential exact-
   head completion-specialists then final PR review while CI runs.

## Decisions

- Keep `generation` as the sole internal name because it is the Durable Object
  write-fence owner; keep `leaseGeneration` only at existing wire/log boundaries.
- Leave `kind`, attempt identity, user binding, provider token validation,
  runner-container validation, and workspace CAS unchanged.

## Verification

- Commands to run: focused Vitest suites covering runner state and runtime
  invocation transport failure; `pnpm --filter @murphai/cloudflare typecheck`;
  scoped diff/secret and identifier inspection; required exact-head CI and
  ReviewGPT gates.
- Expected outcomes: all checks green with a deletion-heavy, behavior-neutral
  diff and no deployment compatibility concern.
- Local outcome: four focused Vitest files passed (60 tests),
  `@murphai/cloudflare-runner` typecheck passed, `git diff --check` passed, and
  the scoped source search found no internal token consumer of either deleted
  field.
- Preliminary specialist outcome: one accepted test-only coverage finding.
  The corrected alarm and transport suites passed (192 tests), and the repeated
  Cloudflare typecheck passed.
