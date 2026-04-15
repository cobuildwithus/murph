# 2026-04-13 Security Review Watch Patch

## Goal

Land the returned watched-thread security patch only where it still applies, keeping the scope limited to hosted device-sync callback handling, OAuth state consumption, and hosted token-audit attribution.

## Constraints

- Preserve unrelated dirty worktree edits, especially the active package-boundary lane already touching the coordination ledger and other package owners.
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Run truthful repo-required verification for the touched app/package slice and record unrelated blockers separately.
- After implementation and audits, send one same-thread `review:gpt` follow-up with attached files, then arm the final wake hop at recursive depth `0`.

## Risks

- `apps/web` and `packages/device-syncd` both sit on auth/control-plane paths, so malformed input handling must fail closed without widening redirects or burning valid OAuth state.
- The worktree is already dirty in unrelated areas, so only the reviewed files should move.

## Verification Plan

- `pnpm typecheck`
- `pnpm test:diff apps/web packages/device-syncd`
- `pnpm test:smoke`
- `git diff --check`

## Audit Plan

- Required `coverage-write` pass on `gpt-5.4-mini` if the verification lane stays coverage-bearing.
- Required `task-finish-review` pass after verification/fixes.

## Status

- Completed implementation and verification for the returned security patch.
- Required checks green after the final-review follow-up fix:
  - `pnpm typecheck`
  - `pnpm test:diff apps/web packages/device-syncd`
  - `pnpm test:smoke`
  - `git diff --check`
- Direct scenario proof confirmed hosted and local redirect helpers both return `null` for `javascript:` `returnTo`.
- Required `coverage-write` pass returned no additional changes.
- Required final review found one real issue in the hosted callback `TypeError` catch and one missing daemon-edge proof; both were fixed locally and verified.
- Attempted the required same-thread `pnpm review:gpt --send ...` follow-up review once. The managed browser staged attachments but ChatGPT kept the send button disabled, so delivery is unconfirmed.
- Armed the detached recursive depth-0 wake watcher at `output-packages/chatgpt-watch/69dc208a-f708-8399-80d6-eb93a517e662-2026-04-13T000128Z/`; current status is `waiting`.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
