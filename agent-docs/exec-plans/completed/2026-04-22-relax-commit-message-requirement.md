# Relax commit-message requirement in repo helpers

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Relax the repo helper requirement that commit messages must follow Conventional Commits so plan-bearing `scripts/finish-task` and direct `scripts/committer` flows accept ordinary descriptive messages without a separate bypass flag.

## Success criteria

- The actual commit-helper enforcement path no longer rejects non-Conventional commit messages by default.
- Plan-bearing `scripts/finish-task` still closes plans and creates scoped commits successfully.
- Durable workflow docs that describe commit-helper behavior stay aligned with the new behavior.
- Verification for this low-risk tooling change is truthful and green.

## Scope

- In scope:
- Repo commit-helper enforcement and any directly coupled docs
- Plan/ledger artifacts for this lane
- Out of scope:
- Broader release, tagging, or changelog policy
- Git hooks outside the helper path unless they are the direct enforcement point

## Constraints

- Keep the change narrow and mechanical.
- Preserve all unrelated dirty-tree edits.
- Prefer changing the actual enforcement seam over documenting a policy mismatch.

## Risks and mitigations

1. Risk: Relaxing too broadly could change unrelated release tooling expectations.
   Mitigation: Inspect the concrete enforcement point first and patch the smallest seam that affects repo helper commits.
2. Risk: Durable docs could keep claiming Conventional Commits are required even after the helper is relaxed.
   Mitigation: Update any touched durable workflow docs in the same change.

## Tasks

1. Register this lane in the coordination ledger.
2. Inspect the repo committer/finish-task enforcement path and current docs.
3. Patch the minimal helper/docs needed to relax the requirement.
4. Run low-risk tooling verification plus a local final review.
5. Close the plan and commit with the scoped helper flow.

## Verification

- `pnpm typecheck`
- Direct checks for touched helper files such as `bash -n` or focused readback
- `git diff --check`
Completed: 2026-04-22
