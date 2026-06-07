Goal:
- Add focused demand-path coverage for browser-vault runtime-control mailbox items and simplify the runtime-control signal helper.

Scope:
- Add an explicit demand test proving `runtime.browser-vault-refresh-requested` system mailbox lag becomes browser-vault refresh runtime demand.
- Remove the optional workspace-ensure skip from the shared runtime-control mailbox helper.

Constraints:
- Keep this on the existing browser-vault mailbox PR.
- Do not start PR 2 or move browser-vault semantics into the local runtime in this change.
- Do not change Temporal workflow logic, Cloudflare, `readRuntimeDemand` production logic, or runtime execution semantics.

Verification:
- Run the focused demand and signal tests.
- Run diff-aware app verification for the touched files.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
