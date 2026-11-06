# Remove obsolete PR prose guards

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Goal and invariant

Remove the two owner-retired PR description guards and their obsolete prose.
Keep the PR evidence job identity, remaining guards, shared Markdown helpers,
and executable cyclomatic-complexity CI gate unchanged.

## Scope and decisions

- Delete both validators, their tests, and the unused complexity declaration.
- Remove their workflow steps, template sections, generated Frog prose, test
  assertions, and current documentation references. Preserve historical plans.
- Existing workflows own validation; no runtime behavior or new state is needed.
- No ReviewGPT or merge, as explicitly requested. No member-visible changelog.
- The docs guard requires this plan because the bounded deletion spans 13 files.

## Completed implementation and proof

- Remaining PR-evidence and CI-policy Node suites: 65 tests passed.
- Frog workflow guards: 14 tests passed.
- Repo-tools TypeScript check passed after deleting the obsolete declaration.
- Complexity diff passed: two deleted source files, no remaining hotspots.
- Docs gardening passed with zero issues. Docs drift initially required an index
  update and then this plan; the rerun passed.
- Reference sweep found no remaining live references to retired checks.
- Direct comparison confirmed all remaining PR steps and the job name are
  unchanged, as are host-support complexity CI and the shared Markdown helper.

## Completion

Local verification, reference checks, and parent diff/privacy review passed.
Archive this implementation record with the scoped commit. PR publication and
required exact-head CI remain owned by the same session; do not merge.
Completed: 2026-11-04
