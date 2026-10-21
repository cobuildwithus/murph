# Enable twelve-hour hosted prompt caching

Status: active
Created: 2026-10-20
Updated: 2026-10-20

## Goal and invariants

Enable twelve-hour prompt cache writes for managed OpenAI model requests over
native HTTP and WebSockets, preserving model selection, prompt content, auth,
opaque Worker socket forwarding, and accurate allowance accounting.

## Owner and evidence

The pinned native Codex request builder owns both transports. It currently sends
no TTL; the Worker cannot rewrite opaque WebSocket frames. Native usage preserves
aggregate cache writes but drops their lifetime breakdown. Web prices those
writes at the thirty-minute rate. Extend these existing owners without a new
proxy, state owner, database column, or retry.

## Scope and decisions

- Managed API-key hosted requests for existing supported models use request-level
  `prompt_cache_options.ttl = "12h"` with implicit caching.
- Subscription auth, unrelated models, and non-hosted Codex retain defaults.
- Preserve provider-reported twelve-hour write counts through native usage,
  sanitized raw usage, and allowance pricing; absent counts retain legacy pricing.
- Web must deploy before the new native runner. Old runners continue thirty-minute
  writes. New rows retain count evidence; no historical repricing.
- Internal cache policy only: no prompt/tool/reply or UI changes and no changelog.

## Tasks

1. Extend pinned native patch and protocol/serialization tests.
2. Preserve lifetime counts through TypeScript usage and price each write once.
3. Update privacy-safe diagnostics and owner documentation.
4. Run focused tests, typechecks, patch verification, and complexity review.
5. Commit, push, open the PR, start ReviewGPT concurrently with CI, resolve gates.

## Verification

Passed: 386 focused TypeScript tests across native usage parsing/deltas, idle
compaction, sanitized usage, mixed-lifetime allowance pricing, and diagnostics.
Affected package/Web/Cloudflare typechecks, workspace build, Web lint, docs drift,
complexity guard, and upstream source/patch verification passed. Native API usage
and WebSocket serialization tests passed; native core and app-server protocol
test targets compile. No production request or deployment was performed.

Native hosted policy test and all four generated schema consistency tests passed.
The final patch reproduces the checked source and generated exports exactly.

Pending: required exact-head CI and ReviewGPT.
