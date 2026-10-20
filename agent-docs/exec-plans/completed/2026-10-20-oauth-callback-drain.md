# Preserve old runtime callbacks through OAuth retirement rollout

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Outcome and invariant

Keep automatic Web releases and gradual Worker/native rollout compatible with the actual serving legacy OAuth callback producer while preserving removal of public linking and all new runtime OAuth operations. Every accepted callback retains its original authenticated, member-bound, attempt-bound durable outcome.

## Mechanism and current owners

The serving Worker and runner source is 7145409; current Web remains 320a6f4. The runtime in that serving image processes legacy auth-request mailbox events and uses its signed codex-auth callback port. Merged removal 768d314 deletes both the Web callback consumer and Worker egress admission. A new Worker with a warm old runner loses the callback before image drain; independently promoted Web also loses it. This is an actual deployed producer, not hypothetical future compatibility.

## Smallest correction

ReviewGPT implements retention of the existing bounded internal callback consumer, required shared validators/types, exact Worker egress admission, and only the canonical state-application portion of the former store. Public settings routes/UI, new attempt creation, mailbox producers, runtime OAuth operations and auth selection stay retired. No new schema, state owner, flag, queue, retry, fallback, or provider call.

## Verification and release

1. Focused synthetic mixed-version proof fails before the consumer restoration and succeeds after it. Cover real authority and validation failures, member/attempt binding, duplicate and superseded receipts, and the retained public-feature retirement.
2. Run affected package/Web/Worker typechecks and relevant existing tests; inspect privacy, query bounds and complete diff.
3. Final ReviewGPT on the stable pushed head, exact-head required CI, then normal merge. Land this compatibility correction before the independent base-publisher fix can unblock automatic Web promotion.
4. Canonical production deployment with all gates. Verify serving Worker/native image convergence and old producer drain using bounded read-only evidence.
5. Retain the consumer until all callback-producing old Worker/native images and in-flight old Web producers are proven drained. Remove it only through a separate reviewed change after that condition.

## Boundaries

No production data mutation, credential handling, replay, outbound message or rollback. Existing authentication and write-fence checks remain mandatory. No false acknowledgement or swallowed canonical failure. The separate base-publisher candidate owns native build configuration; preserve other worktrees and PRs.

## Implementation and parent proof

- ReviewGPT authored a consumer-only correction: internal route, the application portion of the former store, strict request contract, exact Worker transport entry, and its tests. The unused response parser and all producers remain removed.
- Five tests-only failures expose the original mechanism: four legacy phases fail exact Worker admission; the composed legacy device-code callback returns 404 instead of an accepted receipt.
- After the change, 555 focused tests pass: Worker transport/composed callback 371, route contract 6, canonical store and retirement 40, shared contract 62, existing runtime retirement 7, and settings 69.
- Full Web, Cloudflare and hosted-execution typechecks pass. Docs drift, diff/privacy inspection and complexity guard pass. Five pre-existing parser/inspector hotspots are untouched; the restored route and store maxima are 7 and 11.
- The composed proof uses real signing, nonce admission, runtime admission, request validation and canonical application; only network handoff and database I/O are synthetic. It covers wrong/stale authority, missing fences, signature/body/query tampering, replay, cross-member/auth-attempt mismatch, duplicate and superseded receipts, body bounds, and canonical failure without false success or retry.
- Parse failures retain their SyntaxError/TypeError rejection behavior while replacing private snippets/unknown-key text with fixed messages before the existing HTTP logger. Canonical write errors are outside that catch.
- The retained callback adds no work to ordinary individual/group replies or provider input. It preserves the old sequential, bounded database path: existing nonce and runtime-admission queries plus at most three single-member store operations, one pooled query at a time, no new transaction or external call.
- Internal deployment compatibility has no new member-visible capability or presentation; no changelog entry or assistant journey is required. Existing feature retirement stays intact.
- Implementation and parent candidate review are complete. Final ReviewGPT, exact-head CI, merge, actual deployment and observation remain separate delivery gates owned by the PR and sweep; this record does not claim those outcomes. Merge this correction before publisher PR #4240.
Completed: 2026-10-20
