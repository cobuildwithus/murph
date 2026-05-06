# Venice Onboarding Provider

Goal (incl. success criteria):
- Add a clean Murph onboarding path that lets an operator select Venice.ai as the assistant model provider, enter a Venice API key, choose a model, and run through the existing Codex App Server assistant runtime.
- Success means Venice is represented as a normal Codex Responses model provider, setup persists only the local env key value through the existing setup env path, assistant execution receives provider config through Codex config overrides, and no second Venice-specific assistant runtime exists in Murph.

Constraints/Assumptions:
- Preserve the Codex App Server hard cut: Murph must not add a direct Venice/OpenAI-compatible assistant runner.
- Treat Venice `/responses` as available but Alpha. Setup should surface provider validation failures clearly instead of silently switching transport.
- Use `VENICE_API_KEY` as the env var name. Never store the raw API key in operator defaults, assistant runtime state, logs, docs, or Codex config overrides.
- Prefer provider-registry-owned metadata over UI-specific branching.
- Keep hosted support out of scope for the first pass unless hosted secret forwarding and billing policy are explicitly designed.
- Adding Venice to the shared provider registry must not make hosted Venice ready by accident. Hosted provider readiness stays behind explicit hosted-owned allowlists, not local onboarding metadata.
- Local Codex execution may receive `VENICE_API_KEY` through the normal local process environment because Codex App Server is the privileged local adapter. Hosted direct-CLI env projection must not be widened for Venice in this task.
- Codex shell/tool commands must not receive `VENICE_API_KEY` through new Murph include lists or policy overrides. Do not loosen Codex shell environment filtering for Venice.
- Preserve unrelated dirty work and active ledger rows.

Key decisions:
- Add Venice as a known `AssistantCodexModelProviderConfig` with `wireApi: 'responses'`, `baseUrl: 'https://api.venice.ai/api/v1'`, and `envKey: 'VENICE_API_KEY'`.
- Keep `assistantCodexModelProviderWireApiValues` unchanged for now because Venice can use Codex's existing Responses transport.
- Extend setup/onboarding around a provider selection result, not around a provider-specific special case.
- Build Codex config overrides from `modelProviderConfig` at execution time instead of mutating the user's global Codex config.
- Prompt and persist the selected provider's env key through the existing setup runtime-env override path.
- Let the operator provide the Venice model id during setup. Do not hard-code a long-lived Venice model default unless the provider registry carries an explicitly maintained default.
- Keep provider table definition in Codex `--config` overrides and keep per-thread provider selection on the existing `modelProvider` app-server input.
- Skip ChatGPT/Codex account detection for API-key model-provider paths. Account probing is only meaningful for the sign-in path.
- Intentionally use Codex `env_key = "VENICE_API_KEY"` instead of Venice's sample `experimental_bearer_token` form. Raw-token config is incompatible with Murph's secret boundary.
- Keep `envKey` as the single credential source of truth. Do not duplicate it as `envKeys`.

State:
- completed and committed

Done:
- Verified Venice docs and OpenAPI spec show `POST /api/v1/responses` as a Responses API Alpha endpoint.
- Verified Venice's Codex CLI guide uses Codex `model_provider = "venice"` with `wire_api = "responses"`.
- Verified Murph already models Codex provider configs in `packages/operator-config/src/assistant/target-runtime.ts`.
- Verified setup currently distinguishes only ChatGPT/Codex sign-in, local Codex model, and skip.
- Ran three subagent stress reviews covering runtime architecture, setup shape, and security/privacy. Incorporated their shared corrections into this plan.
- Implemented Venice as a provider-registry Codex Responses provider with local-onboarding metadata and no hosted-ready metadata.
- Implemented provider/model resolution before secret prompting, provider-derived `VENICE_API_KEY` prompting, noninteractive `--assistant-model-provider venice`, structural model-id validation, and account-detection skip for API-key provider paths.
- Implemented Codex provider table overrides with `env_key = "VENICE_API_KEY"` semantics, reserved-provider guarding, provider/config mismatch guarding, and Venice-specific redacted runtime failure hinting.
- Implemented hosted fail-closed readiness around the hosted-owned OpenAI allowlist and added/updated negative tests.
- Ran required review-gpt autosend twice with guarded zip attachments. Both submissions completed/staged successfully; response capture/export exposed no usable review findings beyond ChatGPT thinking/status text.
- Ran local simplify, security/privacy, and coverage/proof audit subagents. Simplify findings were applied; security/privacy and coverage/proof found no additional required changes.
- Ran final completion review. It found one full-wizard provider-preservation gap; fixed with separate current-provider list helpers for the full wizard and standalone assistant picker plus a Vercel AI Gateway preservation regression.

