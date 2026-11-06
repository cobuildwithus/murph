# Complete meal repair operator verification and admission handling

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Goal

Make the one-time meal repair operator runner verify actual API names, expose count-only batch progress, and continue past members whose initial admission is explicitly denied.

## Success criteria

- A valid projection can precede a read-only final receipt without causing a false wait.
- A newer timestamp cannot hide stale invalid names beyond the explicit skip allowance.
- Initial member consent/access denials are counted only after current Ops authority is rechecked.
- Lost operator authority, unexpected errors, and denials after partial work stop the pass.
- Logs contain counts only; existing canonical mutation, consent and model paths stay unchanged.

## Scope

Local operator runner, its focused tests, and public-safe friction evidence. No runtime protocol, model prompt, server authorization, canonical writer, or deployment configuration changes.

## Risks and mitigations

- Member and operator access failures share a code: recheck the authenticated Ops reader before attributing a denial to the target member.
- A denial after completed batches could lose partial totals: keep that case terminal and resumable.
- Projection timestamps do not encode whether a final batch wrote anything: use the existing post-projection receipt and inspect actual API names, preserving explicit invalid/conflict skips.

## Tasks

- [x] Reproduce the timestamp/content mismatch with synthetic API responses.
- [x] Add count-only batch output and bounded member-denial handling.
- [x] Prove authority failures and partial work remain terminal.
- [x] Run focused tests, Web typecheck, complexity guard, and parent review.
- [ ] Complete exact-head review and CI through the follow-up PR.

## Decisions

Reuse the existing Ops action and status APIs. A member denial never changes consent or access, never sends a message, and never supplies alternate credentials. Keep one sequential member runner and its existing durable batch identities.

## Verification

- Focused runner and Ops tests: 15 passed.
- Web typecheck: passed.
- Complexity guard: passed; maximum changed-function complexity 15, no hotspots above 20.
- Synthetic coverage includes valid older snapshots, stale newer snapshots, member denials, lost Ops access, unexpected errors, and partial-member denial.
- The PR owns final ReviewGPT and exact-head CI evidence. The original repair's model journey and deployed canonical writer are unchanged.
Completed: 2026-11-02
