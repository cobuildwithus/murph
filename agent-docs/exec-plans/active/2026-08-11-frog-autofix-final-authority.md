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
5. [ ] Update owner docs, run local proof, close this plan in the scoped commit,
   merge current main, push, and obtain a final ReviewGPT PASS plus exact-head
   green CI before merge and installation.

## Verification

- Native Codex permission smoke: passed workspace read/write, denied an
  outside-root canary read, and denied outbound network.
- Focused Frog autofix suite: 30 tests passed.
- Repo-tools suite: 35 files and 555 tests passed twice, including through the
  repo-internal diff lane.
- Repo TypeScript tools, shell syntax, documentation drift, dependency policy,
  hosted architecture guards, and `git diff --check`: passed.

Status: active
Updated: 2026-08-11
