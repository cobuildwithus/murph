# Restore hosted memory maintenance CLI access

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Restore the existing silent hosted memory-maintenance job so it can execute
  the bundled `vault-cli` from the immutable runner application tree while
  retaining its narrow canonical-memory writes and network denial.

## Success criteria

- The memory-maintenance permission profile can read `/app` but gains no other
  new filesystem write or network authority.
- The final runner-image smoke executes populated `memory show --format json`
  under the exact memory-maintenance profile.
- Focused tests and affected typechecks pass, exact-head CI is green, and both
  required ReviewGPT gates have no unresolved accepted findings.
- Production deploy uses immediate runner convergence and reports the new
  bundle fingerprint before the incident is moved to monitoring.

## Scope

- In scope: the existing permission-profile owner, its snapshot coverage, the
  runner-image smoke profile selection, release documentation, and the public
  reliability recovery note.
- Out of scope: automation schedules, prompts, delivery behavior, retries,
  state ownership, database schema, Web runtime behavior, and member data.

## Constraints

- Technical constraints: preserve the dedicated network-denied profile and its
  current workspace write allowlist; use the real bundled CLI path and existing
  smoke owner rather than adding a test-only execution path.
- Product/process constraints: Product UX Patch; the job remains private and
  silent, no member message is introduced, and production evidence stays out
  of repository artifacts.

## Risks and mitigations

1. Risk: granting a broader runner-tree capability than required.
   Mitigation: add read-only `/app` access only to the existing profile and
   retain all workspace write and network restrictions.
2. Risk: coverage again proves a different profile from production.
   Mitigation: make the existing final-image memory command select the exact
   maintenance profile and lock that selection in the image contract test.
3. Risk: a stale warm runner keeps the broken bundle after deploy.
   Mitigation: use immediate container rollout and require managed-container
   fingerprint convergence plus the exact-profile runner smoke.

## Tasks

1. Add immutable application-tree read access to the memory-maintenance
   permission profile and update its focused unit contract.
2. Run the populated memory CLI proof under that profile in the runner smoke
   and update its source contract and deploy documentation.
3. Run focused tests, affected typechecks, and production-shaped direct proof.
4. Push an exact candidate, complete preliminary and final ReviewGPT gates with
   CI, merge, and deploy through the protected production workflow.
5. Verify convergence and recovery, update the incident, and retire the task
   worktree.

## Decisions

- Reuse the existing dedicated profile and existing runner smoke; no new
  abstraction, permission owner, scheduler, retry, or state is warranted.
- Treat the member experience as a Patch: scheduled private context maintenance
  works again without changing its timing, destination, or silent behavior.

## Product UX Patch

- Outcome: Murph can again keep relevant private saved context current during
  the existing scheduled maintenance pass.
- Reaches: an established hosted member whose silent maintenance occurrence
  needs to read or update the canonical memory document; sparse or unchanged
  memory continues to complete silently with no member delivery.
- Proof: the populated final-image memory command now runs through Codex App
  Server under the exact production maintenance profile, while focused profile
  coverage preserves its narrow writes and network denial.

## Product UX Walkthrough

- Established history: the scheduled occurrence receives its existing bounded
  conversation evidence, reads the populated canonical memory document through
  the bundled CLI, and may update only that document. No audience or delivery
  is introduced.
- Sparse or unchanged history: the existing no-op/skip path remains unchanged
  and sends no message.
- Failure and recovery: a missing or unreadable CLI remains a visible failed
  tool result; the corrected immutable-tree read makes the normal command
  reachable without widening workspace writes or network authority.
- Result: Ready. This narrow Patch changes only CLI reachability, and the exact
  production-shaped final-image proof is enforced by the existing release
  smoke before deployment.

## Verification

- Commands to run: focused hosted-execution and Cloudflare contract tests,
  affected package/app typechecks, `git diff --check`, the final-image runner
  smoke on native AMD64 CI, exact-head required CI, and protected deploy smoke.
- Expected outcomes: the profile snapshot includes read-only `/app`, the
  memory proof selects `murph-member-memory-maintenance`, the populated command
  succeeds in the bundled runner, and the deployed smoke reports the expected
  bundle fingerprint.
- Local results: hosted-execution profile tests passed 4/4; Cloudflare container
  contract tests passed 11/11; changelog tests passed 57/57; hosted-execution,
  Cloudflare, and Web typechecks passed; `git diff --check` passed.
- Native AMD64 result: the first exact-profile image run proved `/app` access
  advanced the command to sandbox startup, then exposed a second exit-101
  boundary before the Node CLI returned. Raw memory-command output remains
  suppressed; the smoke now emits only fixed boolean error classifications so
  the next exact run can identify that sandbox boundary without vault content.
