# Codex app-server hot layer

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Remove the pathological first-turn Codex app-server startup pause observed on
  otherwise healthy cold runner invocations.
- Keep the runtime ownership model unchanged: no new scheduler, lifecycle
  state, cancellation path, or foreground/background handoff.

## Product UX

- Effort: Patch.
- Outcome: Reduce avoidable waiting before the first hosted reply after an
  idle runner wakes.
- Reaches: The existing cold conversation path between restored mailbox input
  and provider start; message content, delivery, and recovery stay unchanged.
- Proof: The image contract proves the native provider runtime is promoted
  into the final lazy-load hot layer, native image CI proves the command and
  sandbox still work, and post-deploy timing verifies the actual latency gain.

### Walkthrough

- Person and path: An existing hosted member sends a conversation message
  after idle time and receives the same reply through the same channel.
- Evidence: Production metadata isolates the avoidable wait to native process
  first use; the candidate changes only where those exact pinned files live in
  the image.
- Differences from plan: None.
- Result: Ready for image CI and canary deployment; the latency claim remains
  subject to the post-deploy timing check.

## Evidence

- Production metadata-only traces isolate the slow interval to Codex
  app-server `node-process-first-use`, with repeated double-digit-second tail
  waits after mailbox import while Node startup itself remained healthy.
- The pinned Codex native binary and its runtime resources currently live in a
  heavyweight base-image layer. Cloudflare's lazy image loading can therefore
  fault that process hot set only when the first provider turn begins.
- The final runner image already uses a compact application layer to improve
  lazy-pull Node startup. The same image-owned technique is the smallest owner
  for the Codex process hot set.

## Protected invariants

- Preserve the exact pinned Codex CLI bytes and adjacent runtime resources.
- Preserve the existing `/usr/local/bin/codex` command and runtime user.
- Do not change mailbox ordering, provider inputs, process ownership, fencing,
  checkpointing, or warm-process reuse.

## Scope

- In scope: a dedicated final-image Codex hot-set layer, image-contract proof,
  and the smallest durable image documentation needed to explain the layer.
- Out of scope: provider changes, runtime prewarm state, extra child processes,
  workspace restore changes, Temporal changes, and broad image shrinking.

## Verification

1. Add a focused image-contract test that proves the hot layer preserves the
   native Codex layout and final command path.
2. Run the focused container image contract and affected Cloudflare typecheck.
3. Build or inspect the exact runner image when the local Docker executor is
   available; otherwise require the repository's exact-head image CI.
4. Push the candidate, run the required preliminary specialist and final
   ReviewGPT gates concurrently with CI, and resolve every accepted finding.

## Deployment concerns

- The change is runner-image-only. It requires a new immutable runner image and
  Cloudflare container rollout; Web and Temporal contracts remain compatible.
- Post-deploy proof must compare cold `node-process-first-use` p50/p95 and
  accepted-to-provider latency without exposing member or attempt identifiers.
