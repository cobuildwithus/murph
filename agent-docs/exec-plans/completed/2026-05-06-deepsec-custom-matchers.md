# DeepSec Custom Matchers

## Goal

Add repo-specific DeepSec matchers that cover entry-point gaps not reached by the default matcher set, then verify them with a targeted matcher scan.

## Scope

- Inspect existing `.deepsec/data/murph/files/**` candidate coverage and run findings.
- Map major repo entry points, especially hosted Next.js routes, Cloudflare Workers, local HTTP daemons, CLI commands, and dev/runtime scripts.
- Add focused custom matchers under `.deepsec/matchers/**`.
- Wire those matchers through `.deepsec/deepsec.config.ts`.
- Run the requested `.deepsec` matcher scan and spot-check candidates.

## Constraints

- Do not print or commit secrets, local account identifiers, or private absolute paths.
- Preserve unrelated dirty work in the current checkout.
- Keep file globs tight enough to avoid wedging the scanner.
- Prefer entry-point coverage matchers over speculative vulnerability predictions when the gap is framework/layout coverage.

## Verification

- `pnpm deepsec scan --matchers <new-slugs>` from `.deepsec/`.
- Spot-check up to three candidates per matcher.
- Run repo-required checks that are truthful for the touched tooling/config surface.

## State

- Done: inspected existing DeepSec candidate/finding coverage and mapped the main repo entry-point gaps.
- Done: added and wired Cloudflare Worker/container, Node HTTP, Incur CLI, and signed-request replay matchers.
- Done: ran targeted DeepSec scans and spot checks; final scan passed with matcher counts recorded in handoff.
- Done: ran direct matcher/config typecheck and diff whitespace checks.
- Blocked: root `pnpm typecheck` is red from unrelated existing dirty Cloudflare E2E test type errors outside this task scope.
- Next: none.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
