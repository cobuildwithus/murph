# PR 769 lazy shared-data boundary

## Goal

Finish PR 769 so group challenge updates include every current member and
explain missing data without adding work to the model-start critical path.

The model starts with the existing request shape. Shared group projections are
read only after the model invokes a typed group tool.

## Hard requirements

- Add no awaited request, filesystem operation, projection work, sandbox
  setup, or configuration reload before App Server `turn/start`.
- Return every current group member and every requested projection, including
  explicit `not_granted`, `granted` plus `missing`, and `available` states.
- Keep permission offers server-authored. A chat reaction grants only the
  disclosed Murph group scopes; it never grants an OS health permission.
- Expose device diagnostics only under an active explicit grant and only as
  bounded public labels, coarse state, and honest sync timestamps.
- Never persist plaintext shared projection data in Web and never return share
  ids, handles, connection ids, provider account ids, credentials, metadata,
  or private error details to the model.
- Prefer deletion: no new table, service, queue, mailbox lane, local projection
  store, generation counter, foreground permission profile, or trust marker.

## Architecture

Use the existing `HostedVaultShare` row as the single authority and snapshot
owner:

1. Add one nullable encrypted replacement-snapshot column. Health projection
   delivery encrypts the complete bounded record set under the destination
   member's existing secure-box root and conditionally replaces the exact
   active share row. An encrypted empty record set means observed but missing;
   `null` means not supplied yet.
2. Revoke and regrant clear the ciphertext in the same authority transaction;
   regrant also rotates the share id. A stale producer therefore cannot write
   into a later grant generation.
3. Add runtime-internal group action `read_shared`. Web captures the current
   group roster and exact active grants, decrypts only those captured rows,
   and returns the complete bounded consent/data matrix. Profile labels come
   only from the separately granted profile snapshot.
4. Treat `device-sync-status.v0` as consent-only state. Web derives it live
   during `read_shared`; the grantor runtime does not fetch or persist a device
   projection.
5. Make the assistant runtime reader a synchronous no-I/O adapter. The only
   Web call occurs inside its model-triggered `request` method. Scheduled,
   notification, foreground, warm, cold, and detached-Ask paths reuse it.
6. Stop restoring legacy shared-projection subtrees. Remove model and
   newsletter dependence on the local store. Recognize retired mailbox rows
   from their plaintext kind/route metadata and terminally skip them before
   payload fetch or decryption.

## Tool result

`murph.group action="read_shared"` accepts one to three unique exact selectable
projection scopes. A successful result contains every current member and, for
each requested scope:

- `grantStatus: granted | not_granted`
- `dataStatus: available | missing`
- at most seven strict records

`none` means no current hosted group. Authority, decryption, parsing, or bound
failures return a typed `unavailable` result without projection data. A real
zero remains available data.

## Work plan

1. Add the encrypted snapshot column, strict snapshot crypto contract,
   replacement write, revoke/regrant clearing, and direct Web read.
2. Replace eager/local authority and projection reads with the lazy adapter;
   derive device status live under consent and remove the runtime projector.
3. Update group challenge, group chat, and newsletter guidance for complete
   standings and member-specific next actions without guessing causes.
4. Exclude legacy projection files on restore and delete superseded profile,
   gate, local-reader, and provider plumbing.
5. Run focused tests/typechecks, zero-start-order proof, required completion
   audits, acceptance verification, exact-head ReviewGPT, and PR CI.

## Verification

- Actual App Server tests prove cold start and warm resume write `turn/start`
  and enter provider start before any shared-data request.
- Foreground, scheduled notification, and detached-Ask tests prove reader
  construction and model admission make zero group-port calls.
- Web tests prove encrypted replacement, empty snapshots, stale-writer
  rejection, revoke/regrant clearing, complete roster/status matrices, real
  zero preservation, device consent gating, privacy, corruption behavior, and
  strict bounds.
- Snapshot restore tests prove legacy shared-projection trees are excluded and
  unrelated workspace data is preserved.
- Relevant package tests/typechecks, `git diff --check`, acceptance checks,
  required local audits, ReviewGPT, and GitHub checks pass on the pushed head.

## Deployment concerns

Roll and restart the Cloudflare runtime first so every runner ignores local
shared data and restore excludes legacy projection paths; do not run a
foreground cleanup pass. `read_shared` fails closed during the bounded interval
before old Web understands the action. Then apply the nullable migration and
deploy the Web snapshot producer/read support. New projection offers then
replace the encrypted snapshots during ordinary runtime work; there is no
mailbox drain, cleanup wake, or local reconciliation step. The runtime cut is a
rollback floor because later writes no longer refresh the legacy local store.

## Completion evidence

- Prepared Web typecheck, the 5,863-test Web suite, production build, and the
  1,842-test Cloudflare suite passed after merging current `main`.
- Focused Web, hosted-boundary, assistant-runtime, assistant-engine, CLI, and
  restore suites passed, including cold/warm zero-prestart-read proofs.
- The acceptance run completed every feature-relevant lane. Its four
  untouched-package failures were isolated: core, setup, and both triggering
  assistant-engine lifecycle tests passed alone; the CLI assertion came from
  a stale installed ReviewGPT package while the unchanged tracked lockfile
  selects the corrected version.
- Required security/privacy, simplification, frontend, coverage, and final
  diff-hygiene audits reported no blocking findings.
- Exact pushed-head ReviewGPT and GitHub checks remain the PR-lane gates after
  this plan is archived and committed.
Status: completed
Updated: 2026-07-18
Completed: 2026-07-18
Completed: 2026-07-18
