# Refactor hosted runtime job complexity

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Reduce the cyclomatic complexity of
  `runHostedWorkspaceRuntimeJobInProcessImpl` by extracting cohesive,
  single-owner helpers while preserving the hosted runtime's externally
  observable behavior and deployment contract.

## Success criteria

- The target function's measured cyclomatic complexity falls materially from
  its baseline of 428 without moving complexity into a new generic framework.
- Invocation fences, checkpoint/write authority, abort and deadline handling,
  retry/error mapping, cleanup ordering, foreground/background ownership, warm
  process behavior, and deploy compatibility remain unchanged.
- Focused assistant-runtime tests and package typecheck pass, including
  regression proof for any extracted seam whose ordering or ownership could
  otherwise regress.
- The exact scoped commit is pushed and represented by a draft pull request
  with the repository-required evidence and deployment-risk statement.

## Scope

- In scope: `packages/assistant-runtime/src/hosted-runtime.ts`, directly owned
  focused tests when needed, this execution plan, and a public-safe Frog entry
  only if new actionable repository friction is encountered.
- Out of scope: behavior changes, new services or dependencies, new durable
  state owners, generic orchestration frameworks, unrelated hosted-runtime
  cleanup, deployment configuration changes, and production rollout.

## Constraints

- Technical constraints: preserve all runtime protocol invariants and ordering;
  use narrow typed helpers; inspect and independently reimplement only accepted
  intent from the external patch; avoid broad casts and cross-package imports.
- Product/process constraints: use the sanctioned worktree, keep the PR draft,
  close this plan through `scripts/finish-task`, and follow the explicit task
  direction to skip formal ReviewGPT/specialist gates and not mark the PR ready.

## Risks and mitigations

1. Risk: extraction changes ordering or gives a helper authority it did not
   previously own.
   Mitigation: identify phase boundaries from the runtime protocol, pass
   dependencies and mutable execution state explicitly, retain writes and
   cleanup under their current owner, and add focused ordering proof.
2. Risk: complexity merely migrates into one equally large helper.
   Mitigation: measure per-function complexity after the extraction and prefer
   cohesive phase helpers with narrow return types.
3. Risk: a refactor-only source change breaks the preassembled runner bundle or
   warm-process path.
   Mitigation: keep exports and environment contracts stable, run the owning
   package tests/typecheck, and call out that deployment still requires the
   normal runner-bundle build and hosted smoke gates.

## Tasks

1. Read repository, Frog, hosted-runtime, security, reliability, and
   verification instructions; inspect the target and its focused tests.
2. Audit the preserved mid-edit source against the baseline implementation and
   treat every inherited extraction as untrusted until ordering is verified.
3. Implement accepted behavior-preserving extraction intent with focused
   regression proof where seams change.
4. Run focused tests, typecheck, and before/after complexity measurement; audit
   the diff for scope and private identifiers.
5. Close this plan through the scoped commit helper, push the exact head, and
   open a draft PR with the complete Murph description.

## Decisions

- The orchestration function remains the single lifecycle owner; extracted
  helpers may own cohesive calculations or phases but may not introduce a new
  service, state machine, or persistence boundary.

## Verification

- Commands to run: focused assistant-runtime Vitest targets, the package
  typecheck, the repository complexity measurement (or a compatible AST-based
  focused measurement), `git diff --check`, scoped status/diff inspection, and
  PR-body validation if the repository exposes it.
- Expected outcomes: all checks pass, the target's complexity is materially
  reduced, no unrelated files or identifiers enter the patch, and the draft PR
  head exactly matches the pushed candidate commit.

## Results

- Extracted six invocation-local lifecycle helpers without changing exported
  contracts, runtime inputs, checkpoint payloads, persisted state, provider
  requests, or deployment configuration. The orchestration function remains
  the single owner and the helpers share its existing mutable invocation state.
- The standardized TypeScript AST counter measured
  `runHostedWorkspaceRuntimeJobInProcessImpl` at 428 before and 247 after. The
  most complex extracted helper measures 39.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- The focused assistant-runtime Vitest command passed 125 tests across the
  checkpoint-race, checkpoint-wake, shutdown, collapsed-work, foreground-input,
  and provider-cleanup suites.
- `git diff --check` passed. The final scoped diff contains only the runtime
  source extraction and this completed execution plan.
- The change is internal and member-invisible, so no changelog entry applies.
  It ships through the existing runner-bundle deployment path with no protocol
  or persisted-shape compatibility change; ordinary exact-bundle smoke remains
  the deployment proof.
- Formal ReviewGPT and specialist gates intentionally did not run under the
  task's explicit completion override; the final PR remains draft.
Completed: 2026-08-30
