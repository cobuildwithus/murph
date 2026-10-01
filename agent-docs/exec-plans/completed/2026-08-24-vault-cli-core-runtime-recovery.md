# Make Vault CLI core and assistant failures model-recoverable

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Make proven Vault CLI core, automation, batch, assistant, configuration, and doctor failures return bounded, secret-safe structured details that let a calling model repair its arguments or choose the next safe action.
- Preserve the foundation transport and each current state owner; fix classification at the smallest owner-local boundary.

## Product UX Patch

- Outcome: a calling model receives the real failure class, retryability, affected field or surface, and a safe recovery action instead of `UNKNOWN`, `Read failed.`, or a buried child error.
- Reaches: weekly wall-clock automation save/import, batched child commands, daemon-backed assistant calls, onboarding resume context, one-shot automation runs, vault init/repair, self-target configuration, and assistant doctor diagnostics.
- Proof: focused full-envelope tests cover exact codes, field paths, retryability, non-echo behavior, partial failures, and fail-closed no-overwrite behavior.

## Success criteria

- Weekly cron schedules with an IANA `timeZone` save through typed automation fields, while invalid internal schedule/route/override/save/import values return field-specific validation details.
- Batch lifts a failed child's structured JSON error envelope into the per-command result instead of collapsing it to the child exit status.
- Daemon transport, auth, HTTP, and response-contract failures return typed, bounded, secret-safe errors with correct retryability.
- Onboarding resume-context surfaces distinguish unavailable from failed reads and preserve bounded safe recovery metadata.
- One-shot assistant runs expose a bounded structured partial-failure summary without changing partial-success semantics.
- Known core init/repair errors are mapped into model-recoverable CLI errors.
- Malformed operator config cannot be silently treated as absent or overwritten by self-target mutations.
- Doctor distinguishes read failures from parse failures.
- Focused tests, package typechecks, diff/privacy inspection, and scoped commit all pass.

## Scope

- In scope: VCE-004 through VCE-009 proven paths; malformed operator-config fail-closed handling; doctor read-versus-parse classification; exact final-envelope tests.
- Out of scope: foundation transport changes, new logging services, raw error/context serialization, hosted runtime behavior changes, unrelated CLI families, deployment, push, PR creation, and ReviewGPT execution.

## Constraints

- Technical constraints: reuse `VaultCliError` and foundation error-detail transport; allowlist safe fields only; keep partial-success semantics; avoid new dependencies or persisted state; preserve existing package ownership and public entrypoints.
- Product/process constraints: no private paths, payloads, tokens, daemon response bodies, or raw operator config in errors/tests; preserve unrelated work; finish with `scripts/finish-task`; parent owns PR and review gates.

## Risks and mitigations

1. Risk: richer errors leak private paths, daemon bodies, or configuration content.
   Mitigation: expose only allowlisted codes, status classes, field paths, retryability, and synthetic recovery hints; assert non-echo behavior.
2. Risk: error mapping changes successful behavior or retries unsafe work.
   Mitigation: map only proven failure boundaries, retain success shapes where possible, and classify retryability conservatively.
3. Risk: schema expansion breaks existing consumers.
   Mitigation: use additive optional result fields and retain current aggregate counters/status values.
4. Risk: malformed config recovery overwrites user settings.
   Mitigation: distinguish missing from malformed and fail all self-target mutations closed before writes; prove file bytes remain unchanged.

## Tasks

1. Inspect foundation error contracts, affected owner implementations, and focused tests at the exact base.
2. Implement automation internal validation and weekly cron/time-zone support.
3. Implement batch child-error lifting and daemon typed failure mapping.
4. Implement truthful onboarding surfaces and bounded run-once partial failures.
5. Implement core error mappings, malformed-config fail-closed behavior, and doctor read-versus-parse classification.
6. Add focused final-envelope, non-echo, retryability, partial-failure, and no-overwrite tests.
7. Run focused tests/typechecks, complete the Product UX walkthrough, inspect diff/LOC/privacy, and commit with `scripts/finish-task`.

## Decisions

- Keep the existing foundation envelope transport unchanged; use its safe detail fields rather than extending Incur again.
- Treat this as a Product UX Patch because it restores recoverability without adding a new product promise or authority relationship.
- Keep batch and run partial failures as successful aggregate commands with additive structured failure detail.
- Preserve the hosted automation support-ownership invariant. The reported cron expression and timezone are valid; the rejected request supplied `supportKind` without the paired `supportSeriesId`. The hosted tool already emits that field-specific repair, so this change adds exact regression proof rather than weakening the invariant.
- Fail malformed operator configuration closed for both model-default and self-delivery operations. Only a missing file is treated as absent; invalid bytes remain untouched.

## Verification

- Passed: 10 focused Vitest files across CLI, assistant CLI, assistant engine, operator config, and vault usecases; 296 tests total.
- Passed: package typechecks for CLI, assistant CLI, assistant engine, operator config, and vault usecases.
- Passed: CLI dependency-closure build, generated Incur contract refresh, and package-shape verification.
- Passed: `git diff --check`, added-cast guard, and privacy-safe diff inspection.

## Outcomes

- Weekly cron and daily-local CLI schedules now accept an optional IANA timezone through canonical and legacy typed flags. Internal schedule, route, target-override, save, and import parsing now returns bounded validation-stage field repairs instead of raw schema exceptions.
- Batched commands retain the child command's safe structured error, including code, retryability, stage, hint, and field errors.
- Daemon configuration, connection, response-stream, authentication, HTTP, JSON, and response-schema failures now have stable codes and conservative retryability without response-body or cause echo.
- Onboarding resume context distinguishes a missing service from a failed read, and one-shot runs retain their aggregate result while exposing the latest bounded safe partial failure.
- Known vault initialization and metadata failures map to stable recovery instructions; malformed operator config blocks every affected mutation without overwriting bytes; doctor reports read and parse failures separately.

## Product UX walkthrough

- Recurring wall-clock automation: a valid Sunday cron in New York persists unchanged. An unpaired support ownership field returns `supportSeriesId` as the repair target; malformed CLI cron/import fields return their exact safe paths.
- Batch and daemon: the calling model sees whether to change input, repair authorization/configuration, or retry transport instead of receiving child exit status or daemon body text.
- Onboarding and run-once: partial or unavailable surfaces stay truthful without collapsing the whole snapshot or hiding a failed reply.
- Configuration and diagnostics: malformed operator settings remain recoverable in place, while unreadable files are no longer mislabeled as malformed JSON.
Completed: 2026-08-24
