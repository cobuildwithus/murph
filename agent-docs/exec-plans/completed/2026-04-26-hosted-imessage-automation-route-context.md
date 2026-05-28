Goal (incl. success criteria):
- Stop assistant turns from exposing the provider name `linq` to users and make hosted iMessage thread bindings usable as the route for user-requested reminders/automations.
- Success: model-facing context labels `linq` as iMessage while preserving the internal `linq` route token, and tests cover the reminder-route guidance.

Constraints/Assumptions:
- Do not touch hosted Cloudflare runner coordination unless static tracing proves it owns the bug.
- Preserve active hosted Linq, hosted self-target, and assistant prompt work in the shared tree.
- Do not log or fixture real contact identifiers, secrets, local paths, or personal identifiers.

Key decisions:
- Treat `linq` as an internal provider/channel identifier and `iMessage` as the user-facing label.
- Prefer model-facing binding context over a broader hosted runner refactor for this narrow issue.

State:
- Active.

Done:
- Traced reminder routing to assistant automation authoring and provider binding context.

Now:
- Patch iMessage alias normalization at assistant context, self-target, CLI lookup, and automation route boundaries.

Next:
- Run focused assistant-engine tests plus typecheck or scoped verification as feasible in the dirty tree.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: production hosted vault already has a current linq/iMessage session binding for the affected conversation; code should still avoid pretending delivery is wired if no binding exists.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/bindings.ts`
- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/src/assistant/channels/descriptors.ts`
- `packages/assistant-engine/src/assistant/channels/runtime.ts`
- `packages/assistant-engine/src/assistant-cli-tools/capability-definitions.ts`
- `packages/assistant-engine/test/assistant-bindings.test.ts`
- `packages/assistant-engine/test/codex-runtime-helpers.test.ts`
- `packages/operator-config/src/operator-config/self-delivery-targets.ts`
- `packages/operator-config/test/operator-config-seam.test.ts`
- `packages/assistant-cli/src/commands/assistant.ts`
- `packages/assistant-cli/test/assistant-command-coverage.test.ts`
- `packages/core/src/automation.ts`
- `packages/core/test/assessment-automation-thresholds.test.ts`
