# Restore private-to-joined-group deferred-tool discovery

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Restore the existing promise that a member's private Murph can work with
  joined group conversations without first being challenged to inspect deferred
  tools.

## Success criteria

- On `gpt-5.6-terra`, a broad private-chat capability question receives a
  truthful first-turn answer: joined Murph groups are available from the private
  conversation, while unjoined device chats are not.
- An explicit private-to-group request still loads `murph.group_consult` and
  makes the existing owner-bound action instead of redirecting the member to
  speak in the group.
- Deterministic prompt/tool proof and the focused live journey pass without
  widening group, membership, contact, route, or delivery authority.
- The change remains a small prompt-owner correction with no new state,
  abstraction, retry path, or dependency.

## Scope

- In scope: private direct conversation guidance for joined-group capability,
  deterministic prompt coverage, one focused real-Codex regression, and any
  smallest correction proven necessary by that journey.
- Out of scope: unjoined chat discovery, provider roster or membership changes,
  changes to group ownership/privacy, backfill, new group actions, or edits to
  the separately owned current-sender PR.

## Constraints

- Technical constraints: reuse the existing deferred `murph.group_consult`
  contract and Web-owned target resolution; preserve the current schema/parser
  and all fail-closed authority checks.
- Product/process constraints: Product UX Patch. Outcome: Murph answers and acts
  correctly on the first private turn. Reaches: broad capability questions and
  existing joined-group asks/handoffs. Proof: deterministic composed-prompt
  assertions plus a reviewed `gpt-5.6-terra` journey using production builders.

## Risks and mitigations

1. Risk: broad wording could imply access to every device group chat.
   Mitigation: name joined Murph groups and preserve the unjoined-chat boundary.
2. Risk: duplicate guidance could bloat or conflict with the existing direct
   targeting instructions.
   Mitigation: extend that existing owner in one concise rule and test absence
   from unsupported prompt surfaces.
3. Risk: overlapping work in PR #2456 could be accidentally co-authored.
   Mitigation: keep this task on its own worktree and branch, inspect overlap,
   and do not edit or push the existing PR branch.

## Tasks

1. Reproduce the first-turn denial with a synthetic focused Terra journey and
   trace the composed prompt plus deferred tool advertisement.
2. Apply the smallest correction at the existing direct hosted-group prompt
   owner and add deterministic regression coverage.
3. Rerun the focused deterministic suite, package typecheck, and Terra journey;
   review the actual reply and tool effects.
4. Complete the Product UX walkthrough, parent diff review, scoped commit, PR,
   required specialist review, and exact-head CI gates.

## Decisions

- Treat this as a Product UX Patch, not a new capability: the group-consult
  route, authorization, persistence, and provider behavior already exist.
- Keep PR #2456 independent. It fixes the deferred schema and the reverse
  current-group-to-private direction; this task owns only the private direct
  discovery denial shown by the first-turn journey.
- Root cause: the direct prompt described how to execute a named group ask or
  handoff but never stated the capability boundary as a member-facing answer.
  With a broad question, Terra could therefore choose either a blanket denial
  or an overbroad promise before deferred discovery. Production showed the
  restrictive failure; the faithful pre-fix live journey showed the overbroad
  variant. No provider, runtime, membership, or group-tool error accompanied
  the production completion.
- Correction: extend the existing direct hosted-group instruction with one
  explicit distinction (joined groups are reachable; unjoined device chats are
  not) and one domain-specific deferred-discovery rule. Keep all authority and
  effects with the existing tool and Web owner.

## Verification

- Commands to run: focused Assistant Engine Vitest for composed prompt and
  group-tool behavior; `pnpm --dir packages/assistant-engine typecheck`;
  `pnpm test:assistant:live -- --test "<unique private-group discovery name>"`;
  `git diff --check` and privacy-safe diff inspection.
- Expected outcomes: supported private prompts disclose the exact scoped
  capability; unsupported surfaces do not; Terra answers correctly without a
  challenge and makes no unauthorized or duplicate effect.
- Pre-fix evidence: four runs with explicitly joined wording answered correctly;
  the ambiguity-focused run omitted the joined-only boundary and failed the
  UX assertion. This isolates the missing capability distinction rather than a
  deterministic runtime outage.
- Post-fix evidence so far: the 18-test deterministic prompt suite passes; the
  focused Terra journey returned a truthful joined-only answer with zero group
  effects and was reviewed `Ready`; Assistant Engine typecheck passes.
