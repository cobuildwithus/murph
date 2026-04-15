# Review and simplify the hosted runner smoke, then align local Node

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Review the newly landed hosted runner image smoke deeply for any remaining simplification, composability, or correctness opportunities and implement the highest-signal cleanups.
- Align the local development environment to the repo's required Node version so verification runs without the current engine mismatch warning.

## Success criteria

- Any remaining smoke-path cleanup is justified, minimal, and measurably simplifies ownership or composition rather than adding another layer.
- The local Node runtime is updated to match `.nvmrc` / repo engines (`24.14.1`) and can be verified directly from the shell.
- Verification remains green after any follow-up cleanup.

## Scope

- In scope:
- hosted runner smoke files under `apps/cloudflare/**`
- closely adjacent hosted runtime / parser / bundle seams only if a simplification clearly earns its keep
- repo docs or contracts that must stay aligned with the simplified flow
- local Node environment alignment to `24.14.1`
- Out of scope:
- unrelated active dirty-tree lanes under `apps/web`, `packages/inboxd`, `packages/operator-config`, and `packages/setup-cli`
- broader repo-wide Node policy changes already covered by the separate node-uniformity lane unless directly required for local environment alignment

## Constraints

- Preserve unrelated in-flight edits.
- Keep changes compositional and local; avoid reopening product/runtime architecture beyond the hosted smoke seam.
- If local Node alignment requires a machine-level install or shell-profile update, use the narrowest official path available and verify it explicitly.

## Decisions

- Keep the parent smoke launcher as-is; its remaining duplication with the hosted isolated runner does not justify a new shared abstraction yet.
- Simplify the smoke child by routing parser checks through the shared `@murphai/parsers` attachment pipeline instead of smoke-only direct provider wiring.
- Strengthen the smoke result contract to record the selected parser provider ids so the final-image proof explicitly asserts `pdftotext` and `whisper.cpp`.
- Align local login-shell Node selection by sourcing `nvm` from the login-shell path and selecting the repo/default version there.

## Tasks

1. Review the smoke path against adjacent bundle/runtime/parser seams and identify the smallest high-value simplifications.
2. Implement any worthwhile cleanup and keep tests/docs aligned.
3. Update the local Node runtime to `24.14.1` and verify with direct shell checks.
4. Run verification, complete the required final audit pass, and commit only this lane.

## Verification

- `pnpm --dir apps/cloudflare test:node -- --runInBand`
- `pnpm typecheck`
- `pnpm --dir apps/cloudflare runner:docker:smoke`
- `node -v`

## Results

- Focused Cloudflare Node tests passed after the smoke refactor.
- Repo typecheck passed.
- Local final-image smoke passed and now reported `pdfProviderId=pdftotext`, `wavTranscriptProviderId=whisper.cpp`, and `normalizedTranscriptProviderId=whisper.cpp`.
- Login-shell Node verification now reports `v24.14.1`.
Completed: 2026-04-09
