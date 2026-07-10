# CLI Output Budget

## Goal

Reduce high-volume `vault-cli` / `murph` outputs that exceeded roughly 20k characters in the July 8 CLI output audit, focusing on model-facing list/status/read surfaces that leak full records or unbounded history by default.

## Constraints

- Keep changes in the CLI/usecase/read-output layer; do not change canonical vault storage.
- Prefer default limits, compact list rows, and explicit `--full-output` escape hatches over new abstractions.
- Preserve operator access to detailed data through existing show/detail commands or explicit full-output modes.
- Do not weaken Incur discovery semantics; leave large framework-owned `--schema` / `--llms-full` behavior alone unless there is a repo-owned bounded surface.
- Use the prior count artifacts under `/tmp/murph-cli-output-audit` as measurement input, but do not commit vault data or raw command output.
- Run CLI-focused verification and ReviewGPT PR rounds before handoff.

## Plan

1. Map every successful runtime command over 20k characters to its owning package/code path and classify whether it can be shrunk by default limits, compact rows, or explicit full-output gating.
2. Implement the smallest bounded-output changes for high-value model-facing surfaces: assistant sessions, generic/entity lists, wearable summaries, audit/history, automation/regimen/experiment list rows, and onboarding resume context where reasonable.
3. Add focused regression tests that prove default outputs stay compact while explicit full-output/detail paths remain available.
4. Re-run output measurements against a synthetic oversized-record vault for the changed high-volume commands and record tradeoffs/product calls.
5. Run required CLI verification, close this plan with `scripts/finish-task`, open a PR, and run PR ReviewGPT rounds to zero accepted findings.

## Verification

- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/vault-usecases typecheck`
- `pnpm --dir packages/assistant-cli typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/vault-usecases test`
- `pnpm --dir packages/assistant-cli test`
- `pnpm --dir packages/cli test:source`
- `pnpm --dir packages/cli verify:package-shape`
- Synthetic oversized-record byte smoke: `event list` 11,555 chars, root `list` 11,519 chars, `automation list` 7,852 chars, `scheduled-log list` 5,502 chars.
- PR ReviewGPT loop to zero accepted findings.

## State

Implementation and local verification complete in `/tmp/murph-cli-output-budget`.

Default model-facing list pages now return 10 rows, assistant session/onboarding defaults return 5 rows, wearable list defaults return 5 rows, audit tail returns 10 rows, and long/nested list payloads are compacted into scalar summaries. Detail commands still return full records. Incur discovery/schema outputs remain unchanged because they are explicit contract/discovery surfaces rather than default runtime reads.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
