# Scheduled exercise reminder guidance

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Make scheduled Messages exercise cues use natural movement names, keep
  internal catalog routing labels out of visible text, and attach useful
  reviewed catalog media when available.

## Success criteria

- A production-shaped scheduled exercise reminder loads the movement owner and
  shared exercise-catalog guidance before composing the cue.
- Member-visible text contains natural exercise names and no catalog id, slug,
  source token, or path.
- The cue attaches the smallest useful returned catalog-media set without
  generating substitutes when useful reviewed media exists.
- Non-exercise reminders and check-in or review support scopes keep their
  existing behavior.

## Scope

- In scope: the engine-owned reminder execution prompt, deterministic prompt
  coverage, one synthetic production-derived real-Codex journey, and the
  existing public changelog item for this outcome.
- Out of scope: model defaults, exercise selection or safety policy, catalog
  content, delivery infrastructure, database state, and image generation.

## Constraints

- Keep this prompt-primary and add no sanitizer, state owner, retry path, or
  runtime fallback.
- Reuse the existing movement skills, shared exercise-catalog reference,
  catalog lookup, and response-media tool.
- Keep production evidence, private conversation wording, and direct
  identifiers out of repository artifacts.

## Product UX Patch

- A member receiving a scheduled movement cue gets concise, natural guidance
  and useful reviewed demonstrations rather than internal routing labels.
- A member receiving a non-exercise reminder sees no behavior change.
- A member whose selected movement has no useful catalog media keeps clear text
  and the existing catalog-gap behavior; this patch does not promise an image.

## Risks and mitigations

1. Risk: broad prompt wording could force catalog work for setup-only or
   non-instructional reminders.
   Mitigation: scope the resident rule to reminders that actually cue or teach
   an exercise or movement.
2. Risk: a saved instruction could still leak a catalog label through copied
   prose.
   Mitigation: place the privacy rule after saved instructions in the trusted
   engine overlay and assert the composed provider input.
3. Risk: the fix could look green only because the live test preloads deferred
   guidance.
   Mitigation: run a production-shaped Luna journey that starts with only the
   resident system and scheduled execution prompts and verifies the actual
   reads, tool order, media, and visible reply.

## Tasks

1. [completed] Add the smallest reminder-owned prompt correction and focused
   deterministic coverage.
2. [completed] Add or run the production-shaped Luna journey and inspect its
   visible reply and tool trace.
3. [completed] Update the existing changelog outcome with this PR provenance.
4. [completed] Run focused verification, candidate review, and the combined
   prompt, Product UX, and coverage specialist pass.
5. [completed] Close the implementation plan on the reviewed candidate. Exact-head
   CI, mergeability, merge, deployment verification, and worktree retirement
   remain external PR gates.

## Decisions

- Keep Luna's scheduled default at high reasoning. The production failure and
  local reproduction both occurred at high, so xhigh does not address the
  missing resident instruction and would add cost and latency to every cue.
- Put the correction in an engine-supplied exercise-cue overlay. That owner is
  present on the exact scheduled turn and follows the saved instructions, so
  it does not depend on the model discovering a deferred reference first.
- Accepted preliminary specialist finding: ordinary member-created reminders
  omit plan-owned support metadata and therefore use `supportKind: null`. The
  exercise-cue overlay now covers those independent automations as well as
  plan-owned reminders while excluding check-ins, reviews, weekly digests, and
  managed maintenance.

## Verification

- Focused Assistant Engine cron prompt and exercise-guidance contract proof:
  2 files passed with 214 tests passed.
- Focused real-Codex journey on `gpt-5.6-luna` with production-shaped scheduled
  prompt assembly and synthetic exercise/catalog fixtures passed at high
  reasoning. Luna read both required guidance files, looked up both exercises,
  attached both reviewed images, and produced concise identifier-free text.
- Assistant Engine package typecheck passed.
- Changelog archive proof passed 9 tests and Web typecheck passed.
- Preliminary specialist review returned one accepted high-severity Product UX
  and coverage finding: the first candidate covered only plan-owned reminders.
  The corrected ordinary reminder omits support metadata, passed the same Luna
  journey at high reasoning, and retains focused exclusions for managed
  check-ins, reviews, weekly digests, and maintenance. Parent revalidation:
  Ready.
- Preliminary ReviewGPT prompt, Product UX, and coverage lenses on the exact
  pushed candidate head; this prompt-primary patch skips the separate final
  ReviewGPT gate unless the completed diff gains another risk trigger.
- Required exact-head CI and current-base merge-tree proof.

Completed: 2026-08-28
Completed: 2026-08-28
