# PR 992 referral completion remediation

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Make usage-referral offers and completions timely, model-aware, difficult to game, and funny in the room’s actual style without adding another queue, state machine, or transcript projection.

## Success criteria

- Only stable, idempotent phone-call and usage-referral completion notifications may interrupt a dirty runtime’s idle checkpoint window.
- The recovery pass re-signals an existing unconsumed referral-celebration mailbox item after an earlier Temporal signal failure.
- Referral reads and completion celebrations derive an approximate message reward from the beneficiary’s current effective model; Luna uses an honest nonnumeric fallback.
- The active-group user-facing policy hides exact qualification counters while the server keeps enforcing them.
- The hosted low-usage prompt uses the mom proposal as a comedy-shape example, keeps Murph as the butt of the joke, avoids absent-person degradation, and does not lead with signup or a link.
- Automatic celebrations receive only the effective tone, Humor, and Unhinged band needed to match the destination; no transcript or raw room model enters the notification.

## Scope

- In scope: referral policy/read/celebration/recovery owners, safe pre-checkpoint notification classification, low-usage prompt guidance, focused tests, and current referral/runtime owner docs.
- Out of scope: reward amounts, qualification thresholds, referral schema, provider routes, general notification admission, raw transcript access, a new comedy-hint store, and unrelated low-usage billing behavior.

## Constraints

- Preserve exact-source delivery, reward idempotency, mailbox ordering, foreground priority, privacy, and the feature’s disabled rollout floor.
- Derive recovery from the existing referral row and unconsumed mailbox item.
- Admit no generic `assistant.notification.requested` class before checkpoint.
- Keep anti-gaming counters server-only and retain their executable tests.
- Preserve unrelated mailbox consumed-watermark and thread-context prompt work.

## Tasks

1. Add focused failing proof for safe completion admission and failed-signal re-handoff.
2. Derive model-aware reward labels and a narrow effective style band at the Web owner.
3. Update prompt policy and referral docs for comedy shape, absent-person consent, reciprocal setup, and hidden counters.
4. Run focused tests and typechecks, then canonical diff and acceptance verification.
5. Complete product-experience, preliminary specialist, parent final, final ReviewGPT, and CI gates; commit and push the exact reviewed PR head.

## Verification

- Focused dirty-runtime proof: the phone-call result and usage-referral
  celebration import before `idle_shutdown`; a generic notification remains
  checkpoint-gated (3/3).
- Focused Web referral policy, tool, and recovery suites: 16/16.
- Hosted Web prepared typecheck: passed.
- Hosted low-usage prompt regression suite: 4/4.
- Direct production-function scenario: group Sol resolved to `about 50 more
  messages on the model this room is using now`; the stable referral event id,
  style band, and no-transcript instruction were present.
- Canonical `pnpm test:diff` cleared repository guards, all affected
  typechecks, Assistant Engine (2,750 passed / 6 skipped), Assistant CLI
  (128/128), Assistant Runtime (1,903 passed / 2 skipped), and Assistantd
  (40/40). The owned run was stopped after unrelated CLI subprocess
  starvation caused eight unchanged assistant-command tests and seventeen
  unchanged workout-command tests to hit their exact 60-second timeouts under
  host-wide verifier contention.
- Product-experience review: `NO FINDINGS`. Evidence gaps remain for one live
  failed-signal-to-provider-delivery journey and live model-output samples
  across restrained and rowdy style bands; component ordering, recovery
  selection, prompt policy, and the production notification builder are
  directly proven.
