# Add strength training agent skill

Status: completed
Created: 2026-06-25
Updated: 2026-06-25

## Goal

- Add the prepared `strength-training` agent skill to the repo-local `.agents/skills`
  catalog so future agents can answer strength-training planning, coaching,
  safety, and evidence questions through one small composable skill.

## Success criteria

- Install only the skill directory from the supplied packet at
  `.agents/skills/strength-training/`.
- Preserve the repo's existing skill shape: `SKILL.md`, `agents/openai.yaml`,
  and task-loaded `references/*.md`.
- Validate skill metadata, referenced files, UTF-8/path/secret hygiene, and
  repo checks.
- Open a draft PR from an isolated worktree branch.

## Scope

- In scope:
  - `.agents/skills/strength-training/**`
  - `.gitignore` allowlist entries needed to track that skill directory
  - plan/ledger lifecycle files required by the repo workflow
- Out of scope:
  - Runtime code, persisted state, reminders, protocols, app UI, or database
    changes.
  - Copying the packet-level README over the repository README.
  - Creating a new durable docs home for the packet-level eval notes.

## Constraints

- Technical constraints:
  - Keep the skill file set minimal; no extra script or runtime subsystem.
  - Do not include local paths, usernames, secrets, or raw credentials.
- Product/process constraints:
  - Keep recommendations aligned with Murph's low-burden, private-by-default,
    no-shame product posture.

## Risks and mitigations

1. Risk: importing the whole archive could overwrite root repo files.
   Mitigation: copy only the archive's installable skill directory.
2. Risk: training guidance can drift into medical, weight-cut, or body-shame
   behavior.
   Mitigation: preserve explicit safety/product boundaries and run structural
   validation plus repo checks.

## Tasks

1. Done: inspect the archive contents and decide the installed payload.
2. Done: add the skill directory.
3. Done: validate skill structure and hygiene.
4. Done: run required repo checks.
5. Next: commit through `scripts/finish-task`, push, and open a draft PR.

## Decisions

- The packet README states the installable payload is
  `.agents/skills/strength-training/`; do not copy the packet root README into
  the repository root.
- Do not add the packet root `EVALS.md` unless a durable repo home is explicitly
  chosen later; the current skill catalog does not store per-skill eval docs.
- The repo ignore policy allowlists committed `.agents/skills` entries
  explicitly; add matching allowlist lines for the new skill.

## Verification

- Commands to run:
  - skill metadata/resource validation
  - `pnpm typecheck`
  - `pnpm test:diff .agents/skills/strength-training .gitignore agent-docs/exec-plans/active/2026-06-25-strength-training-skill.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `git diff --check`
- Expected outcomes:
  - validation and repo checks pass.
- Results:
  - `quick_validate.py` passed after installing `PyYAML` into a temporary
    ignored validation venv.
  - Custom structural validation passed for frontmatter keys, skill name,
    `agents/openai.yaml`, referenced resources, and UTF-8 readability.
  - Identifier/secret and hidden-bidirectional-Unicode searches found no
    matches.
  - `git diff --check` passed.
  - `pnpm test:diff ...` passed on the no-owner repo tooling/content lane.
  - Initial `pnpm typecheck` failed in unrelated assistant package resolution
    because the fresh worktree lacked built workspace artifacts. After
    `pnpm build:test-runtime:prepared`, `pnpm typecheck` passed.
Completed: 2026-06-25
