# Simplify assistant privacy guidance

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Make Murph's composed assistant prompt easier for GPT-5.6 to follow by
  deleting duplicated or over-broad privacy instructions while preserving every
  independently enforced consent, access, identity, and disclosure boundary.

## Success criteria

- Every privacy- or identity-related instruction in the production assistant
  prompt has a named purpose, owner, and concrete failure it prevents.
- Presentation labels, authentication, authorization, consent, routing, and
  disclosure are expressed as distinct concepts instead of one blanket
  "unverified identity" rule.
- Repeated or conflicting prompt rules are deleted or collapsed into the
  smallest composable instruction at the existing owner boundary.
- The resulting composed prompts preserve required private-direct, group,
  anonymized, ambiguous-label, sender-identity, and exact-scope behaviors.
- Deterministic prompt proof, focused real-Codex journeys, package typecheck,
  ReviewGPT, and exact-head CI are green.
- Provider-input measurements show the exact prompt/token effect, with no new
  state, classifier, mapper, permission profile, or feature-specific runtime.

## Scope

- In scope: production assistant/developer prompt assembly; privacy, identity,
  consent, attribution, and group/shared-data guidance included in those
  prompts; directly affected prompt tests and focused live journeys; durable
  product/architecture wording only where the current contract changes.
- Out of scope: weakening Web/Cloudflare authorization, consent, group-grant,
  route, sender-authentication, tool-admission, or canonical-data enforcement;
  changing model selection, reasoning effort, schemas, storage, or delivery.

## Constraints

- Technical constraints: prompt guidance cannot create authority; keep security
  enforcement at existing host/tool boundaries; state true invariants once;
  prefer deletion and derivation over another abstraction or compatibility
  layer; preserve prompt-cache-stable construction.
- Product/process constraints: use only synthetic private-free fixtures; treat
  this as a Product UX Patch with prompt and security/privacy review lenses;
  follow the separate-worktree, scoped-commit, draft-PR, ReviewGPT, and
  exact-head-CI path.

## Risks and mitigations

1. Risk: deleting cautionary wording could accidentally broaden private data
   disclosure.
   Mitigation: trace each candidate rule to the enforcing host/tool boundary and
   retain deterministic negative proof for consent, scope, and identity.
2. Risk: a broad rewrite could make regressions impossible to attribute.
   Mitigation: inventory and classify first, then change one coherent rule
   group and compare the exact composed prompt before and after.
3. Risk: shorter wording could become vague or model-dependent.
   Mitigation: preserve outcome, authority source, forbidden inference, and
   stopping condition; validate representative GPT-5.6 journeys.

## Tasks

1. Inventory every production prompt fragment and tool description that defines
   privacy, identity, consent, attribution, or disclosure behavior, including
   recent changes and test ownership.
2. Apply first-principles and independent review-only audits to classify each
   instruction as enforced invariant, necessary model guidance, duplicate,
   contradiction, or obsolete scaffolding.
3. Design and implement the smallest deletion-first simplification at the
   current prompt owners; update durable docs only for changed contracts.
4. Add deterministic composed-prompt proof and focused real-Codex journeys for
   the material positive and negative branches.
5. Measure provider-input impact, complete Product UX walkthrough and
   ReviewGPT, require green exact-head CI, and close the plan through the normal
   scoped commit/PR flow.

## Decisions

- Use the live GPT-5.6 prompting guidance: state each rule once, prefer
  outcome-first instructions and concrete decision boundaries, and retain
  examples only when they encode a demonstrated product requirement.
- Treat names as presentation data with a narrow field-purpose contract. A
  system-supplied message name labels that message, and a returned
  `displayName` labels that row. Neither grants access, consent, sender
  identity, routing, effect authority, or durable profile truth.
- Keep authority in the host: exact sender handles associate a current speaker
  to one returned row, `participantId` remains a group-scoped tool selector,
  and participant effects continue through an exact server-issued
  `message_ref` that the host reloads before deriving the sender.
- A fresh shared-data row may label every dated record in that row, including a
  prior-period record used in a scheduled weekly edition. It may not
  retroactively label separate unlabeled figures quoted earlier in the
  conversation.
- Compose hosted-group guidance from admitted capabilities. A no-tool group
  turn receives no unavailable tool instructions; group email still receives
  its transport restrictions even though its assistant tool surface is empty.

## Audit result

- Root cause: the group prompt correctly told Murph to use a same-row
  `displayName`, while separate blanket identity cautions described participant
  labels as hypotheses and prohibited identity inference without distinguishing
  presentation from authentication. The model therefore sometimes refused a
  mapping that the tool had already supplied.
- The data join, consent projection, current-speaker association, selector, and
  effect paths were already host-owned and correct. The durable correction is a
  single presentation rule plus those existing enforcement boundaries, not a
  mapper, classifier, or new state owner.
- Deleted or collapsed duplicated room-container, private-evidence, consent,
  attribution, and tool-surface prose. Preserved every independently useful
  disclosure and authority boundary, including anonymization, ambiguous labels,
  exact-scope reads, partial results, group email, and Apple Health uncertainty.

## Verification

- Commands to run: focused assistant prompt tests, targeted assistant-engine
  typecheck, selected real-Codex journeys on the product model, exact prompt
  token/byte measurement, diff/readback checks, and required exact-head PR CI.
- Expected outcomes: all selected positive and negative behaviors pass; no
  required authority or disclosure boundary disappears; composed prompt size
  is reduced or any retained text has a demonstrated behavioral purpose.
- Deterministic result: 12 focused files passed, covering 492 tests with 114
  intentional provider/live skips. Assistant Engine typecheck and direct
  package build passed. `git diff --check` passed.
- Product walkthrough: unique row labels are used without reconfirmation;
  duplicate or missing labels produce only a narrow limitation; anonymization
  suppresses names; fresh dated records keep their row labels; separate older
  unlabeled figures are not retroactively mapped; current-speaker effects still
  require host-derived sender authority; ordinary no-tool group turns omit
  unavailable tools; no-tool group email retains transport restrictions.
- The focused real-Codex journey used a separate authenticated Codex home and
  stopped in the cache probe with `ASSISTANT_CODEX_USAGE_LIMIT` before any
  provider action. Per the live-test contract, the journey is on hold rather
  than retried through additional profiles; deterministic boundary proof is
  authoritative for this candidate.
- Complete first-provider-request impact, measured with identical base/head
  fixtures and `o200k_harmony`: ordinary direct decreases by 181 tokens and 927
  serialized bytes (0.62% and 0.69%); group decreases by 564 tokens and 3,042
  bytes (2.17% and 2.54%). Scheduled speaker-label serialization saves a
  further 3 tokens and 15 bytes per rendered profile or address-book label.
