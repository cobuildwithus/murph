# Hosted CLI Bridge Client Timeout

## Goal

Make hosted `vault-cli device connect` bridge calls bounded when the loopback bridge accepts a TCP connection but never responds.

## Scope

- Add a shared hosted CLI bridge request timeout constant.
- Pass an abort signal to `requestHostedCliDeviceConnectLink`.
- Map timeout/network failures to bounded bridge errors, with a timeout-specific CLI error when applicable.
- Add focused tests for client timeout/error behavior.

## Constraints

- Preserve the existing loopback-only bridge URL and bearer-token authority model.
- Do not log or fixture secrets, local paths, or real user identifiers.
- Preserve unrelated dirty working-tree edits and active ledger rows.

## Verification

- `pnpm typecheck`
- Focused package tests or `pnpm test:diff` for the touched files.
- Required security/privacy, coverage, and final completion reviews.

## Status

- 2026-05-03: Implemented shared bridge timeout, bounded client transport errors, CLI timeout mapping, and focused coverage. Scoped verification is green except unrelated assistant-runtime typecheck failures outside this slice.
