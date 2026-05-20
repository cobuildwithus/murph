# Clawpatch Worth-Fixing Eight

## Goal

Resolve the next eight worthwhile Clawpatch findings with simple, maintainable fixes:

- apps/web TypeScript paths must not bypass workspace package public entrypoints.
- apps/web dev wrapper lock cleanup must be owner-aware.
- hosted-local-harness advertised exports must import cleanly.
- health-commons generated artifacts must not go stale across build/typecheck.
- subprocessors HTML must match canonical legal data categories.
- root page must fail open on the non-critical GitHub star fetch.
- refresh-token-bundle must validate `expectedTokenVersion`.
- join success page must tolerate malformed percent-encoding.

## Constraints

- Preserve unrelated dirty work and active ledger rows.
- Keep package boundaries semantic and avoid wildcard access to sibling internals.
- Do not add speculative abstractions, dependency changes, or third-party packages.
- Do not expose local paths, local usernames, personal identifiers, secrets, raw payloads, or raw authorization headers.
- Use repo-local public package entrypoints and existing helpers before adding new surfaces.

## Plan

1. Register the task and split independent write scopes across workers.
2. Inspect each finding against current code before editing.
3. Land focused fixes and direct regression tests for each confirmed bug or contract gap.
4. Run scoped package/app verification and Clawpatch revalidation for the eight findings.
5. Run required completion audits, address material findings, and commit with `scripts/finish-task`.

## Progress

- Registered plan and coordination-ledger row.
- App fixes landed for workspace path aliases, dev-lock ownership, token-version validation, subprocessors copy, GitHub star timeout, and malformed join success params.
- Health Commons generated-artifact build/typecheck fixes landed with focused regressions.
- Hosted local harness export fix landed; `src/e2e.ts` overlaps pre-existing hosted-local scenario edits, so final commit scoping must account for that overlap.
- Extended the alias fix to root/shared `tsconfig.base.json` and `packages/inbox-services/tsconfig.typecheck.json` after Clawpatch revalidation found inherited `@murphai/contracts/*` and `@murphai/runtime-state/*` wildcards.
- Clawpatch revalidated all nine findings as fixed with the `.codex-3` profile.
- Focused checks, package verifies, full diff-aware verification, simplify/security/privacy/coverage/frontend/final audits completed.
- Simplify follow-ups landed: hosted-local state now lazily uses the canonical hosted-local config parser, and boundary diagnostics avoid duplicate wildcard messages.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
