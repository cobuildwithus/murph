# Require Murph runtime system prompt impact in PR bodies

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make every PR describe the quantitative system-prompt impact on individual
  and group Murph runtimes independently.

## Success criteria

- The pull-request template contains a required runtime system-prompt section.
- The section reports base, head, absolute delta, and percentage change for
  both individual and group Murph.
- The completion-workflow contract defines one reproducible measurement rule
  and a truthful zero-impact path.
- Documentation drift and whitespace validation pass.

## Scope

- In scope: the PR template, the durable PR-description contract, and its docs
  index entry.
- Out of scope: changing runtime prompts, adding a prompt renderer, or changing
  ReviewGPT and CI mechanics.

## Constraints

- Technical constraints: compare final assembled prompts at base and head with
  identical representative inputs that exercise the affected path.
- Product/process constraints: require separate individual/group results while
  keeping zero-impact PRs concise.

## Risks and mitigations

1. Risk: source-line counts misrepresent shared or conditionally assembled
   runtime prompts.
   Mitigation: require final assembled character counts for each runtime.
2. Risk: unrelated PRs invent measurements.
   Mitigation: permit an explicit zero delta with the no-impact reason instead
   of requiring an unnecessary render.

## Tasks

1. [x] Add the section and measurement table to the PR template.
2. [x] Add the requirement to the completion workflow and update the docs
   index.
3. [x] Validate the exact wording, docs drift, and diff hygiene.
4. [x] Close the plan with a scoped commit; then reconcile and push main as
   requested.

## Decisions

- Use characters rather than provider tokens because character counts are
  deterministic without coupling the process contract to a model tokenizer.
- Count shared prompt changes in both runtime rows.
- Treat a non-prompt PR as a zero delta with an explicit reason.

## Verification log

- `git diff --check`
  - Passed.
- Focused heading, field, and zero-impact readback with `rg`
  - Passed: the template and completion workflow require the same two runtime
    rows and measurement rule.
- `pnpm docs:drift`
  - Passed after installing dependency links from the ordinary shared pnpm
    store.
- Parent final review
  - No findings. The change adds one disclosure contract and no runtime,
    dependency, CI, or review-service mechanism.

Completed: 2026-07-29
Completed: 2026-07-29
