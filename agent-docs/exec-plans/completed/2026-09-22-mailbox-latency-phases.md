# Separate mailbox callback and Web latency phases

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal

Attribute the remaining mailbox round-trip latency using existing diagnostics,
without duplicating the Web phase/query/pool instrumentation merged in #3655.

## Scope and constraints

- Extend the existing Worker response log with callback preparation, HTTP
  response-header wait, and a bounded Vercel region path.
- Preserve the existing response, signature, authority, timeout, request count,
  and optional Server-Timing contract. No new network requests, dependencies,
  state owner, telemetry service, or configuration.
- Discarded overlapping Web edits after updating the branch onto #3655.
- Remove the unused replica-publication flag. Existing combined mailbox SQL and
  authority locks remain; no measured evidence justifies caching or weakening
  their ordering. The merged lazy Google SDK loading owns startup optimization.
- Production evidence stays outside repository artifacts; use synthetic tests.

## Risks and proof

- Worker clocks advance only on I/O: zero preparation time does not establish
  zero CPU cost. Do not label the HTTP-minus-handler residual pure network time.
- Vercel metadata is optional and untrusted: retain only bounded region codes,
  never the opaque request suffix or arbitrary header text.
- Focused real-helper and composed Worker tests prove duration boundaries,
  unchanged streaming/status behavior, one fetch, and privacy. Run Worker
  typecheck and complexity guard, parent review, exact-head CI and ReviewGPT.

## Completion

1. Verify the narrow Worker change against current main and #3655.
2. Commit, open a draft PR, complete review and CI, and merge.
3. Deploy through protected release owners, verify exact source and smoke,
   then inspect new measurements before claiming an optimization benefit.

## Evidence

- Focused Worker tests: 40 passed across mailbox parsing/decode, actual Web
  client timing and authority forwarding, and checkpoint response handling.
- Cloudflare typecheck and `pnpm complexity:diff --base origin/main` pass.
  Existing request-handler hotspot remains 37; new metrics stay with the
  existing mailbox completion owner. No new request or body consumption.
- Parent review checked the full diff, optional-header skew, response identity,
  signature and timeout preservation, streaming, and private-header omission.
- Internal-only diagnostics: no changelog or provider-input replay is needed;
  individual/group prompts, tools, replies, and public UI are unchanged.
- Implementation complete. The PR owns exact-head CI, final ReviewGPT, merge,
  and the authorized protected deployment and live observation gates.
Completed: 2026-09-22
