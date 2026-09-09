# Remove unnecessary hosted control-plane requests

Status: active
Created: 2026-09-09
Updated: 2026-09-09

## Goal and protected boundary

Remove avoidable hosted source reads while preserving source revocation,
canonical import admission, terminal coverage, and foreground yielding.
Production request reduction must be distinguished from synthetic call counts.

## Implementation

- Intermediate empty precise-history segments skip the post-fetch source read;
  successful intermediate imports skip the post-import read. Both only queue
  an existing epoch-bound continuation, which must pass fresh admission again.
- Terminal segments retain their checks. No authorization cache, new service,
  state owner, wire contract, checkpoint behavior, or history-depth change.
- Replace the precise-import function's single-element resource list with a
  scalar resource; delete its redundant loop, arity checks, and chunk helper.
- Derive total source reads from all collected job timings in the existing
  finished-pass log, before the slowest-job sample is selected. This adds no
  requests and is measurement only.

## Evidence and review

- [x] Verify and merge the preceding source-read simplification.
- [x] Obtain and inspect Pro's implementation patch against current source.
- [x] Preserve continuation identity and source fences through SQLite restarts.
- [x] Run 159 source-admission/reuse/provider tests and 16 focused service/store tests.
- [x] Run the focused full-total versus sampled-timing regression.
- [x] Pass device-syncd and assistant-runtime typechecks on the final code.
- [x] Pass complexity diff: Junction debt 406 to 405; precise import 42 to 41;
  maintenance debt remains 105. Other changed-file hotspots are unchanged.
- [x] Parent candidate review: privacy, source ownership, terminal boundaries,
  scalar-resource equivalence, restart fencing, and current wire compatibility.
- [ ] Final exact-head ReviewGPT, required CI, final parent review, and merge.

## Limits and release

Synthetic consecutive segments prove one removed snapshot lookup per qualifying
intermediate segment. Do not extrapolate slowest-job samples to the full workload
or count already-merged savings twice. A matched deployed observation must confirm
net request volume: saved time may allow a bounded pass to process more history.

Runtime-only behavior and a diagnostic JSON field preserve existing Web/Worker
contracts and persisted continuation payloads. Old and new runtimes can consume
the same queued jobs. Deploy through the existing runtime release pipeline and
confirm the serving revision before measuring source reads and total requests.

The managed download rejected its own capture identity due to the existing
rendered-text normalization issue tracked by repository Frog entry
`20260826141410-reviewgpt-detached-wake`. Recovery verified exact user/assistant
message IDs, response equivalence apart from the language badge, model, and the
sole artifact before downloading. No prompt was resent.

Changelog: internal request overhead and diagnostic accuracy; no new member-facing
feature, action, or promised sync freshness change.
