# Resolve PR 550 merge conflicts and required CI

Status: active
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Reconcile PR #550 with the latest `origin/main` so the hosted conversation
  personalization controls remain correct, the newer base-branch runtime and
  migration contracts remain intact, GitHub reports the PR mergeable, and the
  exact pushed head passes required CI.

## Success criteria

- Latest `origin/main` is merged through ordinary Git history with no unresolved
  conflict markers or dropped base/PR behavior.
- All reproduced conflicts are resolved from code-path evidence and focused
  regression coverage passes for the web migration guard and assistant runtime;
  clean auto-merge interactions are checked for the same class of drift.
- Required security/privacy and coverage audits have no unresolved actionable
  findings; parent final review is complete.
- The resolved commit is pushed to `agent/conversation-personalization`, the PR
  has no merge conflict, required CI is green, and the manual resolution receives
  the required ReviewGPT round.

## Scope

- In scope: merge `origin/main`; resolve the conflicts in the hosted-web
  migration guard and assistant-runtime source/tests; inspect auto-merged
  overlapping files; correct merge-induced configuration drift; bind hosted
  preference writes to a web-owned canonical causal sequence resolved from the
  accepted assistant input ID; correct exact-head required-CI failures whose
  root cause is proven from logs; run the scoped completion and PR gates.
- Out of scope: unrelated personalization behavior, unrelated refactors, changes to
  `main`, deployment, or cleanup of unrelated worktrees/ledger rows.

## Constraints

- Technical constraints: preserve web as the hosted preference owner, exact
  runtime write-fence/member authority, single-causal-input semantics, current
  TypeScript/runtime config ownership, and additive migration compatibility.
- Product/process constraints: keep the existing PR branch and history, do not
  force-push, preserve unrelated checkout state, and rerun ReviewGPT because
  manual conflict resolution changes the pushed PR head.

## Risks and mitigations

1. Risk: choosing one side mechanically drops a newer base contract or a PR
   personalization requirement.
   Mitigation: inspect merge base, both stages, adjacent callers, and focused
   tests before editing; retain the union only where both behaviors are valid.
2. Risk: the merge is syntactically clean but changes runtime configuration or
   migration-guard coverage.
   Mitigation: run focused tests plus truthful diff-aware verification and inspect
   the base-to-head PR patch after the merge.
3. Risk: `origin/main` advances while the conflict resolution is being verified.
   Mitigation: certify the recorded merge parent first, then merge the newer base
   through ordinary history and rerun conflict-specific proof before pushing.
4. Risk: persisted model-writable mailbox metadata is accepted as hosted
   preference ordering authority.
   Mitigation: keep mailbox wire/source metadata unchanged, pass only the
   provider-accepted assistant input ID, and resolve its live member-owned row to
   the canonical database causal sequence inside the web transaction.
5. Risk: the same persisted numeric metadata remains authority for the local
   `murph.assistant_style` sibling path.
   Mitigation: remove that numeric fallback too and derive its canonical
   sequence from Web-owned mailbox evidence bound to the provider-accepted
   input ID, without a new state owner or reconciliation mechanism.
6. Risk: a hosted E2E observes transient invocation scheduling as if it were
   the durable outbox boundary.
   Mitigation: assert the checkpointed outbox counters, then prove restart and
   foreground-before-retry ordering through the existing end-to-end effects.

## Tasks

1. Merge the latest `origin/main` and capture the exact conflict stages.
2. Resolve each conflict from surrounding code and test intent; inspect all
   auto-merged overlaps for semantic loss.
3. Run focused and diff-aware verification, required specialist audits, and
   parent final review; address only evidence-backed findings.
4. Finish the plan through the scoped commit path, push the PR head, start
   ReviewGPT alongside CI, and confirm mergeability/green gates.
5. Trace exact-head required-CI failures, fix only proven release blockers, and
   rerun the owning hosted-local scenario before pushing a new head.

## Decisions

- Reuse the existing clean PR worktree at the exact remote head rather than
  creating duplicate checkout state.
- Use a normal merge of `origin/main`; avoid rebasing or force-pushing an active
  reviewed PR.
- Preserve the PR's per-invocation CLI bearer and runtime-owned timeout while
  accepting main's deletion of the unused preference causal-sequence loopback;
  the live causal authority remains the direct accepted-input callback.
- Keep both new migrations in lexicographic execution order.
- Main's TypeScript 7 change removed `baseUrl`; make the two PR-added
  `assistant-personalization` aliases relative instead of restoring `baseUrl`.
