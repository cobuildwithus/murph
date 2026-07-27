# PR 1031 final review remediation

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

Close the accepted final ReviewGPT lifecycle and candidate-authority findings
without adding a daemon, scheduler, retry owner, or persisted product state:

- bind remote capacity to the remote verifier rather than local transport
  lifetime;
- derive admission and executed bytes from one immutable Git candidate without
  rereading the initiating checkout;
- preserve implicit no-argument `test:diff` scope in the materialized
  candidate.

## Invariants

- The initiating checkout remains the only source of the candidate, but edits
  made after snapshot capture cannot enter the remote sync.
- Ordinary untracked and known sensitive paths remain outside the candidate.
- Staged additions, tracked modifications, renames, and deletions retain their
  existing verification semantics.
- Snapshot cleanup and signal propagation stay process-owned and exact-path;
  no background cleanup service or broad process termination is introduced.
- The immutable final ReviewGPT baseline remains the original round-one head.

## Work

1. Freeze and validate one process-owned remote candidate, then invoke Crabbox
   from a base-`HEAD`, dirty materialization of that tree.
2. Give every static invocation a unique remote directory and make the remote
   verifier inherit the native macOS capacity-lock descriptor.
3. Add focused capture-race, implicit-diff, transport-loss, exact-cleanup, and
   process-lifecycle regressions.
4. Update durable docs and the PR contract, run canonical verification, close
   this plan, push, and run correction-verification round 3 with exact-head CI.

## Review evidence

- Final ReviewGPT round 1 on
  `e3ff4ff7a796b877ca79175cd560ba73ea745dcf` completed with the requested Pro
  model, valid attachment and metadata, and `ROUND_OUTCOME: FINDINGS`.
- Accepted high finding: default `SIGHUP` handling could release local/remote
  ownership while detached descendants continued on the persistent worker.
- Accepted material-UX finding: the artifact lock serialized cooperating
  producers but could not stop an editor from changing the live checkout after
  admission and during sync.

## Verification evidence

- Focused dispatcher/remote-runner regression suite: 33 tests passed, including
  a post-admission checkout race and delayed-descendant `SIGHUP` cleanup before
  same-worktree retry.
- Canonical forced-local `test:diff`: 30 files and 443 repo-tool tests passed;
  shell syntax, Node syntax, repo-tool typecheck, dependency policy, and hosted
  guards passed.
- Forced-local acceptance completed typechecking and all reported test
  assertions, but the assistant-engine coverage worker exhausted its 4 GB heap
  while an unrelated long-running web verification owned the shared host. The
  isolated package retry reproduced the host-memory failure. Exact-head CI and
  correction ReviewGPT remain the completion gates.
- After the round-2 redesign, shell and Node syntax checks passed and the
  complete repo-tool suite passed: 30 files and 445 tests.

## Round 2 retrospective decision

Round 2 required a retrospective because the remediation repeated both
round-1 mechanisms and grew config/tooling and tests substantially without
closing the actual boundaries. The findings are accepted:

- local Crabbox process-group exit does not acknowledge remote SSH verifier
  completion;
- the mutable checkout is still read between pre-capture validation and
  `git stash create`;
- recommitting the materialized candidate as a clean `HEAD` erases implicit
  `test:diff` scope.

Continue by redesigning in place:

1. Freeze one Git candidate, then derive its base, captured index, policy
   validation, logged tree proof, executed bytes, and dirty diff scope from
   that object. A mutable-checkout preflight remains only as a fail-fast
   operator guard.
2. Use a run-unique opaque static work directory and macOS `lockf` around the
   remote verifier. The remote kernel lock, not local transport lifetime, is
   the single worker-capacity authority.
3. Let the SSH runner remove only its exact run directory after its child group
   is empty.
4. Delete synthetic recommit/origin reconstruction and duplicate local
   process-group polling. Add no daemon, queue, scheduler, reconciliation, or
   persisted product state.
