# Conversation-First Wearable Lifecycle

## Goal

Let the hosted assistant complete wearable account inspection, reconciliation,
and confirmed disconnects through the existing typed `vault-cli device account`
surface while keeping `apps/web` as the sole hosted device-control authority.

## Constraints

- Reuse the existing web-owned hosted device connection state and mutation
  services; do not add persisted state, another provider registry, or a local
  daemon fallback for hosted execution.
- Keep OAuth and provider consent as the narrow browser-owned handoff.
- Require explicit conversational confirmation before disconnect.
- Preserve Junction connection-wide reset scope and surface
  `historicalResetIncomplete` plus upstream-revocation/manual-removal warnings.
- Keep the hosted runtime and Cloudflare layers transport-only and signed.
- Preserve unrelated work and leave commit, push, PR creation, and ReviewGPT to
  the parent task.

## Plan

1. Trace the typed CLI account commands through local and hosted services and
   identify the narrow reusable web authority operations.
2. Extend the hosted device runtime contract and signed web callback boundary
   for account show/status, reconcile, and disconnect without adding state.
3. Route hosted CLI account operations through that boundary while retaining
   the existing local control-plane behavior outside hosted execution.
4. Add focused authority, warning/confirmation, bridge, and CLI regression
   coverage plus one direct hosted scenario proof.
5. Update durable hosted device-sync boundary docs and run the truthful
   diff-aware verification lane.

## Verification

- Focused tests for confirmed disconnect, Junction reset scope, incomplete
  upstream revocation, status/show, and reconcile routing.
- Package typechecks for the touched contract, runtime, CLI, web, and
  Cloudflare packages.
- `git diff --check` and privacy-sensitive diff review.
- Parent-owned completion audits and diff-aware broad verification after the
  implementation handoff.

## State

Implementation, required specialist audits, focused verification, and the
parent final review are complete. The hosted CLI now shows through a
credential-free runtime snapshot, while reconcile and confirmed disconnect
return minimal receipts directly from one signed web-owned account-action
authority. No persisted runtime state or local-daemon fallback was added. The
scoped diff is ready for `scripts/finish-task`, base reconciliation, and the
PR-lane ReviewGPT/CI gates.

## Done

- Added typed device-sync and CLI-bridge account-action contracts.
- Added the signed Cloudflare-to-web account-action callback and allowlist.
- Reused the canonical web scheduled-wake and disconnect owners, preserving
  upstream revoke and `historicalResetIncomplete` warnings.
- Required explicit hosted `--confirm` and added conditional Junction
  connection-wide conversational guidance.
- Added focused contract, runtime bridge, web authority, Cloudflare adapter,
  CLI, and assistant prompt tests plus durable architecture/command docs.
- Required the active runtime write fence before Cloudflare forwards hosted
  account mutations.
- Removed caller-supplied member identity from the account-action body and
  response; the signed callback member is the sole ownership key.
- Made account-action payloads strict and action-discriminated, including
  literal disconnect confirmation and disconnect-only warnings.
- Removed post-mutation snapshot reads so a successful reconcile or disconnect
  cannot be reclassified as a generic failure or lose its one-shot warning.
- Bound hosted disconnect to the exact `connectedAt` epoch from the approved
  show result and reject a reconnect/stale confirmation under the initial web
  connection lock before any provider revoke.
- Focused tests passed for device-syncd (73), hosted execution (9), assistant
  runtime (19), assistant prompt behavior (53), web authority (37), Cloudflare
  platform (116), and the new CLI lifecycle case (1; 17 filtered/skipped).
- Audit-focused tests passed for web account actions (2), the Cloudflare write
  fence (2), and signed-member account forwarding (1). Typechecks passed for
  device-syncd, hosted execution, operator config, assistant runtime, CLI,
  Cloudflare, and web; `git diff --check` passed.
- The security/privacy re-audit reached a zero-finding stop after proving the
  required `expectedConnectedAt` epoch remains intact across CLI, bridge,
  runtime, Cloudflare, and the signed web owner, where it is checked inside the
  initial connection mutation lock before credential reads or provider revoke.
- The required coverage-write audit added two narrow assertions that the
  stale-connection epoch is read inside that lock. The focused web suite passed
  58/58 and found no remaining proof gap across the full authority path.
- The broad diff-aware lane passed repository guards, every wearable owner
  typecheck, and all reached wearable tests. Its only failures were unchanged
  Linq-audio and setup fixtures that cannot reach the new device-account path;
  the focused owner suites above remain the direct feature proof.
- Parent final review re-walked account show, explicit disconnect confirmation,
  epoch binding, runtime bridge lifetime, active write-fence enforcement,
  signed-member forwarding, web-owned reconcile scheduling, provider revoke,
  warning preservation, and canonical disconnect mutation. The scope remains
  proportional and adds no persisted state, registry, or hosted local-daemon
  fallback.

## Now

Close this plan and create the scoped implementation commit with
`scripts/finish-task`.

## Next

Rebase the isolated branch onto current `origin/main`, rerun conflict-affected
proof, push it, and open the draft PR with the required intent and deployment
skew contract. Run ReviewGPT to zero accepted findings in parallel with
final-head CI, then prove a clean merge against current `main`.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