Now:
- Done.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether Venice `/responses` Alpha access is enabled for every API-key user. The implementation should fail clearly if a user's key cannot access the endpoint.
- UNCONFIRMED: whether Venice exposes a stable recommended model id suitable as a Murph default. Until confirmed, prompt for the model id.
- UNCONFIRMED: whether the installed Codex App Server accepts `modelProvider` on `thread/start` for custom provider ids in the same way Murph's adapter expects. Prove this before relying on provider-table-only overrides.

Working set (files/ids/commands):
- `packages/operator-config/src/assistant/target-runtime.ts`
- `packages/operator-config/src/assistant/provider-config.ts`
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/operator-config/src/setup-runtime-env.ts`
- `packages/setup-cli/src/setup-assistant-wizard.ts`
- `packages/setup-cli/src/setup-wizard.ts`
- `packages/setup-cli/src/setup-wizard-app.ts`
- `packages/setup-cli/src/setup-cli.ts`
- `packages/setup-cli/src/setup-assistant.ts`
- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/src/assistant-cli-access.ts`
- `packages/operator-config/test/assistant-provider-config*.test.ts`
- `packages/setup-cli/test/setup-assistant*.test.ts`
- `packages/setup-cli/test/setup-wizard.test.ts`
- `packages/assistant-engine/test/assistant-cli-access.test.ts`
- Venice docs: `https://docs.venice.ai/llms.txt`, `https://docs.venice.ai/guides/integrations/codex-cli`, `https://api.venice.ai/doc/api/swagger.yaml`

## Implementation Shape

### 1. Provider Registry

Add Venice beside the existing OpenAI and Vercel AI Gateway provider configs:

```ts
export const VENICE_CODEX_MODEL_PROVIDER_ID = 'venice'

export const VENICE_CODEX_MODEL_PROVIDER_CONFIG = {
  id: VENICE_CODEX_MODEL_PROVIDER_ID,
  name: 'Venice.ai',
  baseUrl: 'https://api.venice.ai/api/v1',
  envKey: 'VENICE_API_KEY',
  wireApi: 'responses',
} as const satisfies AssistantCodexModelProviderConfig
```

Then include it in `ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS`.

Do not add a Venice-specific type branch. Provider id normalization and config lookup should continue to work through the existing map.

Add a small local-onboarding view rather than scattering provider-specific UI checks. It may be an extension of `AssistantCodexModelProviderConfig` or a companion helper, but it should keep setup metadata registry-owned and avoid duplicating runtime facts:

```ts
{
  providerId: 'venice',
  selectableInLocalOnboarding: true,
  label: 'Venice.ai',
  description: 'Use Codex with a Venice API key.',
  modelPrompt: 'Venice model id to use with Codex',
  defaultModel: null,
}
```

Derive the required setup credential from `AssistantCodexModelProviderConfig.envKey`; do not add `envKeys` or any other second copy of `VENICE_API_KEY`.

Do not put `hostedSupported` in the shared/local provider registry. Keep the split explicit:
- `ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS`: known Codex provider definitions.
- `LOCAL_SETUP_CODEX_PROVIDER_IDS`: local onboarding choices.
- `HOSTED_ASSISTANT_ALLOWED_PROVIDER_IDS`: hosted-owned allowlist, if hosted provider selection needs one.

Hosted readiness must not treat every known local Codex provider as hosted-ready.

Use canonical provider metadata `baseUrl = 'https://api.venice.ai/api/v1'` without a trailing slash. Murph should serialize the base URL exactly and must not append endpoint paths; Codex owns joining the Responses endpoint to the provider base URL.

### 2. Codex Config Overrides

Change assistant-engine override building from a thinking-trace-only helper into a provider-aware helper that still returns plain Codex config override strings.

Target behavior is repeated Codex `--config` assignments, not a multi-line TOML block:

```ts
[
  'model_providers."venice".name="Venice.ai"',
  'model_providers."venice".base_url="https://api.venice.ai/api/v1"',
  'model_providers."venice".env_key="VENICE_API_KEY"',
  'model_providers."venice".wire_api="responses"',
]
```

