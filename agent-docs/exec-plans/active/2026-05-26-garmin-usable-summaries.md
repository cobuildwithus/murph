# Garmin Usable Summaries Plan

## Goal

Find and fix why a hosted-local Garmin/Junction connection can look active while wearable activity, sleep, recovery, and body summaries remain empty.

Success criteria:

- A focused regression covers the connected/imported Garmin data path that previously produced no usable wearable summaries.
- The fix keeps the canonical import/query ownership simple and does not expose raw health payloads, local paths, account IDs, or provider secrets in logs, docs, tests, or generated files.
- Required focused tests, typecheck, and completion audits are run or any unrelated blockers are recorded.

## Constraints

- Preserve unrelated dirty worktree edits and active Junction/device-sync rows.
- Do not inspect or print `.env` contents, raw provider payloads, user health values from a live vault, local account identifiers, full home paths, raw account IDs, or secrets.
- Prefer the existing wearable import/query primitives over adding a parallel summary system.

## Plan

1. Trace the assistant prompt, CLI wearable summaries, query read model, and Junction/Garmin importer path to locate the connection-versus-summary split.
2. Add a focused regression that proves imported Garmin wearable evidence reaches the same summary APIs the assistant uses.
3. Implement the smallest durable bridge between the imported wearable evidence and query summaries.
4. Run focused package tests, `pnpm typecheck`, required audits, and diff/privacy hygiene checks.
5. Close this active plan through `scripts/finish-task` if a scoped commit is safe.

## Notes

- Initial evidence points to the assistant seeing device account connection state through device-sync while usable summaries come from `vault-cli wearables latest` / query wearable summaries.
- The likely fault boundary is between device-provider import output and the query wearable read model, not the assistant response wording.
