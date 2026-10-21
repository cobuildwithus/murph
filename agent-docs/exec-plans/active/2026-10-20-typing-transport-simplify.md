# Reduce repeated transport and Worker startup work

Status: active
Created: 2026-10-20
Updated: 2026-10-20

## Goal

Reduce avoidable work before hosted message typing begins, using the existing
transport and contract owners. Keep production diagnostics private.

## Success criteria

- Internal connections survive the default idle window and recover after server
  close or cancellation; public/provider fetch behavior stays unchanged.
- The Worker no longer evaluates the broad contracts schema module at startup.
- Remove redundant success logs while retaining correlated mailbox timing,
  non-OK responses, transport failures, and authority-rejection diagnostics.
- Focused tests, typechecks, complexity guard, exact-head CI, and ReviewGPT pass.

## Scope

Internal Node fetch pooling, narrow contract imports, and redundant transport
success logs. No direct-wake removal, retry changes, database changes, DNS cache,
new service, global dispatcher, proactive network traffic, or production deploy.

## Design

- One process-owned Undici Agent applies only to the existing internal hostname
  allowlist. Native fetch retains request semantics, hostnames, aborts, and
  shorter server keep-alive limits. The runtime dependency uses the existing pin.
- Move experiment-outcome definitions verbatim and re-export their original
  paths. Shared schema builders stay in one internal primitive module. Move two
  sleep enums to a second narrow public leaf; these were the last eager users of
  the broad schema module. No validation or serialized contract changes.
- Drop runtime request-start/success and intercept request-start/success records.
  Keep Web forwarding/completion, mailbox phase timing, and failure records.

## Verification

- Real loopback HTTP test: one connection across a 4.5-second idle interval,
  reconnect after server close, cancellation and subsequent success, unchanged
  external fetch options and internal Host header.
- Focused Cloudflare transport/intercept suites: 544 tests pass; invocation and
  bundle integration: 57 pass. Contracts: 392 pass. Query replica: 111 pass.
  Hosted-execution vault sharing: 96 pass. Schema identity survives re-exports.
- Contracts, query, hosted-execution, and Cloudflare typechecks pass after local
  Prisma client generation. No production credentials or database are needed.
- Worker dry-run JavaScript: 3,025,799 to 2,895,748 bytes (130,051 bytes removed).
  Broad contracts schema module absent from emitted candidate bundle; no Node
  Undici dependency enters the Worker bundle.
- Six alternating baseline/candidate startup profile pairs: candidate faster in
  all six. Median non-idle local CPU: 59.13 ms to 43.60 ms (about 26% lower).
  Local CPU and loopback tests do not establish production end-to-end savings.
- Complexity guard passes; moved validation functions preserve their complexity.
- Remaining completion: public changelog, candidate review, PR, CI, ReviewGPT.

## Risks

Server keep-alive hints can shorten reuse; no background traffic attempts to
keep sockets open. A closed connection follows existing transport recovery.
Worker/container/Web skew remains compatible because request, response, auth,
fence, and persistent-state contracts are unchanged. Production latency must
be checked after a separately authorized rollout.
