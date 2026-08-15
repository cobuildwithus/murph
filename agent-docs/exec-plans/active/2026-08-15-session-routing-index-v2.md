# Session routing index v2

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Replace the unbounded shared assistant alias/conversation routing maps with
  exact per-route records so ordinary lookup and update work stays proportional
  to the requested routing keys, while preserving bounded recent-session
  listing and automatic recovery from the currently deployed aggregate index.

## Success criteria

- Exact alias and conversation-key updates write only their own deterministic
  routing record and do not rewrite unrelated routes.
- Existing aggregate indexes migrate from durable session files without losing
  valid routing or bounded recent-session behavior.
- Stale or corrupt routing records fail closed and recover from durable session
  state; removed bindings no longer resolve.
- Assistant-engine and runtime-state focused verification, workspace typecheck,
  exact-head CI, preliminary coverage review, and the final ReviewGPT loop pass.
- The PR contains no unresolved accepted finding and remains cleanly mergeable
  with the current base.

## Scope

- In scope: assistant session routing persistence, session resolution reads,
  portable local-state descriptors, migration/rebuild behavior, and focused
  regression coverage.
- Out of scope: canonical vault data, provider/session protocol changes,
  user-facing behavior, database state, and new runtime services or queues.

## Constraints

- Technical constraints: preserve one canonical durable session record per
  session; routing files are derived operational indexes, use atomic writes,
  and must recover deterministically after partial migration or corruption.
- Product/process constraints: start from current `origin/main`, treat the
  supplied patch as intent, prefer deletion and existing ownership boundaries,
  keep unrelated work untouched, and complete the repository's PR/ReviewGPT
  gates on the exact pushed head.

## Risks and mitigations

1. Risk: a migration or interrupted write leaves routing partially converted.
   Mitigation: rebuild exact routes from durable sessions and write the v2
   format marker last; prove interrupted/missing/corrupt cases with tests.
2. Risk: a stale route silently rebinds a canonical session.
   Mitigation: validate the expected alias or conversation key against the
   loaded session before applying any binding patch.
3. Risk: replacing one shared file with many files creates speculative state or
   cleanup machinery.
   Mitigation: keep records content-minimal, deterministically named, derived
   from existing session files, and avoid new services, locks, queues, or
   reconciliation loops.

## Tasks

1. Rebase the supplied patch onto current `origin/main` and inspect every hunk.
2. Review the state model and simplify the implementation against existing
   assistant/runtime-state ownership contracts.
3. Run focused persistence tests, runtime-state tests, typecheck, and direct
   migration/corruption scenario proof.
4. Commit and push a stable candidate, then open a draft PR with the complete
   intent, architecture, verification, and change-shape contract.
5. Run the preliminary coverage lens and final ReviewGPT round concurrently
   with CI; reproduce and resolve every accepted finding.
6. Perform the parent final review, close this plan with the final scoped
   commit, rerun required gates on the exact head, and prove mergeability.

## Decisions

- Classify as a high-risk persisted-state change: coverage lens and sensitive
  final ReviewGPT gate are required; product, prompt, and frontend lenses are
  not applicable unless the final diff broadens.
- Changelog is not applicable because this is internal assistant runtime
  persistence with no member-visible behavior change.

## Verification

- Commands to run: focused assistant persistence Vitest, runtime-state focused
  Vitest, `pnpm typecheck`, `git diff --check`, exact-head required CI,
  preliminary `completion-specialists`, final `pr-review`, and
  `git merge-tree --write-tree` against current `origin/main`.
- Expected outcomes: all commands pass; migration and exact-route regression
  tests exercise production persistence code; ReviewGPT returns its required
  completion markers with no unresolved accepted findings.
