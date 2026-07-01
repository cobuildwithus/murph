# PR 344 Abort Requested Semantics

## Goal

Fix ReviewGPT round 14: an abort endpoint `accepted` response is not replacement-safe when RunnerContainer has lost the local invoke/lifecycle pointer.

## Constraints

- No new state owner or lifecycle operation.
- Keep exact local-pointer aborts replacement-safe because the Durable Object lifecycle lock still owns the old invoke unwind.
- Missing-pointer abort delivery must preserve the old durable fence until liveness proves inactive or the container is stopped.

## Approach

- Add an explicit `requested` abort status for missing-pointer endpoint accepted/queued responses.
- Let UserRunner retry/preserve on `requested`, `stale`, and `failed`.
- Let UserRunner replace only on local `accepted` or inactive proof.

## Verification

- RunnerContainer status regression for missing-pointer endpoint accepted -> `requested`.
- UserRunner regression proving foreground does not clear the retention fence until a later inactive proof.
- Focused Cloudflare runtime tests and typecheck.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