Rules:
- Pass only the env var name, never the API key value.
- Do not emit `model_provider` as an override unless Codex requires it. Murph already passes the selected provider through the app-server `modelProvider` input, and that should remain the per-thread selector.
- Emit provider overrides only for known provider configs.
- If `assistantModelProvider` is non-null and no known config exists, fail before launching Codex. Do not silently omit overrides and let Codex fall back to OpenAI.
- Refuse to emit custom `model_providers.<id>` tables for Codex-reserved built-in ids: `openai`, `ollama`, and `lmstudio`. Providers that need a custom table must use a non-reserved id.
- Keep thinking-trace overrides independent so the two concerns compose.
- Escape provider ids and string values as TOML strings instead of relying on ad hoc concatenation.
- Add tests that assert the override strings do not contain sentinel secret-looking values.
- Never write `.codex/config.toml`, the user's Codex home, or project Codex config files.
- Add an adapter/protocol test proving `modelProvider: 'venice'` is serialized on `thread/start` and provider-bound resume/fork paths. If the installed app-server does not accept per-thread `modelProvider`, do not add a process-global `model_provider` override unless each run starts an isolated one-provider app-server process. A global selector would create cross-thread provider coupling.

### 3. Setup Selection Model

Replace the hard-coded assistant wizard choice model with a small registry-backed option layer.

Keep the public setup result simple:

```ts
type SetupAssistantWizardResult = {
  assistantModelProvider?: string | null
  assistantOss?: boolean | null
  assistantPreset?: Exclude<SetupAssistantPreset, 'skip'>
}
```

Thread `assistantModelProvider` through every setup result boundary that currently carries `assistantOss`/`assistantPreset`:
- `SetupWizardResolvedAssistantSelection`
- `SetupAssistantWizardResult`
- `SetupWizardResult`
- `SetupWizardAppResult`
- `createSetupCli` / `resolvedAssistantOptions`

Venice selection should resolve to:

```ts
{
  assistantPreset: 'codex',
  assistantOss: false,
  assistantModelProvider: 'venice'
}
```

Local model selection should remain `assistantOss: true` and should not set `assistantModelProvider`.

Noninteractive selection:
- `--assistant-model-provider venice`
- `--assistant-model <venice-model-id>`

Validation rules:
- `--assistant-model-provider` accepts only known local onboarding provider ids.
- It is invalid with `--assistant-oss`.
- It implies `assistantPreset = 'codex'` and `assistantOss = false`.
- If provider metadata has `defaultModel: null`, `--assistant-model` is required in noninteractive mode.
- Unknown provider ids fail before secret prompting and before Codex launch.

### 4. API Key Prompting

Extend setup runtime env prompting so the selected assistant model provider can contribute one required env key.

Concrete seam:

```ts
promptForMissing({
  assistantModelProvider,
  channels,
  env,
  helpText,
  wearables,
})
```

Resolver behavior:

```ts
const providerConfig =
  resolveAssistantCodexModelProviderConfig(assistantModelProvider)
const requiredEnvKey = providerConfig?.envKey
```

The selected assistant provider must be an input to the runtime-env prompt path, and the credential key must be derived from provider config.

Rules:
- If selected provider config has `envKey = 'VENICE_API_KEY'` and the key is missing, prompt with hidden input.
- Persist through the existing setup env override persistence path.
- Do not create a new secrets file or provider-specific persistence mechanism.
- Do not prompt for Venice if the user selected skip, local OSS, or a provider already satisfied by the environment.
- Provider/model resolution runs before provider secret prompting. If the selected provider has no maintained default model and no explicit model was provided, interactive setup prompts for the model first; noninteractive setup fails before requesting or persisting `VENICE_API_KEY`.
- The raw Venice key may appear only in `process.env` and the local `.env.local` written by the existing private env persistence path.
- The raw Venice key must not appear in wizard result details, operator defaults, assistant session/provider options, Codex override strings, logs, dry-run output, docs, snapshots, or test snapshots.

### 5. Model Prompt

When the selected provider is Venice:
- Prompt for `Model id to use with Codex`.
- Prefer the user's explicit `--assistant-model` if provided.
- Do not silently default to an OpenAI model id for Venice.
- In non-interactive setup, fail clearly if Venice is selected and `--assistant-model` is missing, unless provider metadata later supplies a maintained `defaultModel`.
- Validate model ids structurally only: trimmed, non-empty, single-line, and free of control characters.
- Do not rewrite model ids, map them to OpenAI defaults, or call Venice to validate them during setup.

If a maintained provider default is later added, it should live in provider metadata, not in setup UI logic.

### 6. Account and Validation Behavior

Keep Codex account detection for the ChatGPT/Codex sign-in path.

For API-key providers:
- Either skip account detection or report provider config/key presence only.
- Do not call a Codex account RPC path that assumes ChatGPT sign-in.
- Do not make direct Venice HTTP validation requests in the first pass. That would introduce a second provider execution path into setup.
- Let real validation happen through Codex App Server execution. If that fails, surface Venice Responses Alpha/access as a possible non-secret cause.
- When Codex App Server fails while `modelProviderConfig.id === 'venice'`, surface a redacted provider-specific hint:

