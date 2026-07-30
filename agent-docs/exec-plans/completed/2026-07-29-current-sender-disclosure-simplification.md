# Current-sender disclosure completion simplification

## Outcome

Make an authorized one-time private disclosure return to the originating group
without requiring another group message, while keeping the private answer
bounded by the exact request and final route authority.

## Scope

- Add one-time acknowledgement state for the explanatory privacy confirmation.
- Admit accepted-input Assistant Ask completions through the existing
  pre-checkpoint-safe system prefix.
- Resume the originating group assistant with the reviewed answer as bounded,
  untrusted input instead of delivering it as a standalone exact notification.
- Preserve fixed non-disclosing handling for cannot-answer outcomes.
- Keep final provider-entry permission, membership, route, expiry, and
  idempotency checks.
- Update focused tests and durable architecture, reliability, security, and
  product guidance.

## Invariants

- A private runtime never gains group delivery authority.
- The group runtime never gains private read or mutation authority.
- Only the exact authenticated current sender can authorize the one-time
  disclosure, and the authorization remains bound to the accepted group input.
- Stale membership, route, runtime, request, or expiry fails closed before
  provider entry.
- No new queue, scheduler, retry owner, callback wait, or disclosure grant is
  introduced.

## Steps

1. Rebase and apply the supplied behavioral patch on current `origin/main`.
2. Resolve context drift without dropping any requested behavior and align
   durable trust-boundary guidance.
3. Run focused direct proof and repository typechecking.
4. Complete product review, preliminary specialist ReviewGPT, parent final
   review, final ReviewGPT, and exact-head CI.

## Evidence

- Static trace proved the accepted-input completion was routed through a
  checkpoint-only admission path even though its wake was one-shot. A busy
  group runtime could therefore leave the reviewed result pending until an
  unrelated later inbound caused another checkpoint.
- Accepted-input completions now enter the existing pre-checkpoint-safe system
  prefix. A real pinned Codex App Server test proves the reviewed result runs
  through an isolated output-only group continuation, exposes no Murph group,
  shared-read, automation, or discovery tools, and queues one reply.
- The provider-shaped proof found and closed a second boundary gap: composed
  replies now preserve the disclosure expiry on the outbox intent so final
  route-authority validation cannot be bypassed.
- Focused hosted-execution, Web, assistant-engine, and assistant-runtime suites
  pass. Assistant-engine, assistant-runtime, hosted-execution, and Web package
  typechecks pass. The repository-wide typecheck is queued behind an unrelated
  shared-host acceptance run.
- The 100-intent outbox retention test exceeded its default 60-second timeout
  under shared host load and passed unchanged with a 180-second timeout.
- `pnpm docs:drift`, Prisma generation, and `git diff --check` pass.
- Product-experience review returned no findings after the provider-shaped
  answered-path proof was added.
- Preliminary specialist ReviewGPT found three prompt/confirmation edge cases:
  private-only continuation wording, ambiguous deictic private subjects, and a
  document-wide negation matcher. The remediation keeps continuation wording
  audience-neutral, fails closed when the private subject itself is ambiguous,
  and requires a substantive self-contained confirmation while accepting
  ordinary negative predicates such as "sleep is not improving."
- Parent final review removed the remaining stale private-continuation and
  exact-forward terminology. The final focused rerun passes Web 8/8,
  assistant-engine 86/86, hosted-execution 4/4, assistant-runtime 303/303, and
  the two direct provider/delivery proof cases.
- Deterministic first-provider request captures at the exact base and head,
  using identical paths and the pinned Terra code-mode target, are byte-for-byte
  identical: individual 23,356 tokens / 107,355 bytes; group 18,378 tokens /
  84,334 bytes.

Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
