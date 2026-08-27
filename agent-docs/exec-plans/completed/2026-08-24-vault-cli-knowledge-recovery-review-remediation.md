# Vault CLI knowledge recovery review remediation

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Make registered Vault CLI failures give assistants fail-closed, private,
  non-duplicating recovery instructions for missing or invalid Commons protocol
  artifacts and ambiguous memory writes.

## Success criteria

- Commons protocol `list`, `show`, and `explore` stop discovery, onboarding,
  planning, and start when required artifacts are unavailable or invalid.
- The Commons envelope reveals no protocol fallback data, lookup value,
  malformed artifact content, or filesystem path.
- The registered memory CLI projects the existing post-write read-back omission
  as terminal `memory_persistence_invalid` and directs inspection before another
  write without retrying the mutation.
- Focused CLI tests and CLI typecheck pass; any production source-size movement
  is checked against the hosted runner bundle budget.

## Scope

- In scope: the existing Commons protocol reader error projection and registered
  CLI coverage for Commons and memory recovery envelopes.
- Out of scope: optional Commons knowledge-search degradation, new repair
  services or state, protocol generation, and memory production refactoring.

## Constraints

- Technical constraints: keep the current owner boundaries and use one shared
  fail-closed Commons hint; do not add retries or reveal paths/values.
- Product/process constraints: implement only the two accepted preliminary
  findings, preserve the immutable ReviewGPT baseline, and do not push or alter
  PR metadata in this task.

## Risks and mitigations

1. Risk: a recovery hint could imply that protocol-dependent work may continue.
   Mitigation: assert the complete fail-closed rule across all three registered
   protocol commands and both artifact failure classes.
2. Risk: memory recovery could cause a duplicate mutation after an ambiguous
   write.
   Mitigation: inject one post-write omission fault and prove one invocation,
   terminal retryability, inspection guidance, and one persisted record.

## Tasks

1. Replace the conditional Commons protocol hints with one fail-closed rule.
2. Extend registered Commons CLI error-envelope coverage across list, show, and
   explore for unavailable and invalid artifacts.
3. Add registered memory CLI coverage for the existing post-write persistence
   error projection.
4. Run focused verification, inspect privacy and diff shape, and commit through
   the plan-closing workflow.

## Decisions

- Keep optional Commons knowledge search fail-open because it is explicitly
  non-blocking and is not protocol onboarding or execution authority.
- Exercise memory ambiguity with a test-only wrapper around the existing Core
  owner; production mapping already satisfies the accepted finding.
- Ratchet the hosted Vault CLI total-size budget from 9,482,512 B to the exact
  9,482,492 B post-remediation measurement; entry and static-startup topology
  are unchanged.

## Verification

- Commands to run: focused Commons and memory CLI tests, CLI typecheck,
  `git diff --check`, a changed-diff privacy scan, and hosted bundle measurement
  if production source bytes change.
- Expected outcomes: all focused checks pass, error envelopes contain the
  required recovery metadata and no private markers, and the final diff remains
  limited to the plan, one existing source boundary, registered CLI tests, and
  the measured bundle-budget lock.

## Verification results

- Registered Commons and memory CLI suites: 2 files, 27 tests passed.
- Vault CLI bundle boundary suite: 1 file, 14 tests passed.
- CLI and Cloudflare TypeScript checks passed.
- Production runner assembly measured the Vault CLI at 9,482,492 B total,
  805 B entry, and 27,716 B static startup; all parity probes passed.
Completed: 2026-08-24
