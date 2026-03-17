# 2026-03-17 Telegram Local-First

## Goal

Port the provided Telegram local-first inbox integration into the current repo so Telegram can be configured, checked, backfilled, and watched through the existing inbox runtime without introducing per-channel persistence logic.

## Scope

- `packages/inboxd` shared poll-ingress abstractions, Telegram connector/driver/normalizer code, checkpoint persistence, tests, and README updates
- `packages/cli` inbox source registration and runtime wiring for Telegram
- Architecture and migration docs needed to describe the new connector shape

## Constraints

- Do not read `.env*` files or expose bot tokens.
- Preserve unrelated dirty work already in the tree.
- Keep Telegram webhook handling optional; this turn is poll-first and local-first.
- Merge generated CLI type updates carefully if command topology changed under adjacent work.

## Plan

1. Check whether the supplied patch applies cleanly to the current tree and use it where it fits.
2. Manually merge any conflicts caused by local drift, especially in shared CLI/generated files.
3. Run repo-required verification plus completion-workflow audits, then commit only the touched Telegram files.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