```text
Venice via Codex Responses failed. Check VENICE_API_KEY, the Venice model id,
account balance/rate limits, and whether this key/model has Venice Responses API
Alpha access.
```

Do not include raw provider response bodies unless they already pass existing redaction.

### 7. Hosted Boundary

Do not add `VENICE_API_KEY` to hosted env forwarding in the first local onboarding pass.

Before adding Venice to the local Codex provider registry, audit hosted-adjacent residue:
- hosted env allowlists
- runner-secret policies
- deploy workflows
- local-hosted scripts
- runtime env profiles
- hosted readiness resolvers
- generated docs

Search for `VENICE_API_KEY` and `VENICE_`. Any existing hosted allowance that makes `HOSTED_ASSISTANT_PROVIDER=venice` runnable, hosted-ready, billable, seeded, or forwarded into hosted Codex execution is in scope to tighten or fail closed.

Do not touch or widen hosted provider/secret policy for Venice in the first pass, including:
- `HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES`
- `HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES`
- hosted runtime env profiles
- Cloudflare runner secret policy
- hosted Codex provider resolution/readiness
- hosted env seeding

Hosted Venice requires a separate design for:
- user-provided key storage and isolation,
- metering/billing behavior,
- secret projection into Cloudflare runner env,
- deploy compatibility and rollback behavior.

Add negative tests proving:
- `HOSTED_ASSISTANT_PROVIDER=venice` is not considered hosted-ready.
- `VENICE_API_KEY` is not forwarded into hosted Codex direct-CLI env.
- Adding Venice to local provider config does not alter OpenAI/Vercel hosted behavior.
- Provider credentials are omitted from hosted shell env include-only paths.
- No Venice path sets `shell_environment_policy.ignore_default_excludes = true` or adds `VENICE_API_KEY` to Codex shell/tool env include lists.

### 8. Verification

For implementation, run:
- `pnpm typecheck`
- `pnpm test:diff packages/operator-config/src/assistant/target-runtime.ts packages/operator-config/src/assistant/provider-config.ts packages/operator-config/src/assistant-cli-contracts.ts packages/operator-config/src/setup-runtime-env.ts packages/setup-cli/src/setup-assistant-wizard.ts packages/setup-cli/src/setup-wizard.ts packages/setup-cli/src/setup-wizard-app.ts packages/setup-cli/src/setup-cli.ts packages/setup-cli/src/setup-assistant.ts packages/assistant-engine/src/assistant/providers/helpers.ts packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/src/assistant-cli-access.ts`

If `test:diff` does not truthfully cover the changed package owners, run package-local coverage for `operator-config`, `setup-cli`, and `assistant-engine`.

Concrete fallback coverage commands:
- `pnpm --dir packages/operator-config test:coverage`
- `pnpm --dir packages/setup-cli test:coverage`
- `pnpm --dir packages/assistant-engine test:coverage`

Because this touches secrets/config/trust boundaries, completion also requires:
- `security-privacy-review`
- `coverage-write` when the verification lane includes owner coverage
- `task-finish-review`

Add or update focused tests for:
- Venice provider config lookup and serialization.
- Assistant CLI contracts accepting the provider config.
- Wizard option rendering and selection.
- Setup env prompting for `VENICE_API_KEY`.
- Setup model prompting without OpenAI default leakage.
- Codex config override generation.
- Codex App Server adapter serialization of `modelProvider: 'venice'` on provider-bound start/resume/fork paths.
- Hosted/local env projection staying unchanged unless explicitly expanded.
- Secret redaction and no raw API key snapshots.
- A sentinel fake Venice key is absent everywhere except `process.env` and direct parsed readback of the private local env file in tests that specifically verify persistence.
- Direct Venice HTTP calls do not exist outside provider metadata/tests.
- Hosted env allowlist searches for `VENICE_API_KEY` / `VENICE_` are explained.
- `HOSTED_ASSISTANT_PROVIDER=venice` fails closed.
- Unknown `assistantModelProvider` fails before Codex launch.
- Provider/model resolution happens before API-key prompting.
- Provider override strings contain `env_key = "VENICE_API_KEY"` semantics but never the raw sentinel key.
- Provider base URL override serialization is exact and does not create `//responses` or drop `/api/v1`.

## Non-Goals

- No direct Venice assistant runner.
- No Chat Completions transport in Murph.
- No global Codex config mutation.
- No hosted Venice support in the first local onboarding pass.
- No hard-coded Venice API key examples beyond the env var name.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
