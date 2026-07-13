# PR 558 production-path remediation

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Resolve the two accepted final ReviewGPT findings on PR #558's production
  path without adding a second cleanup or membership lifecycle.
- Let inactive no-AI maintenance fetch only system-lane mailbox data through
  the real Cloudflare-to-Web boundary.
- Preserve self-service departure when the group runtime is inactive while
  ordinary inactive conversation input remains ignored.

## Success criteria

- The Cloudflare mailbox port binds a narrow maintenance purpose to
  `inbox_media_retention` invocations; callers cannot opt themselves into it.
- Web parses that purpose before the active-access gate, permits it only for
  system-lane fetches and matching system-lane payloads, and bypasses only the
  AI-usage gate that cannot apply to no-AI maintenance.
- An explicit high-confidence leave request on an inactive routed Linq group
  persists its canonical sender/route envelope, marks that conversation item
  consumed, and calls the existing atomic leave/revoke transaction with no
  assistant, model, wake, read receipt, or provider send.
- Ordinary inactive messages, direct threads, self-authored messages,
  ambiguous leave text, non-members, and owner leave remain fail-closed.
- Focused tests, relevant typechecks, required specialist audits, CI, and one
  clean final ReviewGPT audit cover the pushed corrected head.

## Scope

- Hosted-execution mailbox request contracts and parsers.
- Cloudflare runtime-platform mailbox purpose binding.
- Web mailbox fetch/payload access and AI-gate ordering.
- Inactive routed Linq group leave admission at the existing Web transaction.
- Focused tests and durable hosted-runtime/group departure documentation.

## Constraints

- Keep the durable mailbox and existing `leaveHostedGroupMemberTx` as the only
  cleanup and membership mutation owners.
- Never import the conversation lane or run assistant/model/provider work in
  inactive maintenance.
- Do not let a generic runtime request assert the maintenance purpose.
- Derive departure identity only from the signed current Linq event and its
  persisted canonical envelope/current route; never from model-authored data.
- Keep exact leave matching deliberately narrow to avoid interpreting ordinary
  conversation as a destructive request.

## Risks and mitigations

1. Risk: a caller abuses the maintenance purpose to read inactive conversation
   data. Mitigation: Cloudflare binds purpose from the invocation processing
   mode, Web requires exactly one system cursor, and payload fetch rechecks the
   persisted item lane.
2. Risk: an earlier AI-requiring system item suppresses later cleanup.
   Mitigation: the narrow system-only maintenance purpose skips the batch AI
   gate; the runtime path remains no-AI and checkpoints without executing work.
3. Risk: loose text matching removes someone from a group unexpectedly.
   Mitigation: accept only standalone normalized commands that explicitly name
   leaving the current group; all other inactive text remains ignored.
4. Risk: webhook replay loses the departure evidence or repeats mutation.
   Mitigation: append the canonical route-bound mailbox envelope with the
   provider event id, reject dedupe conflicts, consume it in the same
   transaction, and rely on `leftAt` idempotency.

## Tasks

1. Add and bind the narrow inactive-system mailbox purpose across contracts,
   Cloudflare transport, and Web routes.
2. Add the inactive-only deterministic Linq group leave path through the
   canonical envelope and existing leave transaction.
3. Add focused parser, port, route, planner, idempotency, and negative tests;
   update the durable runtime/deployment contract.
4. Run focused verification, relevant typechecks, completion audits, and the
   serial diff-aware lane.
5. Finish the scoped commit, push, wait for CI, then run exactly one final
   ReviewGPT audit on the corrected exact head and resolve all findings.

## Decisions

- Bind maintenance authority in the Cloudflare platform factory from the
  invocation processing mode, then strip any caller-provided purpose at the
  mailbox port. The signed request carries only the factory-bound purpose.
- Keep the Web maintenance exception system-only: prefix fetch requires one
  system cursor, and sidecar fetch re-binds the dedupe key and item id to a
  persisted system item owned by the callback-bound member.
- Admit inactive departure only for a single normalized text part with an
  explicit self-referential current-group command. Persist the normal
  route-bound conversation envelope before using the existing leave owner.
- Let `leaveHostedGroupMemberTx` capture its own database-clock leave fence
  after its locks. A separate later database time consumes the evidence item.

## Verification

- Focused hosted-execution parser tests: 28 passed.
- Focused Cloudflare mailbox port/platform tests: 122 passed.
- Focused Web mailbox fetch/payload route and Linq routed-thread tests: 95
  passed; the final Linq route recheck passed 43 tests.
- Focused assistant-runtime entrypoint tests: 208 passed, including an explicit
  sidecar-fetch assertion for the system-only no-assistant path.
- Hosted-execution, Cloudflare, assistant-runtime, and Web typechecks passed.
- Scoped Web lint passed with zero errors.
- `pnpm docs:drift`, `pnpm hosted-temporal:guard`,
  `pnpm test:scenario-integrity`, and `git diff --check` passed.
- `pnpm test:diff packages/hosted-execution packages/assistant-runtime
  apps/cloudflare apps/web` passed in 1,004 seconds: all affected package and
  reverse-dependent typechecks/tests, Web build/lint/dev smoke/4,507 tests,
  and Cloudflare verification/1,740 tests were green.

## Completion audits

- The prior exact-head final ReviewGPT audit reported two accepted High
  production-path findings: inactive cleanup was blocked by active/AI gates,
  and inactive route admission discarded leave requests before persistence.
  This changeset resolves both at the existing ownership boundaries.
- The serialized security/privacy trace found no remaining medium-or-higher
  vulnerability. Callback authentication binds the user and signed body;
  Cloudflare binds rather than trusts the purpose; Web limits inactive reads
  to the persisted system lane; Linq departure authority comes from the signed
  current event, verified participant identity, and a route recheck under the
  mailbox append lock.
- The coverage pass added direct proof for a manual-request item preceding a
  sidecar-backed revoke, no conversation import or assistant phase, caller
  purpose stripping, system-only route access, ambiguous leave rejection,
  canonical evidence persistence/consumption, and leave-fence ordering.
- Parent final review accepted and fixed one ordering issue: the first draft
  pre-read the leave timestamp before group/member locks. No unresolved local
  audit finding remains. The required final exact-head ReviewGPT round remains
  the post-push merge-readiness gate.
Completed: 2026-07-13
