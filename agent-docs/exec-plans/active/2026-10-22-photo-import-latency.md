# Reduce hosted photo import latency

Status: active
Created: 2026-10-22
Updated: 2026-10-22

## Outcome and protected contract

Reduce time spent preparing an inbound photo before the assistant can reply.
Keep canonical inbox ownership, bounded WebP evidence, orientation, privacy,
retry/admission gates, and Linq typing ordering. No production mutation or merge.

## Evidence and decision

Read-only production telemetry confirms roughly 2.4 s of preparation and 6.2 s
of import within a 9.5 s projection. The download-finished marker leaves roughly
4.3 s inside import after download. Existing telemetry cannot separate encoding,
canonical persistence, native/module startup, and resource contention. A further
roughly 3 s before admission remains unattributed; source inspection places it
around settled-evidence validation and pending-index enqueue, including its lock.
These are hypotheses, not measured encoder or lock durations.

Local real-import profiling attributes 96% of import wall time to image
normalization. Seven alternating paired runs after warmup on a 12 MP JPEG:
WebP effort 4 median 453.5 ms / 478.0 CPU ms / 849800 bytes; effort 0 median
149.7 ms / 173.4 CPU ms / 988716 bytes. Full import cold/warm changed from
484/461 ms to 190/165 ms. These local results do not establish production speedup.
The scratch harness and temporary timing instrumentation are excluded from commits.

The original normalization history establishes bounded static WebP storage, not
an encoder-effort requirement. Retain 3072 px, quality 88, format and stripping;
change only static encoder effort to 0. This changes pixels/hashes and can enlarge
files (16.3% on the measured photo). Disclose the model-facing tradeoff. GIFs and
existing captures remain unchanged. Do not infer byte-identical image quality.

Add one optional numeric field to the existing mailbox timing aggregation:
`projectionCapturePersistMs`. Existing readers accept numeric diagnostic keys;
no new event/schema, transport, persisted product state, retry or cache owner.
It separates capture work from the rest of import on future natural traffic.

## Product UX

- Effort: Patch.
- Outcome: Less local processing before replies to still-image messages.
- Reaches: Every connector using canonical inbox image normalization, including
  individual/group image evidence. Ordinary text, GIFs and audio unchanged.
- Proof: Real storage normalization tests (bounds, metadata, hashes, failures),
  real import benchmark, and real-Codex reading of a synthetic normalized label
  through the existing retained-media authority/materialization path.
- Limit: Neither a live Linq delivery nor a production improvement is measured.

## Verification and completion

- Focused inbox image normalization suite.
- Conversation import timing, mailbox propagation and aggregation tests.
- Typechecks for inboxd, assistant-runtime and assistant-engine.
- Focused real-Codex label reading via local subscription; review final reply.
- Changelog fragment generation/render proof and relevant Web typecheck.
- Complexity guard, parent diff/privacy review, draft PR, exact-head CI and
  required ReviewGPT concurrently, final base mergeability check. Do not merge.

## Rollout and remaining questions

No format/schema migration: old/new readers consume the same WebP and diagnostic
shape. New captures use faster encoding after runner rollout; old ones are not
rewritten. Rollback preserves readable files. Post-deploy, compare existing
projection totals and new capture spans, watching stored sizes and typing latency.
Preparation, post-projection admission, actual container CPU scaling and precise
encoder attribution remain open. Avoid more machinery until those are measured.

## Candidate evidence

- Inbox normalization: 9 tests passed.
- Hosted conversation and mailbox suites: 163 tests passed; timing propagation
  and aggregation additions passed in the focused 142-test rerun.
- Inboxd, assistant-runtime, assistant-engine and Web typechecks passed.
- Changelog generation and archive rendering: 4 tests passed.
- Real-Codex label journey passed with gpt-6.1-sol via local subscription.
  Exactly one materialization, list/open authority checks, and correct background
  and portion reading; no request to resend or internal-path disclosure. Ready.
  Earlier profiles failed before provider action or were logged out; the bounded
  alternate-home procedure found a working subscription. No credentials copied.
- Complexity diff passed: unchanged debt and four existing orchestration/metadata
  hotspots (41, 33, 25, 70). The timing field does not justify refactoring them.
- Parent review: no new effects, dependencies, queues, locks or format migration;
  temporary profiling changes removed, private evidence excluded from artifacts.
