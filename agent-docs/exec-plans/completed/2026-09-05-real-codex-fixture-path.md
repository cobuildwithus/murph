# Preserve fixture PATH through login shells

## Outcome and invariants

Explicit real-Codex fixture tools must remain first in PATH when a synthetic journey executes a login shell. Keep this inside the existing test harness; retain provider-key exclusion, explicit config precedence, caller environment/profile ownership, and caller-owned temporary cleanup. No runtime or global profile change.

## Owner and evidence

Frog #2729 is bound to `.agents/friction-log/20260829231539-real-codex-harness/friction.md`. The suite currently duplicates private `.zprofile` setup in two Personal Patterns journeys. Prior synthetic proof established that a login profile can displace the injected PATH. Extend the existing turn wrapper with explicit fixture intent and reuse one profile-preparation helper rather than general PATH interception.

## Plan

1. Reproduce actual `/bin/zsh -lc` selection through an injected test executor; assert the unmodified baseline and provider-key filtering.
2. Move both duplicated journey profiles into an explicit fixture-bin option. Preserve caller-owned ZDOTDIR; conflicting automatic-profile intent must fail before invocation without touching caller files.
3. Run the deterministic harness group, relevant typecheck, docs checks, and complexity inspection. Close this plan with focused evidence.
4. Push a draft, establish exact readiness, run requested full ReviewGPT with validated model/timing concurrently with required CI, then land and verify the actual merged tree before closing the issue and retiring the worktree.

## Verification

- Before implementation, both new focused tests failed: actual login-shell selection returned the ambient marker, and conflicting caller-profile intent reached the executor.
- After implementation, the complete deterministic harness group passes 12 tests. Controls prove non-login injected selection, login ambient displacement, helper-prepared login selection, shell-policy provider-key exclusion, explicit override precedence, unchanged caller env/profile, and early rejection of conflicting profile ownership.
- `pnpm --dir packages/assistant-engine typecheck` passed including the changed test file. `pnpm complexity:diff` passed and correctly excludes test-only code from its source metric; the small helper introduces no complex branch. `pnpm docs:drift` and `pnpm docs:gardening` passed. Usage is documented in the package README; the generic testing index remains unchanged.
- Two duplicate Personal Patterns profile blocks now use the shared explicit option. Other unrelated PATH customizations remain unchanged.
- No live model or nested Codex invocation occurred. Required external review and exact-head CI remain the PR completion gates.

## Completion decisions

Internal test tooling only: Product UX and public changelog are not applicable. Preserve existing shell permissions and production configuration. Use the existing Frog entry; no duplicate report.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
