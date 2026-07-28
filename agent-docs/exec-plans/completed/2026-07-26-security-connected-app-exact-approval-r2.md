# Connected-app exact approval security fix

Status: completed
Created: 2026-07-26
Updated: 2026-07-27

## Goal

- Prevent untrusted connected-app provider content from authorizing calendar
  creation, account rename, or account disconnect through model-authored tool
  arguments.

## Success criteria

- The connected-app tool contract has no model-authored approval flag.
- Web resolves the current member-owned account and all server-forced arguments
  before constructing an exact sensitive-action approval request.
- Calendar creation, rename, and disconnect perform no provider mutation until
  that exact approval is atomically consumed.
- Each prospective provider egress uses a fresh consumer identity, so concurrent
  or replayed invocations cannot both execute.
- Reads, search, list, connection, accountless service calls, and group
  restrictions keep their current behavior.
- Focused tests, canonical diff verification, acceptance, preliminary
  specialist review, PR CI, and final ReviewGPT pass.

## Scope

- In scope: connected-app mutation contracts, Web-owned authorization and
  provider boundary, focused tests, assistant skill guidance, and current owner
  documentation.
- Out of scope: new persistence, queues, automatic provider-action replay,
  provider catalog expansion, OAuth changes, and connected-app read behavior.

## Constraints

- Reuse `HostedSensitiveActionChallenge` as the single approval owner.
- Bind approval to the server-resolved member, account id, operation or exact
  tool slug, provider version, and complete canonical arguments.
- Do not execute the non-durable mutation from the generic approval wake; the
  member returns to Murph and one fresh exact invocation consumes approval.
- Preserve calendar ambiguity as non-retryable.
- Keep this batch independent of PR 991 and do not merge either PR.

## Risks and mitigations

1. Risk: two retries consume one approval and both reach the provider.
   Mitigation: use a fresh consumer id per egress and require the atomic consume
   result to be approved immediately before mutation.
2. Risk: the approved preview differs from the executed provider request.
   Mitigation: fingerprint the canonical complete request after forced server
   arguments and execute that same object.
3. Risk: the user changes account or arguments after approval.
   Mitigation: derive action identity from the current resolved account and
   exact effect so any change requires a different approval.

## Tasks

1. [x] Inspect and simplify the generated ReviewGPT patch against current main.
2. [x] Implement the exact mutation boundary and focused regression tests.
3. [x] Reconcile security, architecture, protocol, approval, and skill docs.
4. [x] Run preliminary specialists, canonical verification, and acceptance.
5. [x] Commit and push a separate draft PR without merging; the immutable-head
   final ReviewGPT and CI gates run after this plan-closing commit.

## Decisions

- Reuse the existing Web action-approval store directly from the Web-owned
  connected-app service; no second runtime approval port or state owner is
  needed.
- Keep `returnContactKind` null because the signed connected-app callback does
  not own channel identity and adding durable replay state would exceed the
  security fix.
- Resolve ownership again on the post-approval invocation before consuming.
- Treat the `connected-app:` action-id namespace as a derived foreground
  continuation contract. No new persisted field is needed: the approval view
  tells the shared page whether an approved action resumes automatically or
  requires the member to return and ask Murph to continue.
- The generated patch's multiline presentation violated the shared
  control-character contract, so the parent replaced it with bounded semantic
  calendar segments and verified the resulting request through the shared
  parser.
- The semantic-row delimiter is protocol-owned presentation syntax. Untrusted
  account aliases and provider arguments replace that delimiter before
  rendering, so provider content cannot forge an Account, Starts, or Time zone
  row.
- The approval card preserves the decision returned by Web. Denial has its own
  live and visible terminal state and never reuses approval or continuation
  wording.

## Verification

- Commands to run:
  - focused package typechecks and connected-app tests
  - `pnpm docs:drift && pnpm docs:gardening`
  - `pnpm test:diff packages/hosted-execution packages/assistant-engine apps/web`
  - `pnpm verify:acceptance`
  - corrected-head PR CI and final ReviewGPT loop
- Expected outcome: all checks pass and every model-reachable connected-app
  mutation is provably approval-gated with no new persistence or replay path.
- Focused owner proof is green: hosted-execution, assistant-engine, and Web
  typechecks; 45 connected-app/approval Web tests; 83 assistant prompt and tool
  tests; and the hosted-execution connected-app contract tests.
- A direct server-mode request-builder scenario proves an argument change
  changes both identities, the presentation has no forbidden controls, and the
  result remains parser-valid and bounded.
- The first canonical diff run reached an unchanged assistant-runtime test and
  reproduced its foreground-preemption expectation failure in isolation. The
  current branch does not modify that package or test path; final canonical
  verification will record the same base blocker if it remains.
- Product-experience review accepted three initial findings: continuation was not
  actionable, shared copy was file-specific, and long calendar details could
  hide core consent facts. The correction makes the pending assistant response
  and approved null-contact state actionable, generalizes shared copy, renders
  core calendar facts as stable segments, and adds production-component
  desktop/mobile design studies.
- A fresh product-experience rerun accepted two additional findings: denial was
  presented as approval, and untrusted values could inject forged visual rows.
  The card now preserves approved versus denied outcomes, the shared decision
  presentation is reused by the card, terminal page, and design study, and
  hostile delimiter values stay inside their trusted rows. Focused interaction
  and request-builder regressions cover both corrections. The required final
  fresh product verdict returned no findings, with coherent pending and
  approved-return studies at desktop and mobile widths and zero scoped
  overflow.
- The preliminary completion-specialists pass found four accepted gaps:
  production kept the pending request shell after a terminal decision, the
  generic delimiter renderer changed legacy prose approvals,
  bidirectional-format controls remained in untrusted preview values, and the
  exact identity tests covered only account id and arguments. The correction
  replaces the live card with one shared terminal component, derives an
  explicit prose/fact-row presentation kind from the trusted action namespace,
  strips directional formatting controls, and exercises every bound identity
  dimension.
- The final focused Web pass is green across the connected-app request builder,
  service, route, shared approval card, decision route, terminal page, and auth
  interaction coverage. The latest UI remediation is additionally green in 16
  directly affected tests and the Web typecheck.
- A later fresh product-experience review found rename and disconnect were
  classified as fact rows but still joined into prose. Those presentations now
  use the same protocol-owned delimiter as calendar consent, and a rendered
  regression proves each operation exposes three distinct rows while hostile
  alias delimiters remain inside the trusted New name row. The focused
  post-correction re-review returned no findings and confirmed that no approval,
  denial, terminal-replacement, or continuation behavior changed.
- Product review retains one evidence gap rather than a code finding: no single
  production-faithful scenario composes conversation handoff, browser decision,
  a fresh conversation invocation, and the provider result. Current focused
  proof covers the assistant prompt contract, Web decision boundary, atomic
  consume, terminal UI, and exact provider call separately; this patch adds no
  new replay or handoff mechanism to justify a second stateful E2E owner.
- The preliminary completion-specialists pass is resolved with no remaining
  accepted findings.
- `pnpm test:diff packages/hosted-execution packages/assistant-engine apps/web`
  passed across all selected package, Web, Cloudflare, build, lint, and guard
  lanes.
- `pnpm verify:acceptance` passed the full workspace acceptance suite.
- After rebasing onto the latest `origin/main`, the focused post-rebase proof
  passed: hosted-execution typecheck plus 3 connected-app tests,
  assistant-engine typecheck plus 82 prompt/tool tests, and Web typecheck plus
  57 approval and connected-app tests.
Completed: 2026-07-27
