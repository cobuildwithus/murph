# Social media fast Health Commons research

Status: active
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Start a Health Commons research workflow for a bounded social media fast protocol.
- Success means a dedicated local research workspace exists, the charter prompt scopes 24-hour, 72-hour, and 7-day variants clearly, and the first charter seam is ready to send through the research runner.

## Success criteria

- `output-packages/research/social-media-fast` exists with a charter-first workflow scaffold.
- The charter prompt treats 24-hour, 72-hour, and 7-day social media abstinence as candidate variants and asks whether they should stay under one protocol or split.
- The charter keeps this separate from Digital Sunset, generic screen-time reduction, full smartphone abstinence, app-blocker tooling, notification-only changes, dopamine-detox framing, productivity challenges, and clinician-led/problematic-use treatment unless evidence gives a concrete reason to merge.
- Safety, burden, substitution, work/care exceptions, withdrawal-like discomfort, anxiety, loneliness, and life-fit are first-class research dimensions.
- No Health Commons family, protocol, source, artifact, or generated catalog files are edited until the research package is evidence-ready.

## Scope

- In scope:
  - `output-packages/research/social-media-fast/**`
  - this execution plan
  - the shared coordination-ledger row for this research lane
- Out of scope:
  - Landing live Health Commons content pages.
  - Editing the already-landed Digital Sunset protocol.
  - Creating product UI or runtime experiment-onboarding behavior.

## Constraints

- Preserve unrelated dirty work and active research harvests in the shared checkout.
- Keep generated research files path-relative and do not hardcode local absolute paths.
- Keep claims conservative and source-bound.
- Do not moralize social media, discipline, dopamine, productivity, or self-control.
- Do not expose local identifiers, secrets, or personal data in generated files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: The protocol collapses direct social media abstinence evidence with broader digital detox or screen-time reduction.
   Mitigation: Require directness labels and keep broader device or screen interventions adjacent unless separable.
2. Risk: Evidence may be mostly student, adolescent, workplace, or problematic-use treatment evidence.
   Mitigation: Require population-mismatch labels before using any source for Murph self-experiment claims.
3. Risk: The intervention is framed as productivity or moral self-control instead of a low-burden experiment.
   Mitigation: Require burden, social cost, communication needs, and off-ramps in the charter and later synthesis.

## Tasks

1. Register the task in the coordination ledger. Done.
2. Scaffold the `social-media-fast` research workspace. Done.
3. Tailor the charter prompt for 24-hour, 72-hour, and 7-day variants. Done.
4. Verify workspace setup and prompt hygiene. Done.
5. Send `01-charter` on a managed research lane. Blocked.
6. Harvest `01-charter` and materialize post-charter seams if coherent. Pending.

## Current state

- Workspace: `output-packages/research/social-media-fast`
- Provisional family: `social-media-abstinence`
- Provisional starter protocol: `social-media-fast`
- Charter seam: `01-charter`
- Charter status: scaffolded and locally verified. Send was attempted, but no ChatGPT thread URL was recorded.
- Send blocker: the first attempt failed because the package helper did not print a recognized `ZIP:` line; the helper was fixed. The second attempt launched the managed Chrome profile and then produced no thread URL or new log lines for several minutes, so the local automation process was stopped rather than left running.

## Verification

- Completed:
  - Direct readback of `workflow.json`, `README.md`, `prompts/01-charter.md`, and command wrappers passed.
  - `workflow.json` parsed successfully.
  - `bash -n` passed for generated charter command wrappers and package helper.
  - `git diff --check -- agent-docs/exec-plans/active/2026-05-06-social-media-fast-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
  - Local identifier privacy scan over the new research workspace, plan, and ledger row passed.
  - `pnpm exec cobuild-review-gpt --help` passed, confirming the runner binary is installed.
  - `output-packages/research/social-media-fast/commands/01-charter.send.sh` was attempted twice; no `state/chat-urls/01-charter.txt` was produced.
