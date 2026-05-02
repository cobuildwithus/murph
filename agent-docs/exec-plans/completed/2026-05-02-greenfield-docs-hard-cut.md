# Greenfield docs hard-cut cleanup

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Refresh stale Greenfield architecture docs so they describe the current file-native vault, public package posture, hosted mailbox/workspace protocol, runtime-state taxonomy, and provider connect-target model.

## Success criteria

- `migration.md` and `CONTINUITY_greenfield-v1-hard-cut.md` are no longer active implementation guidance.
- Live docs and package READMEs agree on the current public/private package split, CLI posture, query projection path, hosted runner shape, and device-provider route model.
- `agent-docs/index.md` continues to list only live docs and includes active package README coverage for `packages/vault-usecases`.
- Markdown-only verification/readback passes, with broken-reference checks for renamed or repurposed docs.

## Scope

- In scope:
- Documentation edits under root docs, `docs/**`, `agent-docs/**`, and package/app README files named by the user.
- Out of scope:
- Runtime code, tests, generated artifacts, dependency changes, and historical completed-plan rewrites.

## Constraints

- Technical constraints:
- Preserve unrelated dirty work in the checkout.
- Keep hosted runtime docs aligned with mailbox + workspace checkpoint + runner nudge, not the deleted run protocol.
- Product/process constraints:
- Treat this as docs/process-only work with one subagent per numbered section per user request.
- Do not add archived/historical docs to `agent-docs/index.md`.

## Risks and mitigations

1. Risk:
   Accidentally reintroducing old HostedRun/cursor/drain language as current guidance.
   Mitigation: Search touched docs for deleted primitive names after edits and keep any historical mentions explicitly framed as removed.
2. Risk:
   Multiple agents editing overlapping docs.
   Mitigation: Assign disjoint write scopes and integrate locally before verification.

## Tasks

1. Spawn one worker for each numbered rewrite section. Done.
2. Complete unnumbered cleanup and integrate worker output. Done.
3. Read back touched docs and run stale-reference searches. Done.
4. Run required docs verification and finish with a scoped commit if safe. In progress.

## Decisions

- Use the Markdown-only docs fast path unless the final diff touches non-Markdown files.

## Verification

- Commands to run:
- `git diff --check`
- Direct readback of touched Markdown docs.
- `rg` checks for stale hosted-run protocol and query projection wording in touched docs.
- Expected outcomes: no whitespace errors, no current-doc references that treat deleted hosted run primitives as live, and query projection docs use `.runtime/projections/query.sqlite`.

## Outcomes

- `migration.md` is now a completed-state pointer for the hosted runtime hard cut.
- `CONTINUITY_greenfield-v1-hard-cut.md` is historical/completed and no longer tracks unresolved runner-shape follow-ups.
- Contracts, safe-extension guidance, architecture summary, package READMEs, and hosted device-sync docs now align on current CLI posture, package posture, runtime-state taxonomy, query projection path, hosted invocation language, and connect-target/provider-manifest shape.
- `CLAUDE.md` is a short pointer to `AGENTS.md`.
- `packages/vault-usecases/README.md` now documents the private package boundary instead of remaining a one-line stub.

## Verification Results

- Passed: direct readback of touched Markdown docs.
- Passed: `git diff --check -- ...` for the touched docs and plan.
- Passed: stale-string scan for `search.sqlite`, old hosted run-orchestration wording, `one-shot hosted`, legacy memory id wording, and old CLI namespace wording.
- Passed: privacy scan for local user/home-path strings and authorization-header patterns in touched docs.
Completed: 2026-05-02
