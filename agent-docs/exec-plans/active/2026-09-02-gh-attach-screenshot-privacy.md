# Use privacy-safe GitHub CLI screenshot attachments

Status: active
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Make GitHub CLI attachments the standard completion path for reviewer-useful
  screenshot and video evidence without allowing private material to leave the
  machine.

## Success criteria

- The completion workflow names GitHub CLI 2.99.0 or newer and the repeatable
  `--attach` flow for pull requests and comments.
- The workflow requires native-resolution privacy review before upload, treats
  attachments as public and durable, and requires agents to withhold uncertain
  media rather than upload first and redact later.
- Documentation checks and final diff review pass without personal identifiers
  or unrelated changes.
- The locally installed GitHub CLI exposes `--attach` on pull request creation,
  editing, and comments.

## Scope

- In scope: completion-workflow screenshot privacy and GitHub upload guidance;
  local GitHub CLI upgrade and direct flag verification.
- Out of scope: a second upload service, automatic image-content scanning,
  frontend behavior, and changes to historical completed plans.

## Constraints

- Technical constraints: reuse GitHub CLI's native upload primitive and the
  existing ignored `.artifacts/review-gpt/` evidence location.
- Product/process constraints: uploads must contain synthetic or fully redacted
  evidence only; the rule must not create a screenshot quota.

## Risks and mitigations

1. Risk: An agent uploads an unsafe original and tries to remove it afterward.
   Mitigation: treat the first upload as public and durable, require inspection
   before upload, and prohibit upload when privacy is uncertain.
2. Risk: New guidance duplicates the existing design-proof owner or adds a
   second evidence system.
   Mitigation: keep the change inside sequence step 6 and reuse `gh --attach`.

## Tasks

1. Confirm the official GitHub CLI attachment contract and update the local CLI.
2. Add the privacy gate and repeatable attachment workflow to completion docs.
3. Run documentation checks and inspect the final diff.
4. Close the plan, commit the scoped change, and open a draft pull request.

## Decisions

- Keep `agent-docs/operations/completion-workflow.md` as the sole durable owner;
  do not duplicate the procedure in the pull request template.
- Use native `gh --attach` rather than adding or extending a repository upload
  helper.

## Verification

- Commands to run: `gh --version`; focused `gh ... --help` flag checks;
  `pnpm docs:drift`; `pnpm docs:gardening`; `pnpm complexity:diff`;
  `git diff --check`; privacy-focused final diff inspection.
- Expected outcomes: GitHub CLI 2.99.0 reports `--attach`; documentation checks
  pass; the scoped diff contains only the workflow, its index entry, and the
  closed plan.
- Results: GitHub CLI 2.99.0 and all three pull request attachment help checks
  passed; docs drift, doc gardening, complexity, whitespace, announcement-link,
  and identifier scans passed. Complexity reported no authored JavaScript or
  TypeScript changes.
