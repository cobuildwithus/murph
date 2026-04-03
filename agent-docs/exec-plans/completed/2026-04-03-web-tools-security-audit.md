# Web Tools Security Audit Patch

## Goal

Land the supplied security hardening patch for the assistant `web.fetch` and `web.pdf.read` tools so they are explicit opt-in egress surfaces, redact query-bearing URL details, reject more private-network edge cases, and fail closed when PDF parsing or extraction stalls past the configured timeout.

## Why

- The current defaults expose outbound web-read tools unless they are explicitly disabled, which is broader than the intended trust boundary.
- Returned metadata and error paths currently expose full URLs, including query strings and fragments that may carry signed or session-bound data.
- Hostname and IP filtering needs tighter normalization for IPv6-literal and reserved-range edge cases.
- PDF timeouts currently cover fetch but not the later parse and extraction work, leaving room for stalled or truncated documents to consume unbounded work.

## Scope

- `packages/assistant-core/src/assistant/web-fetch.ts`
- `packages/assistant-core/src/assistant/web-pdf-read.ts`
- `packages/assistant-core/src/assistant-cli-tools.ts`
- `ARCHITECTURE.md`
- `agent-docs/SECURITY.md`
- `agent-docs/index.md`

## Constraints

- Preserve unrelated dirty-tree edits outside this patch lane.
- Keep the change scoped to the supplied patch intent; do not attempt the larger DNS-rebinding/socket-pinning follow-up here.
- Avoid adding dependencies.
- Run the full high-risk verification baseline unless it is credibly blocked for an unrelated pre-existing reason.

## Verification Plan

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused assistant-core tests or direct evidence if the supplied patch surface lacks an existing dedicated regression lane

## Notes

- Treat the supplied patch as behavioral intent; reconcile against live file state instead of applying blindly.
- The supplied snapshot noted absent changes for `pnpm-lock.yaml` and `packages/cli/test/inbox-model-harness.test.ts`; do not invent edits there unless current repo state requires them.
- Current Node `BlockList` behavior makes an IPv6 `::ffff:0:0/96` rule match ordinary IPv4 checks, so the mapped-IPv6 hardening is implemented with an explicit IPv4-mapped-IPv6 parser instead of that raw subnet entry.
- The final audit found one timeout-helper issue in the pre-aborted path; the landing now attaches a rejection sink before aborting so `pdfjs` promises cannot escape as unhandled rejections.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
