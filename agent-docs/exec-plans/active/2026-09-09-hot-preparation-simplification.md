# Remove repeated work from hot reply preparation

Status: active
Created: 2026-09-09
Updated: 2026-09-09

## Goal

- Reduce hot hosted reply preparation by deleting repeated filesystem and HTTP work. Keep current-conversation attachment access, accepted-input validation, and provider-change handoff intact.

## Success criteria

- Historical attachment discovery no longer rereads every unrelated input on each hot turn.
- Preserve direct/group media follow-ups, frozen attachment authority, retention, live steering, and recovered work.
- Remove demonstrably redundant preparation work without a new service, dependency, or configuration surface.
- Focused tests, affected typechecks, local paired measurements, parent review, and required PR review pass.

## Scope

- In scope: input-store lookup structure; preparation owner reads; provider lifecycle facts carried by existing mailbox transport; bounded regression and performance evidence.
- Out of scope: model inference speed, Temporal scheduling redesign, deployment, unrelated workspace changes.

## Product UX

- Outcome: reduce the delay before an existing hot conversation begins answering.
- Reaches: private/group text replies, retained image/video follow-ups, live steering, and provider-change recovery.
- Proof: paired local service timing, canonical media discovery plus actual model/tool journey, and deterministic scope/retention/handoff tests. No new member controls or copy in the reply flow.

## Constraints

- Extend existing state and transport owners only when a measured bottleneck requires it. Preserve the pre-provider freeze of historical attachment evidence; do not refresh authority from model-writable files during a turn.
- Keep private vault contents and identifiers out of tracked artifacts. Use the supplied archive only through isolated local copies and numeric-only benchmark output.
- Preserve validated current input across lock waits and provider handoff. No production mutation is needed for implementation or local proof.

## Risks and mitigations

1. A faster lookup could omit prior media or trust evidence changed during a turn.
   Mitigation: inspect canonical mutation/restore owners and test historical media, conversation scope, retention, and frozen keys.
2. Removing a configuration request could miss provider changes on recovered work.
   Mitigation: prove each admission receives the fact through its existing mailbox import and retain the existing handoff owner.
3. Local timing could be mistaken for a production guarantee.
   Mitigation: label source revisions, use independent warm native processes with equal fixtures, and report excluded pipeline/network time explicitly.

## Tasks

1. Audit existing input structures, media authority, and awaited HTTP calls.
2. Implement the smallest bounded history lookup and the proven timestamp/directory deletions.
3. Remove the standalone provider configuration read through existing mailbox facts if recovered-path proof holds.
4. Run focused correctness, type, complexity, and assistant journey checks; compare real safe candidates locally.
5. Review the complete diff, document measured effects, and prepare the PR with required review and CI.

## Decisions

- Existing evidence: a 110-event retained fixture costs 110 reads and 550 lstat calls per historical lookup; independent median 154.43 ms. A diagnostic history omission isolated the cost but is not a safe implementation.
- Parallel ownership: input-store design and media integration; timestamp-only read deletion; automation directory preparation; Web/runner HTTP audit; isolated baseline and paired benchmark.
- Keep operator-default reconciliation unchanged until its differing environment inputs and readiness semantics justify a measured consolidation.
- Use a per-conversation media candidate index in the existing input-store state owner. Exact input reads remain authority; no lazy refresh of frozen evidence, process cache, database, or new dependency.
- Carry provider lifecycle facts through the existing mailbox fetch and reuse the existing handoff flag, removing the provider-entry configuration HTTP request.

## Verification

- Focused engine input/media/live-input/store tests and affected workspace typechecks.
- Relevant hosted protocol/Web/runner tests for any mailbox response contract change.
- `pnpm complexity:diff`, privacy/diff review, and repository assistant verification for current-conversation media access.
- Safe baseline/candidate Docker comparison with separate module graphs and native processes; compare accepted-input/provider content in memory without persisting prompts.
- Required PR ReviewGPT and exact-candidate CI; record results before completion.
