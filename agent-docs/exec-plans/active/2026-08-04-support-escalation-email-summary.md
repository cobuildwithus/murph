# Include de-identified issue text in support escalation alerts

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Include the bounded, de-identified product issue captured for an explicit
  private-member support escalation in the immediate internal support alert,
  after the member sees and approves the exact product-only summary and its
  account linkage, while keeping raw conversation, health, contact, and
  secret-bearing context out of the member-linked row and email.

## Success criteria

- Eligible support alerts render the stored anonymous issue summary together
  with the existing internal feedback and member identifiers.
- A generic escalation request causes no tool call; Murph first shows the exact
  product-only summary, discloses account linkage, and waits for affirmative
  approval before sending it.
- Exact callback replay reuses the same stored issue text and Resend idempotency
  key even if the model rewords the callback; a missing, linked, or malformed
  stored detail fails before provider entry.
- The member-linked feedback row remains fixed server-authored metadata, the
  anonymous detail row remains the only durable free-text owner, and daily cap,
  verified-private-member authority, and plain-text delivery behavior remain
  unchanged.
- Focused Web and Assistant Engine tests, affected typechecks, direct payload
  and conversation proof, provider-input measurement, required ReviewGPT gates,
  exact-head CI, and parent final review pass.

## Scope

- In scope: hosted Web product-feedback persistence/readback, support alert
  formatting, the compact Assistant Engine support guidance, focused tests,
  and the durable product/security/reliability docs that define the disclosure.
- Out of scope: raw transcript inclusion, schema changes, recipient or sender
  changes, daily digest behavior, new retry or queue ownership, and provider or
  delivery-path changes.

## Constraints

- Technical constraints: use the already normalized and scrubbed support detail
  row; derive retry email content from stored state; preserve the three-per-UTC-
  day cap and stable provider idempotency key; add no state owner or dependency.
- Product/process constraints: this is a semantic product and private-data
  exposure change, so it uses the worktree/PR lane, product-experience and
  coverage specialist lenses, the final ReviewGPT cross-cutting gate, exact-
  head CI, and a scoped final commit.

## Risks and mitigations

1. Risk: a model-authored summary can retain semantic private detail even after
   deterministic scrubbing.
   Mitigation: require Murph to show the exact product-only summary, disclose
   its account linkage, and obtain affirmative approval before the tool call;
   email only that bounded summary, keep raw context and the reserved prefix out
   of the email, and retain semantic-private-context regression proof.
2. Risk: an idempotency-key replay can regenerate different summary wording for
   the same accepted input while reusing one provider key.
   Mitigation: read and validate both deterministic stored rows, treat the first
   stored detail as canonical, and format replay from it rather than callback
   memory; reject missing, linked, or malformed stored detail before Resend.
3. Risk: a legacy alert accepted shortly before rollout can be replayed with
   the same provider key after the email body changes.
   Mitigation: retain the key so Resend fails closed instead of duplicating the
   alert during its 24-hour retention window; monitor the bounded transition
   without adding compatibility state.
4. Risk: a new Web build can expose the issue detail while an old hosted runner
   still follows the prior one-turn escalation policy.
   Mitigation: deploy the consent-capable Cloudflare runner first with an
   immediate container rollout, require exact bundle-fingerprint convergence,
   then deploy Web; roll back Web before the runner.

## Tasks

1. Prove the existing persistence, email, replay, and privacy path.
2. Extend the existing Web owner to validate and render the stored issue detail,
   with the compact assistant guidance showing the exact summary and obtaining
   approval for its potential inclusion in an account-linked escalation first.
3. Update focused regressions and the owning durable docs.
4. Run focused verification and direct payload proof; inspect the complete diff.
5. Commit, push, open a PR, run the required specialist/final ReviewGPT and CI
   loops, resolve findings, close the plan, and finish the scoped commit.

## Decisions

- The email will contain the normalized issue content after the reserved
  `Support escalation:` prefix, labeled as a de-identified product issue.
- A generic request to escalate starts a natural disclosure/approval turn; only
  approval of the exact shown summary and its potential account linkage
  authorizes the tool.
- The anonymous detail row remains the single durable text owner; the linked row
  stays fixed server-authored metadata.
- Provider retries will format from read-back stored detail rather than the
  callback payload.
- The prompt and email changes are a coordinated rollout: the consent-capable
  runner is the prerequisite and rollback floor for the detailed-email Web
  build. Existing runner fingerprint admission and managed-container smoke own
  convergence proof; no durable consent receipt or compatibility state is
  added.

