# activate-local-frog-autofix

Status: completed
Created: 2026-08-13
Updated: 2026-08-14

## Goal

- Publish the reviewed local Frog autofix in the canonical `cobuild-agents`
  package, vendor that exact release into Murph, then prove one genuine
  eligible Frog issue reaches its intended GitHub terminal state under the
  existing authority gates.

## Success criteria

- `cobuild-agents` owns the checked standalone package, and current Murph
  `main` contains its byte-identical runtime plus the target-local package,
  review-packaging, architecture, security, reliability, and verification
  contracts it requires.
- Focused Frog, review-packaging, shell, typecheck, documentation, privacy, and
  permission checks pass; required exact-head CI passes and all accepted
  findings from completed ReviewGPT rounds 1–4 are resolved.
- The clean primary checkout installs a two-hour LaunchAgent and reports
  `loaded=yes`.
- A foreground invocation admits one real App-authored, committed Frog issue
  and reaches either automatic merge plus issue closure or the designed
  durable human-handoff terminal state without weakening a gate.

## Scope

- In scope: canonical `cobuild-agents` source synchronization and package
  proof, target-embedded Frog runtime, package entrypoint, target-local
  contracts and proof, installation, and one observed real run.
- Out of scope: product/runtime behavior, new issue fabrication, bypassing
  branch protection, and broad cleanup of the existing Frog backlog.

## Constraints

- Technical constraints: the runtime executes only from an exact clean Murph
  primary checkout; GitHub, ReviewGPT, Codex, worktree, process, and merge
  authority remain parent-owned and fail closed.
- Product/process constraints: preserve unrelated worktrees and local changes;
  use the sanctioned worktree/PR lane; do not use admin merge or weaken
  required reviews/checks.

## Risks and mitigations

1. Risk: stale reviewed files overwrite newer Murph contracts.
   Mitigation: copy only the ten byte-identical runtime files and integrate the
   isolated contract sections into current `main` rather than replaying the old
   branch.
2. Risk: a model or stale invocation crosses an irreversible boundary.
   Mitigation: retain the reviewed exact-head, task-digest, loaded-runner,
   review-control, PR-provenance, required-check, and merge-tree fences.
3. Risk: installation or a worker process becomes ambiguous.
   Mitigation: use the reviewed native lock/process-tree ownership logic and
   stop only exact processes started by this session.

## Tasks

1. Merge the existing App-owned reconciliation PR after its required checks so
   committed issue bindings exist on `main`.
2. Synchronize the standalone canonical package, then integrate its exact
   runtime and target-local controls on a sanctioned activation branch.
3. Run focused verification, inspect the complete diff, and publish a draft PR.
4. Complete the preliminary pass and final ReviewGPT rounds 1–4 concurrently
   with CI, remediate every accepted finding, then honor the operator's explicit
   direction to stop further ReviewGPT rounds and merge without bypass.
5. Install from the exact clean primary checkout, verify permissions/status,
   run once in the foreground, and babysit the resulting issue/PR lifecycle.

## Decisions

- Reuse the existing real Frog backlog; do not create a synthetic issue.
- Treat `cobuild-agents` as the editable source owner. Activation remains a
  separate Murph target deployment because the runtime's trust fences are
  deliberately target-local; target-only corrections are incomplete until
  synchronized back to the canonical package.
- Preserve the persistent `frog/sync` branch when merging reconciliation PRs.
- Reuse the reviewed source byte-for-byte from the private source repository;
  integrate only its isolated target-local contract sections into current
  Murph docs and retain current unrelated packaging behavior.

## Scope-anomaly retrospective

Decision: continue as one indivisible target-embedded feature with one bounded
archive-evidence correction at an existing owner. The
immutable first-reviewed head is
`745591dc912bbf2ed32cfd6aa7c2acd1a4180c57`. ReviewGPT round 1 found no code
defect and required this retrospective because that head contains 6,544
authored-source additions. Review-driven runtime growth is limited to the
smallest correction at the existing archive-materialization boundary: 32
source additions and 1 source deletion after the
preliminary specialist gate proved the prompt's required Frog skill was absent
from both parent-built ReviewGPT archives.

The irreducible current requirement is one operator-controlled invocation that
takes at most one authenticated, committed Frog task through candidate
acquisition, sandboxed integration, PR publication, canonical review, required
CI, and either a narrowly authorized merge plus issue closure or a durable
human handoff. A smaller workflow ending before publication and review does not
satisfy the requested end-to-end PR delivery. Product, policy, workflow, and
ambiguous changes deliberately still stop for a human.

The considered split was activation/admission, candidate integration, and
publication/review/finalization. It was rejected for this deployment: the ten
source files are the byte-identical release already reviewed in the private
source repository, and those phases form one fail-closed authority protocol.
An earlier phase alone is either inert or exposes an irreversible boundary
without the later reconciliation phase. Splitting also creates cross-version
recovery states and repeats review of the same trust inventory. Shrinking to a
manual pre-publication handoff removes the requested delivery outcome, while a
hosted redesign adds a service, credentials, and a queue. The intended source
shape remains one feature. The post-round-1 correction adds no state owner or
workflow: it materializes the exact protected-main skill plus a digest manifest
beside the already materialized task evidence and treats that skill as a
trusted review control.

Retained concepts and owners:

- launchd owns only load and two-hour cadence; GitHub remains the queue.
- The native advisory gate and bounded process record serialize manual,
  scheduled, install, parent, and detached-worker ownership without signaling
  an ambiguous process. launchd alone cannot prove those overlaps.
