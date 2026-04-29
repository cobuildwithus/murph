# Hosted Inbox Capture Decoupling

## Goal

Keep hosted conversation-message handling live when inbox-capture projection text is large or imperfect.

Success means:

- A long user message can be decoded, persisted, and admitted to the assistant path without tripping the inbox-capture record text limit.
- The inbox-capture ledger keeps a bounded text projection for search/list surfaces.
- The raw inbox envelope and same-run runtime capture retain the full decoded text for the agent path.
- If canonical inbox persistence fails after decode, hosted runtime can stage the decoded capture in a hidden local runtime projection row while keeping the hosted mailbox item retryable, excluding that row from normal durable automation/list/show/search and capture mutation-cursor surfaces, and admitting it only through the hosted active-turn input read path for the same run.
- The current production-blocking `$.text <= 4000` validation failure is covered by a focused regression test.

## Constraints

- Do not print or persist secrets, raw provider payloads, or local personal identifiers in logs/docs.
- Preserve unrelated dirty work.
- Keep the change narrow: contracts, inbox persistence/runtime projection, focused hosted-runtime tests/docs.

## Current State

- Production failed on a hosted conversation mailbox import because the canonical inbox-capture record rejected text over 4000 characters.
- Hosted mailbox import already handles parser drain as best-effort after capture persistence; the remaining blocker is the capture record text projection budget.
- Hosted mailbox import now needs the active assistant pass to remain available even when canonical capture persistence is temporarily unavailable.

## Plan

1. Raise the canonical inbox-capture text projection budget to 20000 characters.
2. Clamp only the ledger projection text during canonical inbox-capture record construction.
3. Keep raw envelope/runtime input text unchanged so the agent path sees the full decoded message in the active run.
4. Stage decoded conversation input into a hidden runtime projection row on canonical persistence failure, but return a retryable mailbox block so durable import watermarks do not advance and normal durable/capture-sync surfaces do not consume transient input.
5. Let hosted active-turn admission explicitly opt into hidden runtime-only rows for the same run without exposing them to normal inbox commands or durable automation scans.
6. Add focused tests that prove oversized projection text no longer blocks persistence, raw envelope/runtime input keeps the full text, runtime-only staging does not mark mailbox import durable, and hosted active-turn admission can see transient input.
7. Update assistant-runtime docs to record the ownership boundary.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
