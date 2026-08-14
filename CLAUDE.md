# CLAUDE.md

Read `AGENTS.md` before starting work. It is the canonical repository instruction
file; `agent-docs/operations/agent-workflow-routing.md` owns task classification,
worktree choice, model routing, audits, verification, and commit paths.

Do not create a second workflow here. In particular:

- Use the task-class worktree and model route instead of a universal delegation rule.
- When invoked as a delegated implementer, work in the supplied checkout and
  leave branches, commits, pushes, verification, and final review to the parent
  unless the handoff explicitly widens that authority.
- Follow the privacy rules in `AGENTS.md`; omit personal names from PR titles and
  bodies as well as committed artifacts.

## Frontend changes are not done until they are seen

For any user-facing `apps/web` UI change, run the app and look at the change
before calling it complete, then attach the rendered evidence that the changed
states and risks need. Follow `agent-docs/operations/product-ux.md`; there is no
screenshot quota. This is the existing `/design` catalog rule in
`agent-docs/operations/agent-workflow-routing.md`; it is repeated here because it
is the step most often skipped. Green tests and a typecheck are not evidence that
a screen renders correctly. Secondary worktrees must isolate ports, database, and
Next dist dir first, per `agent-docs/operations/hosted-local-worktree-dev.md`.

## Write the whole PR body when you open the PR

`agent-docs/operations/completion-workflow.md` defines the required PR body. Every
`Required:` section is mandatory on the first push, not something to backfill after
a reviewer asks: why this PR exists, user goal, Product UX, invariants,
non-obvious affected surfaces, preliminary specialist lenses, the five-row
change-shape table, and the design proof — plus deployment skew when the PR
touches a deploy boundary.

CI mechanically enforces only the design proof, so the other sections are the ones
that silently go missing. Do not let a green pipeline stand in for the contract:
if a section does not apply, write `None` or `Not applicable` with a one-line
reason rather than dropping the heading. Reviewers read the body to decide what to
hold the diff against, and an absent invariants or affected-surfaces section costs
a full review round.

## Run ReviewGPT immediately, never queue it

Start a ReviewGPT round the moment it is due. Do not park it behind a watcher,
a poll loop, or a "wait until the browser lanes are free" script. Launch it, and
if that attempt stalls before `Draft model selected`, kill it and launch again on
another lane. Retrying is cheap; waiting is not.

Lane contention across concurrent sessions is the normal state of this machine,
not an exceptional condition to wait out. A queued round can sit idle for hours
while the machine never reaches the idle threshold the queue was watching for,
and the review is the gate on landing, so every hour it waits is an hour the work
does not ship. Report the round's outcome, not the fact that it is scheduled.

## Never use real people or conversations as examples

When describing a bug, writing reasoning, or building fixtures/tests, never use a
real person's name, a real email or phone number, or a verbatim user conversation
— not in PR titles/bodies, commit messages, code comments, docs, test fixtures, or
snapshots. Describe production incidents abstractly (roles/behavior, not identity),
and use opaque IDs (`hid_`, `usr_`, thread UUIDs) or synthetic placeholders
(`example.com` emails, reserved `555` phone numbers, generic role handles like
`@Dad_User`) for any illustrative data. Product/provider/brand names (Murph,
Apple Health, Function Health, etc.) are fine; the repo owner's own identity is
not — keep it out of committed text too.

Screenshots, chat transcripts, and user feedback are confidential evidence, not
repository-ready source material. Never copy, closely paraphrase, or hardcode
them, including names, handles, images, identifying details, distinctive
wording, or exact scenarios, into system prompts, tests, fixtures, snapshots,
evals, documentation, comments, PR descriptions, or source code that may become
public.
