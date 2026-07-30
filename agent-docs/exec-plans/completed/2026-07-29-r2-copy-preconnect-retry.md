# Bound R2 CopyObject retries to proven pre-connect timeouts

Status: completed
Created: 2026-07-29
Updated: 2026-07-30

## Goal

- Let the existing production-read, isolated-destination R2 rehearsal survive
  Undici's proven pre-request connection timeout without broadening retries for
  any CopyObject outcome that may have reached R2.

## Success criteria

- Only the exact built-in-fetch `TypeError` whose direct cause has
  `code === "UND_ERR_CONNECT_TIMEOUT"` receives one bounded retry.
- HTTP failures, generic transport errors, and mid-request socket errors remain
  one-shot and fail closed.
- Focused Cloudflare tests and typecheck pass, ReviewGPT returns no unresolved
  accepted finding, and exact-head CI is green.
- The reviewed copier is ready for a fresh isolated-destination rehearsal
  without any production R2 write, delete, routing, deployment, or downtime.

## Scope

- In scope: the online CopyObject request boundary, focused regression tests,
  and ReviewGPT/CI proof needed before the production-read rehearsal.
- Out of scope: changing production Worker configuration, production R2
  mutation, destination cleanup, cutover, the live rehearsal itself, or
  account-deletion restoration before the rehearsal reaches a safe terminal
  result.

## Constraints

- Technical constraints: preserve create-only destination semantics and keep
  retry classification narrower than generic network or HTTP failures.
- Product/process constraints: use a dedicated worktree/PR, keep secrets local,
  and write only to a newly created staging-only destination bucket.

## Risks and mitigations

1. Risk: retrying an ambiguous write could duplicate or misclassify a copy.
   Mitigation: accept only Undici's exact pre-connect error shape; all other
   failures remain single-attempt.
2. Risk: a partial rehearsal destination could be mistaken for a fresh target.
   Mitigation: create a new literal bucket and strongly verify it is empty
   before running.

## Tasks

1. Add the narrowly classified, one-retry CopyObject wrapper.
2. Add focused success and fail-closed regression coverage.
3. Run focused verification, preliminary specialists, parent review, final
   ReviewGPT, and exact-head CI.
4. Land the fix, then hand off to the separate live rehearsal operation against
   a fresh bucket.

## Decisions

- Do not add a dependency or change the global Undici dispatcher.
- Do not retry `UND_ERR_SOCKET`, generic `fetch failed`, HTTP 429/5xx, or any
  other CopyObject failure.
- Disable automatic redirects on every signed R2 fetch. ReviewGPT identified
  that a redirect followed by a connect timeout could otherwise make an
  already-started fetch operation look pre-request.
- Consume each terminal CopyObject response body before classification so the
  long-running copier releases/reuses Undici connections. Body consumption is
  deliberately outside the retry wrapper, so a post-response body failure
  remains one-shot.

## Verification

- Commands to run: focused Vitest, Cloudflare typecheck, `git diff --check`,
  ReviewGPT preliminary/final gates, and required PR CI.
- Expected outcomes: exact pre-connect timeout retries once; all ambiguous
  failures make one PUT attempt; no production resource is mutated.
- Current focused result: 37 online-copy tests and Cloudflare typecheck pass
  after the redirect and response-drain remediations.
Completed: 2026-07-30
