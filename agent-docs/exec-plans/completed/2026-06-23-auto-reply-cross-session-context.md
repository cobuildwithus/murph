# Auto-reply cross-session context

## Goal

Land the supplied assistant-engine patch so auto-reply turns preserve the intended cross-session context path without broadening assistant runtime ownership or replaying the wrong conversation state.

Success criteria:

- Auto-reply planning carries the needed protocol/session context through the existing assistant-engine seams.
- Reply automation behavior remains direct-thread scoped and does not expose additional identifiers or provider payloads.
- Focused assistant-engine tests and required repo verification pass.
- Required security/privacy, coverage, and deep-review completion gates have no unresolved accepted findings.

## Scope

- In: `packages/assistant-engine` auto-reply planning and focused tests from the supplied patch.
- In after deep-review finding: provider prompt composition that carries per-turn context into explicit auto-reply prompts.
- Out: hosted web ingress, Cloudflare runner behavior, provider API changes, new persisted state, and prompt-wide refactors.

## Constraints

- Preserve unrelated active work and ledger rows.
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Avoid speculative abstractions and keep changes inside the existing assistant-engine owner boundary.
- Do not expose local identifiers, secrets, raw provider payloads, transcripts, or vault contents in committed artifacts.

## Plan

1. Apply the supplied patch in the isolated worktree.
2. Inspect the resulting assistant-engine call paths and overlap with active nearby work.
3. Run focused assistant-engine verification plus required typecheck/test coverage.
4. Run required completion audits and resolve accepted findings.
5. Commit through `scripts/finish-task`, push the branch, and open a draft PR.

## Current verification note

- Deep review found that provider prompt composition dropped `turnContextPrompt` when explicit auto-reply prompts were used; fixed in `providers/helpers.ts` with a Codex app-server boundary regression.
- `pnpm --dir packages/assistant-engine test`, `pnpm typecheck`, `pnpm test:smoke`, and `git diff --check` passed after the provider-boundary fix.
- `pnpm test:diff <changed assistant-engine paths>` passed through assistant-cli and assistant-engine, then blocked on three pre-existing `packages/assistant-runtime` tests that also fail on unchanged main with no assistant-runtime diff.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
