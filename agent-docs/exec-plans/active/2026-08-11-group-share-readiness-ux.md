# Group share readiness UX

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Start the existing private-runtime projection path immediately after a member
  approves group sharing.
- Distinguish a granted share whose projection is still preparing from a
  completed projection with no current records.
- Give the group truthful, concise feedback without exposing private data or
  weakening consent and scope boundaries.

## Success criteria

- Affirmative reaction acceptance durably requests the existing payload-free
  member-runtime wake as soon as the sleep grants commit.
- Group shared reads expose `pending`, `missing`, and `available` as distinct
  data states while preserving `not_granted` authority semantics.
- Assistant guidance treats pending data as preparation, never as proof that
  the member has no private data, and names the recent-data window in the
  reaction consent message.
- Focused reaction, group-store/tool, parser, and runtime tests prove the
  end-to-end contract, and relevant package typechecks pass.
- Preliminary specialist and final ReviewGPT gates, exact-head CI, and parent
  review complete with no unresolved accepted findings.

## Scope

- Existing hosted group reaction/grant and payload-free runtime-wake path.
- Existing Web-owned vault-share snapshot/read contract.
- Existing hosted-execution parser/types and assistant group-shared guidance.
- Focused tests and matching durable consent/group-sharing documentation.

## Constraints

- Keep Web authoritative for grants and the member runtime authoritative for
  private-vault projection.
- Reuse the existing payload-free runtime wake; add no queue, scheduler, or broad state
  owner.
- Pending must disclose no health values, provider identity, or private-data
  existence.
- Preserve active user-critical group replies and consent revocation behavior.
- Keep confidential support evidence and direct identifiers out of repository
  artifacts, prompts, tests, docs, and review packages.

## Tasks

1. [x] Collect ReviewGPT UX recommendations and inspect the exact current
   consent, wake, projection, read, prompt, and test owners.
2. [x] Implement the smallest pending/readiness contract and immediate existing
   wake behavior with focused regression coverage.
3. [x] Run focused verification, inspect the complete diff, and update durable
   contract documentation where needed.
4. [ ] Commit, push, and open the PR; run preliminary specialist and final
   ReviewGPT concurrently with exact-head CI.
5. [ ] Resolve accepted findings, complete parent review, close this plan with
   `scripts/finish-task`, and prove current-base mergeability.

## Verification log

- ReviewGPT independently confirmed that the original read boundary collapsed
  an unmaterialized null snapshot and a completed encrypted empty snapshot into
  the same missing state. Its accepted UX additions keep pending participants
  unranked, prevent repeat-consent pressure, and make selector-based seven-day
  activity disclosures explicit. Its proposed operator-maintenance mailbox was
  rejected because the current architecture already designates the payload-free
  runtime wake for committed user actions.
- Focused Web verification passed: 4 files and 225 tests. Focused hosted wire
  parser verification passed: 1 file and 66 tests. Focused Assistant Engine
  verification passed: 2 files and 104 tests.
- Hosted Execution, Assistant Engine, Web, and Cloudflare typechecks passed
  after the final ReviewGPT wording refinement; the affected Assistant Engine
  tests also passed after that refinement. Durable-doc drift and direct
  pending-parser scenario proof passed.
- Complete first-provider request capture used the pinned real Codex App Server,
  the repository's scripted Responses endpoint, `gpt-5.6-terra`, low reasoning,
  production code mode, identical synthetic direct/group requests, and
  `gpt-tokenizer` 3.4.0 `o200k_harmony`. It serialized `include`, `input`,
  `parallel_tool_calls`, `text`, and `tool_choice` after normalizing temporary
  paths and UUIDs, and excluded model selection, reasoning, storage, streaming,
  cache, client, account, and transport metadata identically. Direct changed
  from 23,841 tokens / 108,952 bytes to 23,837 / 108,961 (-4 tokens,
  -0.0168%; +9 bytes, +0.0083%). Group changed from 20,277 tokens / 93,171
  bytes to 20,348 / 93,549 (+71 tokens, +0.3502%; +378 bytes, +0.4057%). The
  entire delta is the assembled instruction input; tool/schema/generated
  guidance and other included fields are unchanged. Temporary capture code and
  payloads were removed.
- Public changelog fragment validation passed: 1 file and 7 tests. The first
  concurrent invocation raced its generated registry preparation; the same test
  passed after the Web typecheck completed generation. Final Web typecheck
  passed with the fragment included.
