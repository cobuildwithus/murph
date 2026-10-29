# Explain Linq validation failures safely

Status: completed
Created: 2026-10-27
Updated: 2026-10-27

## Goal

Outcome: distinguish provider validation hints and request media formats after a failed send.
Reaches: operator-config error context, immediate hosted failure logs, durable delivery summaries.
Proof: synthetic provider errors survive both logging owners without private values.

## Scope and decisions

- Add finite reason and image-format hints, plus bounded request URL-suffix counts.
- Reuse existing error context and logs; no raw provider prose, URLs, new storage, provider calls, or retry changes.
- Hints describe lexical matches, not confirmed root causes or actual media content types.
- Telemetry only: no member-visible behavior, prompt, or model input changes. Changelog and real-model journeys are not applicable.
- Preserve unknown classifications when prose does not match. Existing codes, trace IDs, hashes and message lengths remain available.

## Verification and completion

- Focused operator-config Linq HTTP tests and hosted callback/durable logging tests.
- Relevant package typechecks, complexity review, parent privacy and diff review.
- Required ReviewGPT and exact-head CI, then merge and hosted deployment under the existing user authorization.

## Progress

- Implemented finite reason/media hints and URL-suffix counts at the existing diagnostic owner; forwarded through both hosted log paths.
- Operator-config Linq HTTP suite: 100 tests passed.
- Focused immediate/durable hosted logging scenarios: 2 passed (408 unrelated tests skipped).
- Operator-config and assistant-runtime typechecks passed.
- Complexity guard passed with unchanged existing hotspot debt; new helpers are below the threshold. Parent review found no reason to expand unrelated dispatch logic.
- Parent diff/privacy review passed. Implementation is complete; PR owns pending independent review, exact-head CI, merge and deployment. No claim of production validation yet.
Completed: 2026-10-27
