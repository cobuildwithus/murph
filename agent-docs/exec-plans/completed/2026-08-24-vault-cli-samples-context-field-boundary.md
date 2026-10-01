# Vault CLI Sample Context Field Boundary

## Goal

Harden PR #2206 so the model-facing sample error mapper accepts only the finite existing sample-field vocabulary and never projects a future identifier-shaped context field.

## Product UX Patch

- Outcome: supported sample failures keep their indexed field guidance, while unknown context field names remain unprojected and private.
- Affected people: model callers recovering from sample JSON validation failures.
- Invariants: every existing supported field mapping remains stable; unknown field names do not reach `fieldErrors` or paths; failed batches write nothing; the shared operator-config projector remains unchanged.
- Walkthrough proof: direct mocked-core boundary tests cover the full supported field table and one private identifier-shaped future field, including an empty vault directory after failure.

## Scope

1. Replace identifier-regex acceptance in the existing mapper with its finite supported field branches.
2. Add direct regression proof for all supported fields plus private unknown-field non-projection and no write.
3. Do not add a registry to operator-config or introduce a new abstraction.
4. Keep PR #2206 Draft and do not launch ReviewGPT.

## Verification

- Focused vault-usecases and CLI source tests and affected typechecks.
- CLI package-shape verification, runner bundle budget test, and canonical runner assembly.
- `git diff --check`, deleted-API and privacy scans, clean-worktree proof, and current-base merge-tree proof.

## Completion

- Archive with `scripts/finish-task`, push the exact candidate, refresh the PR body, and leave the PR Draft.
- Report exact-head CI status without launching ReviewGPT.
Status: completed
Updated: 2026-08-24
Completed: 2026-08-24
