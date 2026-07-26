# Assistant Ask latency, status, and requester identity

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Wake joined-group Assistant Ask requests and private completions immediately
  after Temporal accepts the durable mailbox signal, without waiting for the
  ordinary idle checkpoint.
- Deliver the existing fixed insufficient-group-context response for a
  `cannot_answer` result instead of allowing another model turn to invent a
  failure or expiry.
- Give the read-only group child an exact, host-supplied requester participant
  id so first-person questions can be matched to the corresponding authorized
  `read_shared` member without name or ordering guesses.

## Proven causes

- Both Assistant Ask append sites signal only the durable Temporal workflow.
  An active dirty runtime can therefore keep the new pointer behind the
  at-least-180-second idle checkpoint.
- The dirty-window prefix already admits joined-group requests, but deliberately
  excludes completions because PR 840 lacked a safe pending-input cutoff in
  causal-only passes.
- Legacy joined-group `cannot_answer` completions enter the provider-backed
  natural-continuation path even though the fixed response already exists.
- The joined-group request payload already contains the requesting membership
  id, and `read_shared` already returns that same value as `participantId`, but
  the detached child does not receive it.

## Constraints

- Temporal remains the sole durable wake authority. Direct Cloudflare ensure is
  best-effort, starts only after Temporal accepts the mailbox signal, carries no
  mailbox payload, and has no retry owner.
- Do not shorten or advance the routine idle checkpoint.
- Add no queue, scheduler, lifecycle coordinator, schema, or persisted state.
- Preserve PR 840 occurrence ordering: an Ask completion may not overtake an
  older private input.
- Keep consented-member Ask request and completion admission checkpoint-gated.
- Preserve natural private continuation for answered joined-group results and
  reviewed exact delivery for consented-member results.

## Approach

1. Extract the existing Web direct-ensure implementation from Linq onboarding
   into the hosted-execution owner and compose it with mailbox signaling in one
   reusable post-response scheduler.
2. Use that scheduler for joined-group request and private completion appends,
   always signaling Temporal first.
3. Extend the existing system-only dirty-prefix admission to legacy
   joined-group completions. Revalidate that completion shape across the whole
   pass and use the existing read-only pending-input index inspection before
   selecting the completion; incomplete evidence fails closed.
4. Route legacy joined-group `cannot_answer` through the existing exact-text
   notification path with the shared response constant. Keep answered results
   on the natural continuation path.
5. Pass the existing membership id into the read-only child as a required
   requester participant id and state the exact-match/no-guess rule in its
   confined prompt.
6. Update the current Assistant Ask and hosted-runtime protocol docs, add
   focused regressions, then run the required canonical verification and review
   gates.

## Verification

- Focused Web wake-order and Assistant Ask route tests.
- Focused Assistant Engine requester-identity prompt and confinement tests.
- Focused Assistant Runtime completion, detached-child, system-mailbox,
  workspace-phase, and dirty-window entrypoint tests.
- `pnpm test:scenario-integrity`.
- Canonical `pnpm test:diff ...` for every touched source, test, and doc path.
- `pnpm verify:acceptance`.
- Product-experience review, preliminary completion-specialists ReviewGPT,
  parent final review, then final ReviewGPT concurrent with exact-head CI.

## Deployment

- Web must deploy before Cloudflare/runtime so new direct completion wakes
  remain harmless latency hints while older runners retain checkpoint-gated
  completion handling.
- Cloudflare/runtime then enables the matching safe pre-checkpoint completion
  admission. The durable Temporal path remains compatible throughout.
