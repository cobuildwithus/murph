# 2026-03-17 Telegram GrammY Only

## Goal

Collapse Telegram ingestion onto grammY so Healthy Bob has one Telegram implementation path instead of a raw HTTP Bot API path plus a separate grammY-compatible wrapper.

## Scope

- `packages/inboxd` Telegram connector implementation, exports, package dependency, and tests
- `packages/cli` Telegram driver instantiation and affected tests
- Telegram docs that currently describe a raw Bot API default versus an optional grammY wrapper

## Constraints

- Preserve the existing poll-first, local-first vault persistence model.
- Preserve custom file-download behavior and webhook-reset behavior.
- Avoid broad CLI or web changes outside the Telegram surface.

## Plan

1. Replace the raw Bot API implementation with grammY-backed driver creation.
2. Update the CLI/runtime to construct grammY directly from the bot token.
3. Rewrite docs and tests so grammY is the only advertised implementation path.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
