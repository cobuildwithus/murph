# Frog Autofix Final Authority Corrections

## Goal

Resolve final ReviewGPT round 3 without weakening the user policy: enforce a
real workspace-only Codex command boundary, reuse Murph's canonical review
packager and review state, make old and new rename paths authoritative, and
advance beyond completed human handoffs while merging only proven local agent
tooling automatically.

## Accepted findings

1. Replace legacy workspace-write with a Codex permission profile that denies
   filesystem reads by default, allows only minimal runtime files plus the
   issue worktree, and uses an invocation-local Codex home with no saved
   transcript. Never install or execute package-manager configuration after
   model access.
2. Delete the custom review archive/round implementation. Run the canonical
   preliminary and final packager from a parent-only exact-head checkout whose
   executable control files match trusted `main`; publish the immutable
   baseline in the same PR body mutation and hand findings to a human.
3. Disable rename detection for every merge-authority and loaded-runner path
   inventory, and cover real rename fixtures.
4. Treat an exact parent-marked review or product-runtime handoff as completed
   queue work so later eligible issues can run without closing the handed-off
   issue.

## Tasks

1. [x] Implement and test the permission-profile worker boundary and safe
   pre-model dependency lifecycle.
2. [x] Replace custom ReviewGPT packaging/remediation with the canonical
   preliminary/final pass and interruption-stable PR metadata.
3. [x] Add rename-safe path enumeration and real Git coverage.
4. [x] Add bounded handoff-aware queue selection and starvation coverage.
5. [x] Record the round-four requirement-level scope retrospective before any
   further tactical remediation.
6. [x] Keep every executable and instructional ReviewGPT control on the
   trusted-parent side of autonomous review, and map every canonical terminal
   outcome to a durable parent-owned disposition.
7. [x] Disclose the required friction entries' public publication and
   reconciliation effect in the PR intent contract.
8. [ ] Update owner docs, run local proof, close this plan in the scoped commit,
   push, and obtain a final ReviewGPT PASS plus exact-head green CI before merge
   and installation.

## Round-four scope retrospective

### Trigger and requirement

The original requirement is one optional local operator loop: every two hours,
admit at most one trusted Frog issue, obtain an implementation proposal, let a
restricted Codex session prepare a fix, open a normal PR, and automatically
merge only local agent/Codex workflow changes after independent review and CI.
Possible product-runtime changes and review findings must remain human-owned.

The immutable first-reviewed head added 1,770 authored-source lines. The
round-four candidate adds 3,755, an increase of 1,985 lines (112 percent), and
therefore crosses the 2,000-line retrospective threshold, the 3,000-line
strong-red-flag threshold, the 500-line remediation threshold, and the
round-three mechanism-repeat threshold.

### Growth and ownership inventory

The review-driven growth is the authority proof for that same loop, not a
second product feature:

- Parent-owned patch/PR validation, deterministic merge/close finalization,
  and the absolute command-deadline adapter became three narrow modules.
- The existing pure guard library gained exact model evidence, native Codex
  permission construction, process-group supervision, environment isolation,
  and rename/copy-safe scope classification.
- The existing recovery classifier gained exact branch/PR identity and safe
  interrupted-work handling.
- The existing orchestrator gained live permission canaries, parent-only
  ReviewGPT packaging, exact-head CI/merge checks, durable PR-body review state,
  and bounded handoff-aware discovery.

No second scheduler, queue, service, database, credential, hosted runtime, or
model-owned authority was added. The corrections removed the custom review
archive/round protocol, model-owned Git/GitHub/merge/close effects, historical
close-only recovery, post-model dependency installation, autonomous
review-finding remediation, and the legacy `codex-workers --sandbox`
composition.

Two mechanisms repeated and must be corrected inside their existing owners:
the canonical review trust inventory omitted candidate-owned prompt presets,
and the handoff terminal parser omitted the canonical retrospective result.
Neither correction justifies a new owner or state machine.

### Decision

Continue this PR as one indivisible authority chain, with no new architectural
owner. Deleting automatic merge would fail the explicit outcome; reverting the
review-driven boundaries would restore proven credential, process, recovery,
and self-approval failures; mechanically splitting the same parent authority
chain across PRs would not reduce shipped complexity and would create an
incomplete intermediate mode; moving it to a hosted service would add a
credentialed runtime and queue. The smallest correction is to extend the
existing trusted-control inventory to the whole ReviewGPT preset directory and
route the existing canonical retrospective terminal through the existing
review-findings handoff. The two required Frog entries remain in scope because
the repository workflow requires committing friction encountered while doing
this task; their public issue/reconciliation effect must be explicit in the PR
contract.

## Verification

- Native Codex permission smoke: passed workspace read/write, denied an
  outside-root canary read, and denied outbound network.
- Focused Frog autofix suite: 31 tests passed.
- Repo-tools suite: 35 files and 556 tests passed twice, including through the
  repo-internal diff lane.
- Repo TypeScript tools, shell syntax, documentation drift, dependency policy,
  hosted architecture guards, and `git diff --check`: passed.
- Final round four required the retrospective above and identified the prompt
  authority and terminal-outcome gaps; the next exact-head round remains
  required before merge.

Status: active
Updated: 2026-08-11
