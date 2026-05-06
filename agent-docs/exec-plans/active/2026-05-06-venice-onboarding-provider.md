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
- Adding Venice to the shared provider registry must not make hosted Venice ready by accident. Hosted provider readiness stays behind an explicit hosted allowlist.
- Local Codex execution may receive `VENICE_API_KEY` through the normal local process environment because Codex App Server is the privileged local adapter. Hosted direct-CLI env projection must not be widened for Venice in this task.
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

State:
- planning

Done:
- Verified Venice docs and OpenAPI spec show `POST /api/v1/responses` as a Responses API Alpha endpoint.
- Verified Venice's Codex CLI guide uses Codex `model_provider = "venice"` with `wire_api = "responses"`.
- Verified Murph already models Codex provider configs in `packages/operator-config/src/assistant/target-runtime.ts`.
- Verified setup currently distinguishes only ChatGPT/Codex sign-in, local Codex model, and skip.
- Ran three subagent stress reviews covering runtime architecture, setup shape, and security/privacy. Incorporated their shared corrections into this plan.

Now:
- Use this corrected plan as the implementation guide.

Next:
- Implement only after the plan converges on the smallest stable architecture.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether Venice `/responses` Alpha access is enabled for every API-key user. The implementation should fail clearly if a user's key cannot access the endpoint.
- UNCONFIRMED: whether Venice exposes a stable recommended model id suitable as a Murph default. Until confirmed, prompt for the model id.

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

Add a small provider onboarding/availability view rather than scattering provider-specific UI checks. It may be an extension of `AssistantCodexModelProviderConfig` or a companion helper, but it should keep this information registry-owned:

```ts
{
  providerId: 'venice',
  selectableInLocalOnboarding: true,
  hostedSupported: false,
  label: 'Venice.ai',
  description: 'Use Codex with a Venice API key.',
  envKeys: ['VENICE_API_KEY'],
  modelPrompt: 'Venice model id to use with Codex',
  defaultModel: null,
}
```

`hostedSupported: false` is an explicit negative capability. Hosted readiness must not treat every known local Codex provider as hosted-ready.

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
- Keep thinking-trace overrides independent so the two concerns compose.
- Escape provider ids and string values as TOML strings instead of relying on ad hoc concatenation.
- Add tests that assert the override strings do not contain sentinel secret-looking values.
- Never write `.codex/config.toml`, the user's Codex home, or project Codex config files.

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

### 4. API Key Prompting

Extend setup runtime env prompting so the selected assistant model provider can contribute one required env key.

Concrete seam:

```ts
promptForMissing({
  assistantModelProvider,
  assistantEnvKeys,
  channels,
  env,
  helpText,
  wearables,
})
```

The exact shape can be smaller if the resolver can derive `assistantEnvKeys` from `assistantModelProvider`, but the selected assistant provider must be an input to the runtime-env prompt path.

Rules:
- If selected provider config has `envKey = 'VENICE_API_KEY'` and the key is missing, prompt with hidden input.
- Persist through the existing setup env override persistence path.
- Do not create a new secrets file or provider-specific persistence mechanism.
- Do not prompt for Venice if the user selected skip, local OSS, or a provider already satisfied by the environment.
- The raw Venice key may appear only in `process.env` and the local `.env.local` written by the existing private env persistence path.
- The raw Venice key must not appear in wizard result details, operator defaults, assistant session/provider options, Codex override strings, logs, dry-run output, docs, snapshots, or test snapshots.

### 5. Model Prompt

When the selected provider is Venice:
- Prompt for `Model id to use with Codex`.
- Prefer the user's explicit `--assistant-model` if provided.
- Do not silently default to an OpenAI model id for Venice.
- In non-interactive setup, fail clearly if Venice is selected and `--assistant-model` is missing, unless provider metadata later supplies a maintained `defaultModel`.

If a maintained provider default is later added, it should live in provider metadata, not in setup UI logic.

### 6. Account and Validation Behavior

Keep Codex account detection for the ChatGPT/Codex sign-in path.

For API-key providers:
- Either skip account detection or report provider config/key presence only.
- Do not call a Codex account RPC path that assumes ChatGPT sign-in.
- Do not make direct Venice HTTP validation requests in the first pass. That would introduce a second provider execution path into setup.
- Let real validation happen through Codex App Server execution. If that fails, surface Venice Responses Alpha/access as a possible non-secret cause.

### 7. Hosted Boundary

Do not add `VENICE_API_KEY` to hosted env forwarding in the first local onboarding pass.

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

### 8. Verification

For implementation, run:
- `pnpm typecheck`
- `pnpm test:diff packages/operator-config/src/assistant/target-runtime.ts packages/operator-config/src/setup-runtime-env.ts packages/setup-cli/src/setup-assistant-wizard.ts packages/setup-cli/src/setup-wizard.ts packages/setup-cli/src/setup-wizard-app.ts packages/setup-cli/src/setup-cli.ts packages/setup-cli/src/setup-assistant.ts packages/assistant-engine/src/assistant/providers/helpers.ts packages/assistant-engine/src/assistant-cli-access.ts`

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
- Hosted/local env projection staying unchanged unless explicitly expanded.
- Secret redaction and no raw API key snapshots.
- A sentinel fake Venice key is absent everywhere except `process.env` and direct parsed readback of the private local env file in tests that specifically verify persistence.

## Non-Goals

- No direct Venice assistant runner.
- No Chat Completions transport in Murph.
- No global Codex config mutation.
- No hosted Venice support in the first local onboarding pass.
- No hard-coded Venice API key examples beyond the env var name.
