# @murphai/operator-config

Workspace-private operator and setup configuration surface for Murph.

This package owns persisted operator defaults, hosted assistant config, assistant backend target normalization, OpenAI assistant configuration helpers, setup/runtime environment helpers, device and channel readiness helpers, and CLI/shared command contracts used by assistant and setup flows.

Generated ElevenLabs speech and music must decode to audio samples before callers
can upload them. The lazy MP3 decoder processes bounded chunks, discards decoded
PCM, honors cancellation between chunks, and frees its per-response state.
Empty, metadata-only, and decoder-rejected audio produce a non-retryable
`ELEVENLABS_INVALID_AUDIO` error. Validation preserves the original encoded bytes;
it does not prove that the downstream messaging client will play them.

Linq voice-memo results retain nullable `voiceMemoDurationMs`. An explicitly zero
provider duration emits a content-free warning while preserving the accepted
message receipt. Missing duration remains unknown. Neither case retries a send
that Linq already accepted; the diagnostic CLI includes the duration in its report.

Assistant models run through OpenAI using Codex App Server. Hosted configuration
accepts only the `openai` provider and `OPENAI_API_KEY`; local setup uses Codex
authentication. Third-party inference providers and local model execution are
unsupported.

Linq HTTP error diagnostics retain provider codes and trace IDs without raw error
prose. `providerErrorFieldHints` contains only fixed send-schema names found as
words in the provider message (`none` when no names match); these are lexical
hints, not proof of the rejected field. `providerErrorMessageLength` distinguishes
missing prose from an empty or populated message without retaining its contents.
`providerErrorReasonHints` and `providerErrorMediaTypeHints` similarly retain
only fixed validation words and image-format names. Unrecognized reasons are
`unknown`; absent format hints are `none`. These hints cannot determine retry
safety or establish the root cause. `requestPublicUrlMediaFormatSummary` counts
allowlisted URL suffixes (or `unknown`), never hosts, paths, or actual downloaded
content types. Immediate failure logs retain these fields; durable delivery
summaries include them in the existing request/response summaries. No raw provider
message or URL is retained, including for unrecognized validation failures.