## Review anomaly retrospective

- Original requirement: put the approved de-identified product issue in the
  internal alert while preserving the existing account-linkage, privacy, cap,
  replay, and failure contracts.
- First-reviewed shape: 23 source additions and 10 deletions added the stored
  detail readback and alert body, but the existing one-turn assistant policy
  still allowed submission from a generic escalation request.
- Current shape before this decision: 36 source additions and 13 deletions.
  Review remediation added 13 source lines and 3 deletions for exact-summary
  disclosure, affirmative approval, and canonical stored-detail replay. It
  added no owner, state machine, queue, lease, compatibility path, migration,
  or repair process.
- Repeated mechanism: the privacy correction lives in the hosted runner bundle
  while the new disclosure lives in Web. Treating the release as Web-only left
  old-runner/new-Web deployment skew able to reproduce the accepted consent
  failure.
- Decision: continue with the current small architecture and remove that
  rollout seam operationally. New runner plus old Web is safe because the old
  email remains metadata-only; old runner plus new Web is forbidden; converged
  new runner plus new Web completes the approved two-turn flow. Deploy
  Cloudflare/runner first with immediate rollout and exact fingerprint smoke,
  then Web. Roll back Web first, then the runner only after Web no longer emits
  detailed alerts. Do not add a second consent authority to the callback or
  database.

## Verification

- Commands to run: focused `apps/web` Vitest for support escalation and its
  callback route; focused Assistant Engine prompt, support, and real-model test
  definitions; affected typechecks; base/head initial-provider-input capture;
  `git diff --check`; direct formatter and conversation assertions; and required
  exact-head CI.
- Expected outcomes: the alert includes the de-identified issue once, excludes
  the reserved prefix and forbidden raw context, exact replay keeps the same
  body/key despite callback rewording, malformed stored detail fails before
  email, the first conversation turn discloses without calling, the approved
  resumed turn submits a summary without semantic private context, and all
  existing authority, rate, anonymous-row, and failure cases remain green.

## Verification log

- Focused Web support service and route suites passed 14 tests. Focused
  Assistant Engine support guidance, assembled-prompt, tool-contract, and
  real-model scenario-definition suites passed 90 tests with 25 opt-in live
  model cases compiled and skipped. Web and Assistant Engine typechecks passed.
- The opt-in live-model conversation scenario could not run locally because no
  supported provider credential was available. The committed two-turn scenario
  still compiles, and the exact compact instructions were exercised through a
  local provider-request capture without external provider entry.
- Complete base/head initial provider-request capture used `gpt-5.6-terra`, low
  reasoning, production code mode, the exact support tool, identical synthetic
  direct/group inputs, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. It counted the
  serialized `input`, `parallel_tool_calls`, `text`, and `tool_choice` fields,
  excluding transport-only model, stream, storage, reasoning, service-tier,
  cache, client-metadata, and output-inclusion fields identically. Direct input
  moved from 22,938 tokens / 106,468 bytes to 23,042 / 107,065 (+104 tokens,
  +0.4534%; +597 bytes, +0.5607%). Group moved from 19,504 tokens / 91,094 bytes
  to 19,608 / 91,691 (+104 tokens, +0.5332%; +597 bytes, +0.6554%). Exact
  serialized-field correction measurement attributes +24 tokens/+122 bytes to
  compact base support guidance, +30/+190 to the assembled ordinary-feedback
  exception, and +30/+177 to the support-aware tool description. Tool schema,
  generated guidance, and other provider-visible fields are unchanged. The
  temporary capture harness was removed.
- Corrected-head product-purpose revalidation found no remaining product
  finding. The extra natural confirmation is the minimum interaction required
  to make potential account linkage truthful: the member sees the exact
  product-only summary and its possible inclusion in the linked escalation, may
  decline or correct it, and only affirmative approval enters the existing
  bounded callback. Success copy says only that the issue was saved for triage
  and an account-linked escalation was recorded, not that a capped alert was
  necessarily sent; failure still gives the direct address. The unavailable
  opt-in live-model run is the only material evidence gap.
- The complete stacked correction audit at `e3a3eb99d0` returned no qualifying
  finding and confirmed deterministic canonical replay, failure-before-provider
  ordering, the runner-first deployment contract, and Web-first rollback. Its
  response reported `MODEL_CONFIRMATION: UNKNOWN`, so it does not close the
  model-confirmed gate. The updated prerequisite was composed at `172cbd3926`;
  focused checks pass and exact-head CI is pending.
