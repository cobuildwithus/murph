# PR #1705 final review

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Refactor the exact-message current-sender group-chat change so one personal
  read target is independent from its fixed result destination, then finish the
  required final review, exact-head CI, and merge boundary.

## Success criteria

- Clarification replacement remains causally monotonic and resolved pointers cannot reopen on replay.
- Group notice targeting resolves an earlier exact accepted message after later live input arrives.
- New mailbox requests write one `current_sender_personal` target and persist
  `origin_context` or same-channel `requester_direct` separately.
- One source-derived request identity admits at most one result destination;
  replay attempting to switch it conflicts without another personal read.
- Already-admitted `group_sender` and `group_sender_private` shapes retain their
  stored meaning during the bounded deployment drain.
- Durable owner docs describe natural audience inference and clarification instead of retired phrase classification.
- Focused Web, assistant-runtime, PostgreSQL, type, documentation, and privacy checks pass.
- The final ReviewGPT gate passes, required exact-head CI is green, and the PR reaches the repository-authorized merge boundary.

## Scope

- In scope: the unified current-sender target, separately pinned result
  destination, drain-only legacy readers, clarification terminology, accepted
  final-review findings, focused regression coverage, durable contract
  alignment, review/CI evidence, and PR packaging.
- Out of scope: personal-to-group content sharing, workout-specific behavior,
  unrelated messaging changes, a new delivery service, or broad provider
  transport redesign.

## Constraints

- Keep exact source identity and Web-owned sender/route authority.
- Preserve natural model intent inference and conversational clarification.
- Keep physical group completion and same-channel exact private notification as
  separate effects; only read-target identity is unified.
- Add no context registry, shared memory, queue, service, or workflow owner.
- Do not add state or retry machinery that cannot provide a real provider-level guarantee.
- Preserve the already-consumed base-update budget unless the user grants new authority.

## Tasks

1. Refactor the protocol, Web authority, runtime consumer, clarification field,
   tests, and owner docs around one target plus separate result destination.
2. Verify and commit the replacement candidate, preserving the bounded legacy
   drain and exact source/replay/route properties.
3. Run the next sensitive full-snapshot ReviewGPT round and resolve qualifying findings.
4. Require exact-head CI, prove the current-base merge result, and complete the authorized PR path.

## Verification

- Focused current-sender Web and PostgreSQL tests.
- Focused assistant local-runtime tests and package typechecks.
- Documentation drift and privacy checks.
- ReviewGPT full-snapshot PASS and required GitHub checks on the exact head.

Local replacement-candidate evidence on 2026-08-13:

- Hosted-execution current-sender contract: 8 tests passed; package typecheck passed.
- Assistant-runtime current-sender and detached execution: 22 tests passed;
  workspace entrypoint: 302 tests passed; package typecheck passed.
- Web authority and owner-doc contract: 24 tests passed; real PostgreSQL
  lifecycle: 7 tests passed; prepared Web typecheck and focused Web lint passed.
- Changelog fragment validation: 7 tests passed; agent-doc drift, diff hygiene,
  and identifier privacy scan passed.
- Exact-head ReviewGPT and required GitHub checks remain pending until the
  replacement candidate is pushed.
