# Enable twelve-hour hosted prompt caching

Status: completed
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

ReviewGPT round 1: PASS on
`f2346349e6212b21b2ac7a8256ad87d46b33ba55`, using the managed Eragon lane and
verified GPT-6 Pro selection. The complete native-source attachment was confirmed;
exact-turn capture completed after 253 seconds with `REVIEW_COMPLETE`. The review
covered all changed files, native source provenance, auth/model/transport scope,
usage accounting, and deployment skew. No qualifying findings. Accepted as a
substantive completed full-snapshot review. No remediation was required.

PR: https://github.com/cobuildwithus/murph/pull/4257

Parent review, focused proof, and implementation are complete. This closeout is
explanatory documentation only and does not require another substantive review.
Required CI on the final documentation-closeout head remains a PR completion gate;
the original session continues to own that check. No merge or deploy is included.
Completed: 2026-10-20
