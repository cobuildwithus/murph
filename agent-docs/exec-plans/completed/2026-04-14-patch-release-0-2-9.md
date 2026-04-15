# Cut patch release 0.2.9 with a truthful changelog

Status: completed
Created: 2026-04-14
Updated: 2026-04-14

## Goal

- Prepare and publish the next patch release from the current green `main` state with accurate changelog and release-notes coverage for the changes landed since `v0.2.8`.

## Success criteria

- The shared release version is bumped from `0.2.8` to `0.2.9` across all publishable packages.
- `packages/cli/CHANGELOG.md` has a clear `0.2.9` entry that summarizes the shipped changes in user-facing terms.
- `packages/cli/release-notes/v0.2.9.md` reflects the same release range and scope.
- `pnpm release:check` passes on the final tree.
- The release commit and `v0.2.9` tag are pushed to GitHub.

## Scope

- In scope:
- Release-version bumps for the publishable package set in `scripts/release-manifest.json`.
- Changelog and release-note updates for the `v0.2.8..HEAD` range.
- Release verification, release commit creation, tag creation, and push.
- Out of scope:
- Any new product or runtime fixes outside the release artifacts needed to publish this patch.

## Constraints

- Use the repo's existing monorepo release flow and keep the changelog truthful to the landed diff.
- Do not rewrite historical changelog entries or past release notes.
- Keep the release lane scoped so it does not interfere with the separate active OpenRouter lane.

## Risks and mitigations

1. Risk:
   The stock changelog generator mirrors raw commit subjects and can produce noisy release prose.
   Mitigation:
   Generate the standard artifacts, then edit only the new `0.2.9` entry and release note into a cleaner summary before verification and tagging.
2. Risk:
   Release verification can uncover drift outside the immediate version/changelog files.
   Mitigation:
   Run `pnpm release:check` on the final prepared tree before creating the release commit and tag.

## Tasks

1. Register the release lane and inspect the `v0.2.8..HEAD` range.
2. Prepare the `0.2.9` version, changelog, and release-note artifacts.
3. Run `pnpm release:check` and fix any release-artifact issues.
4. Run required completion-workflow audits for the release diff.
5. Create the scoped release commit and `v0.2.9` tag, push, and verify the release workflow.

## Decisions

- Treat the default changelog generator output as a starting point, not the final user-facing release note.

## Verification

- Commands to run:
- `pnpm release:check`
- Expected outcomes:
- Release verification passes on the final `0.2.9` tree before the tag is created and pushed.
Completed: 2026-04-14
