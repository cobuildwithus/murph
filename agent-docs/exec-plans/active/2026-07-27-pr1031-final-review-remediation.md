# PR 1031 final review remediation

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

Close the two accepted final ReviewGPT lifecycle findings without adding a
daemon, scheduler, retry owner, or persisted product state:

- forward `SIGHUP` through each existing detached process owner and retain
  ownership until its exact child group exits;
- sync every explicit remote verification from one immutable, Git-backed
  candidate snapshot instead of rereading the initiating checkout.

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

1. Add a process-owned remote candidate snapshot and invoke Crabbox from it.
2. Forward `SIGHUP` through dispatcher and remote verification child groups.
3. Add focused races and process-lifecycle regressions.
4. Update durable docs and the PR contract, run canonical verification, close
   this plan, push, and run correction-verification round 2 with exact-head CI.

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
