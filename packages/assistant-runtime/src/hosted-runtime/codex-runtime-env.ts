// Custom inference is fence-bound before Codex preparation. These invocation-
// local facts keep that effective target separate from the saved OpenAI/Venice
// product preference used to seed operator config. Preparation normalizes the
// same pair for every provider so downstream assistant work uses the generated
// Codex config's exact target.
export const HOSTED_CODEX_EFFECTIVE_MODEL_ENV =
  "MURPH_HOSTED_CODEX_MODEL";
export const HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV =
  "MURPH_HOSTED_CODEX_MODEL_PROVIDER_ID";
