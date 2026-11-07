# Bounded canary reply observation diagnostics

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal

Distinguish why the existing production canary reply observer reports unavailable without exposing messages, recipients, identifiers, credentials, or provider errors. This is diagnostic-only; the underlying production cause remains unproved.

## Scope and constraints

Only the existing canary reply-wait owner, its final failure diagnostic, focused synthetic tests, and necessary owner documentation. Preserve send/wait ordering, reply matching, deadlines, assertion gates, cleanup, return values, retries, and all production behavior. No new messages, live canary dispatches, provider reads, workflow triggers, dependencies, product state, or runtime deployment.

Use fixed enums and saturating small counters on the existing failure line. Never log raw errors, content, sender/space identifiers, timestamps, or rejected message excerpts. Keep one completion owner and use ReviewGPT for source/test authoring.

## Evidence and decisions

A local synthetic reproduction of the current exported wait helper establishes that an ended iterator, an iterator rejection, and a quiet timeout all become the same reply-unavailable diagnostic. Existing delivery facts cannot prove which stream branch happened. Current open PRs and recent canary changes do not implement this observation; mailbox timing PR4177 is a separate owner and file set.

## Tasks

1. Have ReviewGPT implement the smallest bounded diagnostic and regression tests.
2. Prove missing diagnostics on base, then preserved successful matching and failed outcomes on the patch; inspect privacy, runtime cost and full diff.
3. Run focused tests, applicable typecheck, complexity and docs checks; publish Draft then Ready and start exact-head final ReviewGPT alongside required CI.
4. Close plan, retain source-identical review lineage, satisfy exact-head checks, then merge under existing telemetry-only authority.
5. Observe the existing scheduled/admitted canary read-only. Do not dispatch a live run. This observer-only change does not require a Worker/runner image or reset the runtime observation deadline.

## Risks and mitigations

- Error details could leak provider data: only closed categories and bounded counts are allowed, including hostile thrown values.
- Instrumentation could affect matching or timeouts: retain predicate order and existing Promise/cleanup behavior, with composed tests for accepted replies, rejected messages, stream end/rejection and timeout.
- A diagnostic could be mistaken for a fix: retain unresolved original delivery/observer question until exact downstream evidence exists.

## Verification

- Baseline synthetic comparison: ended, rejected and quiet timeout all report reply-unavailable.
- Focused regression tests must fail for absent diagnostics on base and pass on candidate.
- No member-visible semantics or model/provider input changed; no changelog or real model journey applies.
- ReviewGPT authored the source, focused tests and owner documentation; parent inspected the full patch, unchanged predicate order, private error normalization, two bounded per-wait counters, unchanged deadline/send/cleanup and existing final failure line.
- Parent verification: 11 expected missing-diagnostic failures against original source and 44 preserved cases; candidate 55/55 focused tests pass. Complexity guard passes with debt 0 and maximum 16 unchanged; documentation drift passes. Web typecheck passes.
- Exact-metadata patch download first returned an unrelated image; same-turn export and exact retry retrieved the patch. Recorded public-safe Frog entry; no duplicate authoring request.
- Final ReviewGPT round 1 PASS on `28028a830c5cda193459c56bec13266ca6ffffe2`, full snapshot/sensitive, GPT-6 Pro selected and sent, 184.908-second observed response-wait lower bound. Exact request, attachment, completed marker and metadata verified; zero findings. Reviewer traced both catches, final CLI output, existing workflow consumer and focused tests.
- Parent final review accepts the diagnostics and preserves all original guards and outcomes. This closure changes plan/index only; source, tests, configuration and owner guidance remain identical to the reviewed head.
- Required CI on the final pushed closure head is a remaining merge gate; no live canary dispatch or runtime deployment is authorized by this proof. Natural observation remains with the production sweep. The original missing-reply cause remains unresolved.
Completed: 2026-10-18
