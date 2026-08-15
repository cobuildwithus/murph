# Make hosted phone-call status and results reliable

Status: active
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Let Murph inspect the member's recent hosted phone-call state when asked.
- Let Murph stop one exact member-owned active call when explicitly requested.
- Fold terminal call outcomes into the active conversation promptly so Murph
  can explain success, failure, and required follow-up without guessing.

## Success criteria

- The existing Web-owned `HostedPhoneCall` row remains the sole product truth.
- A member-bound runtime read returns a bounded recent-call projection without
  exposing provider ids, ciphertext, raw transcripts, recordings, or call
  briefs.
- The assistant exposes a read-only phone-call status tool when the hosted
  phone-call port is available and can answer follow-up questions across turns.
- The assistant exposes exact-id termination only in a private, current
  user-authorized turn and never claims success before provider authority is
  known.
- A terminal result arriving during an active hosted invocation is imported and
  folded ahead of later conversation input or delivered immediately, rather
  than waiting behind unrelated maintenance work.
- Every meaningful terminal result, including failed and not-completed calls,
  requires a user-visible response; delivery failures remain retryable.
- Focused Web, Cloudflare, assistant-engine, assistant-runtime, contract, and
  direct active-invocation regressions pass.
- The exact pushed PR head completes the preliminary specialist and final
  ReviewGPT gates plus required CI with no unresolved accepted findings.

## Scope

- In scope: phone-call read and stop contracts, one nullable stop-intent field on
  the existing call owner, member-bound Web control routes, runtime port/tool
  exposure, terminal-result notification policy and ordering, focused tests,
  and current owner documentation.
- Out of scope: a new scheduler or queue, a new database model, raw provider
  transcript access, account-level support UI, and automatic repeat calls.

## Constraints

- Reuse the existing Web owner, signed Cloudflare control boundary, mailbox,
  runtime wake, and Retell reconciliation seams.
- Keep terminal result data bounded and treat provider/callee content as
  untrusted private data.
- Preserve foreground conversation priority while allowing the exact
  phone-call completion to join the next turn before Murph answers.
- Do not copy production feedback, identifiers, or private call content into
  code, tests, docs, review packets, or PR text.

## Risks and mitigations

1. Risk: status reads leak another member's call or private call details.
   Mitigation: bind reads to the runtime's authenticated member and return only
   the existing bounded result projection plus operational status.
2. Risk: a result and a new inbound message produce duplicate replies.
   Mitigation: retain the existing deterministic notification idempotency key
   and drain the exact result through the existing notification path before
   admitting later conversation input.
3. Risk: notification priority starves normal conversation or maintenance.
   Mitigation: prioritize only exact phone-call result completions and preserve
   existing foreground and checkpoint fences.
4. Risk: deploy skew makes a new runtime operation fail unexpectedly.
   Mitigation: deploy the additive database migration, then Web, then
   Cloudflare/runner capability exposure, and document that rollout order.

## Tasks

1. Reproduce the active-invocation result-delay path with focused tests.
2. Add the smallest member-bound recent-call read contract and Web/runtime
   adapters.
3. Expose the read-only assistant tool and update prompt/catalog guidance.
4. Expose exact-id, member-bound, idempotent termination over the existing
   provider stop authority.
5. Make meaningful terminal results mandatory and fold them into the next turn
   before later user input.
6. Run focused tests, typechecks, privacy inspection, and direct scenario proof.
7. Commit, push, open the PR, run the required ReviewGPT stages with CI, resolve
   every accepted finding, and perform the parent final review.

## Decisions

- Query existing `HostedPhoneCall` rows; add no model or duplicated status
  projection. Persist only `stopRequestedAt` on that existing owner so a stop
  requested before provider authority is known survives reconciliation.
- Return the most recent bounded calls because a later turn may not retain an
  opaque call id reliably.
- Reuse the existing exact provider `stopIfActive` authority. Return
  `start_pending` instead of claiming termination when a provider call id is
  not yet known, have reconciliation consume the durable stop intent, and use a
  typed provider disposition so already-terminal calls remain truthful and
  idempotent.
- Open the bounded three-call encrypted result window through the existing
  secure-box batch owner: one status query, one set-based envelope query, and at
  most three distinct KMS unwraps with peak concurrency three.
- Use the existing system-mailbox notification and deterministic delivery key
  as the result owner rather than inventing a second result channel.

## Verification

- Focused contract, Web, Cloudflare, assistant-engine, and assistant-runtime
  suites pass, including exact status ownership, durable stop reconciliation,
  idempotent replay, typed provider dispositions, retryable stop failure,
  malformed bridge input/output, maximum-cardinality encrypted result batching,
  mandatory result delivery, and pending-input result priority.
- Affected package and Web typechecks pass; targeted Web lint and
  `git diff --check` pass.
- Changelog fragment and archive validation pass all 45 focused cases.
- A pinned Codex App Server capture against a synthetic local provider measured
  the complete normalized first request fields (`include`, `input`,
  `parallel_tool_calls`, `text`, and `tool_choice`) with `gpt-tokenizer` 3.4.0
  `o200k_harmony`. Direct input changed from 26,682 tokens / 122,276 bytes to
  27,001 / 123,698 (+319 tokens, +1.1956%, +1,422 bytes); group input remained
  identical at 23,357 tokens / 107,744 bytes. The corrected-head total was
  recomputed from the immutable complete capture by exact replacement of the
  only two review-remediation fragments; a repository-native temporary test
  measured -25 tokens / -111 bytes and was removed.
- The one substantive preliminary `completion-specialists` ReviewGPT pass found
  four actionable findings: durable stop ownership with truthful provider stop
  disposition, encrypted-result fanout proof, signed bridge proof, and the
  `followUp` field spelling. The parent accepted and corrected all four. Its
  returned test-only bridge patch was inspected, applied, and extended with
  fail-closed cases; no ReviewGPT artifact is tracked.
- Remaining gates: commit and push the corrected head, exact-head CI, final
  ReviewGPT `ROUND_OUTCOME: PASS`, corrected-head product-experience
  revalidation, clean merge-tree proof, and plan closure.
- Direct proof: a synthetic call result arrives while one hosted invocation is
  active and newer conversation input is waiting; Murph receives the result in
  the next turn and a later status query returns the same terminal truth.
