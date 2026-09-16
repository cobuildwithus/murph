# Remove the serial startup mailbox fetch

Status: active
Created: 2026-09-15
Updated: 2026-09-15

## Goal

- Remove unnecessary serial network waiting before the first hosted reply while
  preserving the canonical Postgres inbox and the existing runtime importer.

## Success criteria

- ReviewGPT recommends the smallest sufficient architecture before implementation.
- Deterministic composed proof shows the startup improvement without lost,
  duplicated, reordered, unauthorized, or cross-member conversation inputs.
- Focused tests and typechecks pass; the PR has green required exact-head checks
  and a resolved final ReviewGPT result.

## Scope

- In scope: initial mailbox delivery/fetch preparation, its existing admission,
  encryption and import contracts, focused proof, owner docs, and release note.
- Out of scope: model inference, Codex initialization/resume, new queues or
  persistent caches, Temporal payload transport, production deployment.

## Constraints

- Postgres remains authoritative; Temporal retains pointer-only signals.
- Preserve current Web access/usage facts, runtime write fences, Worker-owned
  ingress decryption, ordered mailbox prefixes, and bounded batch work.
- Prefer deleting or reordering existing work over an additional startup path.
- Keep production evidence and direct identifiers out of repository artifacts.
- One owned checkout and completion owner; draft-first PR and same-session review.

## Risks and mitigations

1. Startup copies could skip backlog or advance a restored cursor incorrectly.
   Reuse canonical cursor/prefix validation and test replay, gaps, and races.
2. A faster transport could bypass live authorization or disclose ingress keys.
   Reuse the current admission and decryption owners and prove denial paths.
3. Independent Web, Worker and warm-container releases may disagree.
   Specify the actual supported skew and exercise compatible readers/fallback.

## Tasks

1. Obtain a source-grounded architecture recommendation from ReviewGPT.
2. Record the chosen data flow and deletion/reordering decisions here.
3. Implement the smallest sufficient change and focused regression proof.
4. Run relevant tests/typechecks and review the full diff and complexity report.
5. Update owner docs/changelog, commit, and open a draft PR.
6. Mark the stable candidate Ready; run final ReviewGPT concurrently with CI.
7. Resolve findings, close the plan, and report the ready PR with exact evidence.

## Decisions

- ReviewGPT recommended a fenced combined workspace/mailbox operation and
  identified earlier ordinary fetching as the smallest partial improvement.
  Choose the latter: current evidence shows enough independent restore work to
  hide the measured fetch. A new cross-service response contract, policy
  extraction, byte cap, and rollout fallback are not justified by this problem.
- Start the same fenced mailbox fetch alongside restore using checkpoint cursor
  hints. Reuse it only after restored cursors match, with no bootstrap, recovery
  fallback, or pending startup wake. Keep existing fetch fallback and provider
  observation. No wire contract, service, configuration, or durable state changes.
- Current source proves that initial mailbox fetch follows workspace restore;
  the response supplies both items and Web-owned execution facts.

## Product UX

- Outcome: reduce the wait before an initial reply without changing its meaning.
- Reaches: initial conversations, resumed workspaces, warm followups, ordered
  backlog, and denied/retried input paths covered by the selected implementation.
- Proof: synthetic composed startup timing and import/recovery scenarios, with
  final reply behavior evidence if the chosen change affects assistant decisions.
- Verdict: Ready for candidate review. Synthetic composed restore/import tests
  prove ordinary staging on a match and fallback for mismatched cursors, missing
  hints, a pending boot wake, and failed speculation. Selected provider changes
  deny stale-provider execution; discarded responses do not request handoff.
  No prompt, tool, model, or provider-input surface changes; live-model proof is
  not applicable to the transport scheduling change.

## Verification

- Select focused commands from the final changed owners; CI owns broad proof.
- Check before/after network count and serial dependencies with controlled ports.
- Verify source types, deployment skew, privacy, and no new state owner.

## Candidate evidence

- Architecture consultation: https://chatgpt.com/c/6aa9e0ad-f038-83ea-945f-6218535173bc.
- Runtime restore suite: 32 tests passed; startup/checkpoint-race suites passed.
- Existing mailbox importer and lightweight restore-preparation tests passed.
- Cloudflare composed restore, mailbox port and inline-decode suites: 31 passed.
- Assistant-runtime and Cloudflare typechecks passed; complexity ratchet passed
  with no added debt in existing hotspots. Final candidate checks are pending.
- Actual production latency remains unmeasured for the new code; no deployment
  is included. The match test proves one fetch starts while restore is blocked
  and no second fetch is required before ordinary conversation staging.
