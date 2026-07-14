# Linq Route Authority Simplification

## Goal

Make hosted Linq replies reliable by keeping one provider-boundary authorization and dispatch claim, removing caller-supplied authority from decisions that do not use it, and ensuring post-send outcome recording cannot reject an already accepted send.

## Constraints

- Preserve the final Web-owned authorization and atomic provider dispatch claim.
- Preserve exact inbound-reply proof, active member access, home-route ownership, retry identity, and mailbox consumption stamping.
- Add no new state owner, queue, service, dependency, or compatibility layer.
- Keep old-runner request compatibility by tolerating unknown JSON fields at Web endpoints.

## Work

1. Centralize the active-member check and acquire member-home then chat locks for every non-participant send.
2. Remove ignored route-authority inputs and redundant anchored-send preflights.
3. Make route metadata optional attribution for delivery outcomes rather than a post-send authorization gate.
4. Delete the orphan egress-authority endpoint. Preserve external-thread service metadata because the group-tool boundary actively uses it to exclude non-iMessage threads.
5. Add focused regression coverage, run owner verification and required audits, then open a PR and complete ReviewGPT plus CI.

## Verification

- Focused Web Linq engagement and delivery route tests.
- Focused assistant-runtime callback/context tests and affected assistant-engine tests.
- Truthful affected-owner typechecks and diff-aware tests.
- `security-privacy-review`, `coverage-write`, `deep-review`, parent final review.
- ReviewGPT zero accepted findings and green PR checks.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