- The dependency bootstrap bounds and reaps only its proven scriptless install
  process group before the parent exists; worktree helpers do not own it.
- The GitHub issue plus protected-main binding own admission and immutable task
  identity. No local task database or issue-body authority is added.
- The sanctioned deterministic worktree, branch, and GitHub PR own candidate
  bytes, publication, recovery, and durable handoff. There is no repair ledger.
- Bounded parent-only metadata retains only process identity, task digest,
  PR/body provenance, and exact-head review evidence that cannot safely live in
  public GitHub state; transient model/browser material is removed after use.
- Existing ReviewGPT owns candidate and canonical review. The parent validates
  one candidate patch and binds PASS evidence to exact candidate/runner heads.
- The native Codex profile enforces edit-only worktree access because a prompt
  prohibition cannot isolate Git, GitHub, network, credentials, browser state,
  review evidence, or other checkouts.
- Existing Git/GitHub primitives and the non-model parent own commit, push, PR,
  checks, current-base proof, ordinary protected merge, and explicit closure.
  Fresh task, provenance, scope, rename/copy, and loaded-control checks prevent
  stale evidence or product changes from gaining merge authority.
- The narrow scope classifier allows only enumerated local Frog files to merge
  unattended. Broader changes retain the ready PR as a human handoff. One
  bounded merged-but-open recovery prevents issue closure without merge proof
  and prevents re-running a completed repair.

No hosted scheduler or service, database, second queue, credential owner,
generic framework, ruleset bypass, model publication/review/merge/closure
authority, product runtime path, or compatibility lifecycle is introduced. The
large source shape is explicit trust-boundary and recovery code for this one
feature, not a generalized automation platform.

ReviewGPT round 2 found two adjacent publication-boundary gaps. The follow-up
keeps root and nested `AGENTS.md` plus the worker prompt in both loaded-runner
and trusted-review control inventories, and repeats the complete candidate
authority check after the fresh pre-push fetch. It also retains the exact SHA
only after a successful candidate push so task drift before draft creation can
replace that proven remote head with the existing neutral handoff under an
exact force-with-lease. No new durable state, service, or authority owner is
introduced; an unproven remote move still fails closed.

ReviewGPT round 3 proved that the post-push candidate lease could not depend on
invocation-local callback state. The correction removed that callback and its
publication-attempt plumbing, captured the synchronized deterministic branch
head before neutral normalization, and kept the observed-remote comparison on
an exact force-with-lease. A two-process regression now starts from the exact
pushed candidate and rejects a foreign remote move.

ReviewGPT round 4 found the remaining crash windows inside terminal handoff
normalization: a restart before or after the body restamp could otherwise
forget the pre-normalization candidate or an exact already-pushed neutral head.
The final correction keeps the candidate in the parent-owned immutable
first-reviewed-head field, recognizes exact body-bound prior neutral commits,
materializes a new neutral commit before moving the branch, and defers the body
restamp until its exact leased push succeeds. Every other remote SHA still
fails closed. The same round also found that an admitted multi-hour foreground
run was silent. Fixed, content-free admission, implementation/worker, review,
required-check, merge, and success-terminal lines now expose phase progress
without adding state or revealing issue content, provider/model detail, or
local paths. The operator explicitly ended the ReviewGPT loop after these
accepted corrections; no fifth round was run.

## Verification

- `pnpm exec vitest run scripts/frog-autofix.test.ts --config scripts/vitest.config.ts --no-coverage`
- `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts --config packages/cli/vitest.workspace.ts --no-coverage`
- `bash -n scripts/frog-autofix scripts/package-audit-context-full.sh`
- `scripts/frog-autofix verify-permissions` and `scripts/frog-autofix scan`
- Murph typecheck, docs/reference checks, privacy scan, exact-head required CI,
  canonical-source `pnpm check`, and current-base `git merge-tree --write-tree`
  must all pass. ReviewGPT evidence ends with rounds 1–4 by explicit operator
  direction; every finding from those completed rounds is accepted and fixed.

Current candidate proof:

- Canonical source: `cobuildwithus/cobuild-agents#4` merged as
  `27af99711d2995bef16535be80245e9ca2c936f4`; all ten release files and
  three target-control fixtures matched Murph byte-for-byte before merge, and
  the two native entrypoints retained executable mode.
- Canonical package: TypeScript and shell/bootstrap checks passed, and all 56
  Frog tests passed. The repository-level check then reached only unchanged
  production-watch failures; four exact failures reproduced on clean
  `cobuild-agents` main. GitHub-hosted checks could not start because the
  repository account's Actions budget was exhausted.
- Frog suite: 56 tests, including fresh protected-main instruction drift,
  two-process pre/post-neutral-restamp lease recovery, foreign remote rejection,
  and fixed content-free foreground phase output.
- Full repository-tools suite: 595 passed.
- ReviewGPT packager regression suite: 43 passed, 1 existing
  environment-dependent skip.
- Native worker permission profile: passed.
- Shell and dependency-bootstrap syntax: passed.
- Live read-only queue scan: 36 eligible issues, oldest issue 1635.
- Full typecheck: passed; the non-failing boundary reporter also repeated two
  unchanged current-main Web-test warnings outside this diff.
- Documentation drift and gardening: passed with zero issues.
- Diff-aware verifier: the affected CLI typecheck passed; the broad unchanged
  assistant-CLI bucket produced eight
  60-second scenario timeouts and was stopped after no further useful output.
  The directly affected focused suites above remain green; exact-head CI owns
  the broad PR proof.
Completed: 2026-08-13
