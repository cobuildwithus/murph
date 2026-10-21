# Isolate biweekly usage review from chat history

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Outcome and protected invariant

The built-in usage review starts with its own provider context and leaves the
member conversation resume binding intact. It still reviews the same permitted
automations, respects explicit model preferences, submits at most one anonymous
audit, and sends no member message.

## Evidence and owner

The managed record says `fresh`, but cron clears only explicit session pins;
conversation locators still select the member session. Notification turns use
the ordinary session-thread profile and persist the review thread back into chat.
The notification owner already has an isolated conversation/provider-turn profile
and the optimizer owner already verifies exact private hosted occurrence scope.
Reuse both; add no state, cache, dependency, profile, or new scheduling policy.

## Scope

The exact hosted usage optimizer adopts isolation. Resume persistence derives
from the resolved thread scope, also preserving the foreground binding for
existing isolated creative/operator profiles. The explicit context-handoff reset
still clears it. Ordinary reminders, group turns, morning context, model pins,
tool authority, canonical records, and delivery ownership retain their current
behavior. Existing canonical context remains available for saved preferences.

## Product UX

- Outcome: the silent review avoids unrelated chat history and preserves chat continuity.
- Reaches: valid optimizer occurrences with or without a prior thread; failure;
  invalid authority and ordinary/group scheduled turns remain unchanged.
- Proof: deterministic notification admission/resume tests, complete synthetic
  first-provider-input comparison, and a production-derived live quiet audit.

## Failure and compatibility

Success and terminal failure both preserve the existing foreground binding.
The change is internal to one engine bundle, adds no persisted shape or protocol,
and can be reverted without a data migration. Existing native App Server process
ownership and tool/delivery checks remain authoritative.

## Tasks and verification

1. Prove old history inclusion and scope/resume gap with focused regressions.
2. Reuse the existing isolated profile at the authorized notification boundary.
3. Compare complete provider requests against the task base using synthetic
   individual/group fixtures; report exact tokenizer unavailability honestly.
4. Run relevant deterministic tests, typecheck, complexity guard, and one focused
   real-Codex optimizer journey; review quiet output and exact owned effects.
5. Review privacy and complete diff, update architecture owner, commit and open
   draft PR. Parent owns candidate review, Ready transition, CI and ReviewGPT.

## Results

- Deterministic base reproduction failed authorized optimizer admission and
  failure-resume preservation; the implemented version passes 218 notification
  and turn-planning tests, including ordinary/group/invalid-authority exclusions,
  creative/operator isolation, and the existing context-handoff reset.
- `pnpm --dir packages/assistant-engine typecheck` passes.
- `pnpm build:test-runtime:prepared` passes; no shared generated artifacts.
- `pnpm complexity:diff` passes; notification-owner debt 57 and maximum 68 stay
  unchanged. Existing large orchestration functions need no unrelated refactor.
- Complete native first-provider requests against base `14be5174d566`:
  private fixture 142,058 -> 137,983 UTF-8 bytes (-4,075; -2.87%); group
  112,241 -> 112,241. Only the private request drops seeded unrelated history.
  Exact Sol tokenizer unavailable; no token or allowance savings estimate.
  Captures include every provider-visible field except transport prompt cache key.
  Full requests remain in memory; only bounded synthetic metrics are emitted.
- The local canonical launcher requires an unavailable native patch. A separate
  credential-free native preflight confirms the hosted macOS permission profile
  cannot launch installed Node because access to system OpenSSL config is denied.
  No permissions were widened. The focused local subscription journey uses the
  existing synthetic inventory boundary populated by the actual shipped CLI;
  notification planning, provider/session lifecycle, inspection, patch, report,
  quiet decision, and foreground resume still use their production owners.
- Live pass: `pnpm test:assistant:live -- --test 'isolates the silent optimizer
  while preserving canonical preferences and chat continuity'`, GPT-6.1 Sol,
  local subscription. One inventory and diagnostics read; two canonical
  inspections; one Luna patch; explicit Sol preference unchanged; one private
  report; no message/outbox; exact foreground resume binding unchanged; final
  foreground reply correctly recalls the synthetic conversation-only label.
  Reply review: Ready for this quiet path and follow-up; hosted launcher/CLI
  sandbox parity remains the explicit limitation above.
- Changelog: internal review-execution pilot; no new member flow or verified
  allowance/latency improvement claimed. Existing conversation behavior is preserved.
- Parent owns candidate review, Ready transition, exact-head CI and ReviewGPT.
Completed: 2026-10-20
