# Teach Murph about expanded connected wearable data

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Close the smallest remaining awareness gaps that prevent Murph from using the
  connected wearable facts shipped in PR #1698 through existing normalized
  `vault-cli` reads.

## Success criteria

- ReviewGPT audits the current prompt, relevant health-domain skills, normalized
  wearable commands, and the exact PR #1698 importer/query behavior.
- Murph is told which existing CLI read family answers each supported question
  without naming internal provider resources or promising unavailable samples.
- At most a few existing prompt/skill owners change; no new command, skill,
  state owner, provider fetch, or persistence path is added.
- Focused prompt/skill tests and assistant-engine typecheck pass, followed by
  the required exact-head ReviewGPT specialist pass and green PR CI.

## Scope

- In scope: assistant system-prompt capability guidance, up to a few existing
  wearable-aware health skills, focused tests, and a concise public changelog
  item if the final behavior is meaningfully member-visible.
- Out of scope: new CLI commands, new skills, importer/query/provider changes,
  raw ECG waveform or workout-point access, new persistence, and broad health
  coaching rewrites.

## Constraints

- Technical constraints: use only normalized canonical records and the shipped
  `vault-cli wearables ...` or lossless `measurement entry list` surfaces;
  missing data remains unavailable rather than zero; dense source samples stay
  unavailable by design.
- Product/process constraints: keep the always-on prompt compact, route
  interpretation to existing domain skills, preserve symptom-first safety, and
  use the prompt-primary worktree/PR lane.

## Risks and mitigations

1. Risk: a prompt inventory implies every connected source supplies every
   signal.
   Mitigation: name normalized data families and require returned coverage and
   provenance before claiming availability.
2. Risk: ECG, alert, respiratory, or cardiovascular summaries are treated as
   diagnoses or reassurance.
   Mitigation: keep them as supporting observations and preserve symptom-first
   care routing in the owning skill.
3. Risk: duplicated command instructions bloat the prompt and skills.
   Mitigation: keep the global capability map categorical and add exact reads
   only to domain owners whose answers materially depend on them.

## Tasks

1. Map PR #1698 normalized outputs to current `vault-cli` reads and existing
   assistant prompt/skill owners.
2. Ask ReviewGPT to identify only high-value current gaps and return a scoped
   patch when changes are justified.
3. Implement accepted prompt/skill changes and focused behavioral coverage.
4. Run focused verification, push a PR candidate, complete the required
   specialist ReviewGPT pass, resolve findings, and require green exact-head CI.
5. Perform the parent final review, archive this plan, and prove a clean
   current-base merge.

## Decisions

- PR #1698 already ships an initial awareness layer in the system prompt plus
  `daily-activity` and `body-composition`; this task audits and closes remaining
  gaps rather than duplicating that work.
- Teach normalized product concepts and canonical CLI reads, not Junction
  resource names or provider-specific fetch mechanics.
- ReviewGPT found two actionable gaps: `insulin_injection` is stored as a
  device-sourced `intervention_session`, outside measurement-entry reads, and
  `calories_basal` was absent from the daily-activity metric list. Its other
  proposed categories were already covered by the shipped prompt and skills.
- Keep the correction in the always-on capability map plus the existing
  `daily-activity` skill. Do not add a new skill or CLI surface.
- The first ReviewGPT response was substantive but its wrapper result was
  invalid because model confirmation was unavailable. The patch artifact was
  checksum-verified, fully inspected, and only its two evidence-backed findings
  were implemented manually.
- This changes member-visible answer coverage, so publish one small changelog
  fragment rather than reopening the broader sync announcement.

## Verification

- Commands to run: focused assistant prompt/skill Vitest files, relevant CLI
  contract tests only if command claims change, assistant-engine typecheck,
  `git diff --check`, exact-head GitHub checks, and current-base merge-tree.
- Expected outcomes: Murph can discover and use the newly available normalized
  data without asking the member to restate device facts or implying access to
  raw ECG/workout samples.
- Focused prompt, skill, and prompt-budget suite: 101 passed, 6 intentional
  skips.
- Production Codex App Server scenarios: basal-calorie and insulin queries plus
  raw-stream/intake boundaries passed through prompt, skill, exact CLI command,
  returned evidence, and final answer.
- Assistant Engine typecheck passed.
- The generic skill validator could not run because its optional Python YAML
  dependency is absent; repository-native skill asset and frontmatter tests are
  the fallback proof.