- Preserve mailbox wire payloads and existing message/event identifiers. Store a
  nullable server-keyed blind lookup derived from the existing assistant input
  ID for new conversation messages, never the raw ID; derive read candidates
  for every configured contact-privacy key version and fail preference writes
  closed for legacy or mixed-version rows instead of trusting a caller-supplied
  sequence or adding a fallback authority path.
- Incorporate `ffefbb210813975c42346d3cf7012b30abc6bb32` through a normal merge and
  retain both its correction-only ReviewGPT policy assertions and the PR's
  prompt-primary review assertion in the release audit.
- Store only a contact-privacy-keyed lookup of the assistant input ID on the
  mailbox row. Read every configured key version, require exactly one live
  member-owned match, and never expose the lookup through runtime projections.
- Lock the hosted member and sponsored-access rows before rechecking mutation
  eligibility so billing suspension and sponsorship removal serialize with the
  preference write.
- Preserve the conflict-resolution scope in a checkpoint commit. The requested
  rebase reproduced conflicts after PR #640 landed, so leave that conflicted
  audit worktree untouched and adopt the same `origin/main` head through a
  normal merge in the clean task worktree. This preserves reviewed history,
  avoids a force-push, and includes the shared-host verification profile.
- Keep only the sole provider-accepted assistant input id in invocation state.
  At hosted `murph.assistant_style` set/reset time, resolve its canonical causal
  sequence through the existing signed personalization Web port; Web reuses the
  keyed member-bound live-mailbox lookup and canonical access-lock order. Do not
  copy numeric authority into mailbox-import or persisted assistant-input state.
- Treat the retryable-outbox CI failure as a test observation bug: both recent
  `main` heads and the PR head checkpointed the failed nonterminal send, but the
  E2E required a transient `inFlight === false` gap and treated the workspace's
  earliest wake as the outbox retry. Assert the committed outbox counters
  instead; the existing restart and accepted-send ordering remain the behavioral
  proof.

## Verification

- Focused web migration test: 5 passed.
- Focused hosted-execution CLI bridge test: 9 passed.
- Focused assistant-runtime bridge/config/workspace selection: 265 passed, 2
  skipped.
- Owning web, assistant-runtime, and hosted-execution TypeScript 7 typechecks:
  passed after correcting the two relative path aliases.
- Truthful diff-aware lane for the four conflict files plus both config fixes:
  passed in 786 seconds. Assistant runtime passed 1,616 tests with 2 skips; web
  passed 5,043 tests with 139 skips plus lint, smoke, and production build;
  Cloudflare passed 1,787 tests.
- The first security/privacy audit found one accepted Medium issue: a persisted
  caller-controlled `sourceRef.causalSeq` could be replayed as hosted preference
  authority. The Web-owned assistant-input lookup correction, keyed-at-rest
  privacy hardening, exact-one ambiguity check, access-lock ordering, and
  regression coverage are implemented.
- Focused owner-bound correction checks passed: all five owning package
  typechecks plus 7 hosted-execution, 11 assistant-engine, 17 web, 426
  assistant-runtime, and 119 Cloudflare tests. The runner-bundle regression
  passed 28 tests.
- The exact `ffefbb...` conflict regression passed 6 tests. After the PR #640
  merge, the broader CLI release audit passed 35 tests with 1 skip.
- The keyed lookup focused Web slice passed 70 tests, its latest schema/store
  rerun passed 52 tests, and Web typecheck passed.
- The fresh security/privacy rerun after the replay-safe Web resolver found zero
  evidence-backed medium-or-higher findings. Persisted numeric authority and
  fresh-import-only transient authority were both removed.
- All verification above used the PR #640 shared-host profile with host
  concurrency unset. No process from another session was signalled or stopped.
- Latest `origin/main` `7f6c51c749a7e4b3030b38d596c10c18409bb191`
  produced one conflict in the hosted Prisma migration inventory. The resolved
  list keeps the personalization watermark migration, the base branch's group
  reaction-context migration, and the mailbox assistant-input lookup migration
  in lexicographic order.
- The resolved full PR patch has the same per-file added/deleted line counts
  against the new base as the previously green patch had against its prior
  base. Auto-merged overlapping runtime and contract files preserve both
  branches' independent behavior.
- The focused hosted Prisma migration guard passed 5 tests, and the hosted-web
  TypeScript check passed. Final conflict-marker, diff-check, and identifier
  scans passed.
- The required coverage-write audit found the existing stable-boundary proof
  sufficient, made no edits, and reported no unresolved coverage findings.
- Push/mergeability proof, CI on the new merge head, and the ReviewGPT hard-cap
  disposition remain pending.
