## Final recommendation

Use **Linq attachment pre-upload as the storage layer for the MVP**, not Murph-hosted storage and not an ElevenLabs URL.

The final path should be:

```txt
murph.generate_voice_memo dynamic tool
  → ElevenLabs Create Speech returns audio bytes
  → upload bytes to Linq attachment storage
  → persist only Linq attachment metadata in AssistantResponseMedia / outbox
  → final assistant delivery sends that attachment through Linq’s dedicated voice memo endpoint
```

This gives you native iMessage voice memo bubbles now, avoids adding a Murph audio CDN/R2 storage surface, keeps raw audio out of the vault, and still composes with Murph’s existing dynamic-tool → response-media → outbox → channel-adapter architecture.

## API decision: can we pass an ElevenLabs URL directly?

No, not cleanly. ElevenLabs’ Create Speech endpoint is `POST /v1/text-to-speech/:voice_id`; it converts text into speech and **returns the generated audio file**, not a public hosted URL. ([ElevenLabs][1]) The history audio endpoint also returns an audio file from an API path, not a public object URL that Linq can fetch without credentials. ([ElevenLabs][2])

Linq’s voice memo endpoint requires either a **publicly accessible HTTPS `voice_memo_url`** or a **pre-uploaded `attachment_id`**. ([API Docs][3]) Since ElevenLabs gives us bytes, not a public URL, some upload step is unavoidable. Linq already provides that upload step with `POST /v3/attachments`, which returns a presigned `upload_url`, a permanent `attachment_id`, and a `download_url`. ([API Docs][4])

## Why Linq attachment storage is the right MVP storage

Linq explicitly says pre-upload is optional when you already host a public URL, but useful when you want reuse or lower send latency; for our generated audio, it also lets us avoid creating public Murph storage. ([API Docs][4]) The voice memo endpoint accepts `attachment_id`, and native iMessage voice memo rendering specifically requires the dedicated voice memo endpoint rather than ordinary media parts. ([API Docs][5])

Do **not** send the ElevenLabs MP3 as a normal Linq `media` part if the product goal is a true voice memo. Linq’s docs say audio sent as a standard media part appears as a downloadable attachment in iMessage; native inline voice memo UI requires `POST /v3/chats/{chatId}/voicememo`. ([API Docs][6])

## Migration guide

### 1. Extend the media contract from image-only to image + voice memo

Today, Murph’s response media contract is image-only: `assistantResponseMediaKindValues` is `['image']`, and the URL validator requires public HTTPS image-file URLs.

Add a second media variant:

```ts
type AssistantResponseMedia =
  | {
      kind: 'image'
      url: string
      alt: string | null
      source: string | null
    }
  | {
      kind: 'voice_memo'
      url: string | null
      mimeType: 'audio/mpeg' | 'audio/x-m4a' | 'audio/mp4' | 'audio/aac' | 'audio/wav'
      filename: string
      sizeBytes: number
      transcript: string
      source: 'elevenlabs'
      voiceId: string
      modelId: string
      transportRefs: {
        linq?: {
          attachmentId: string
          downloadUrl: string | null
        }
      }
    }
```

Keep `url` nullable because the clean MVP path should use `transportRefs.linq.attachmentId`. Store `downloadUrl` only as diagnostic/future fallback, not as the primary send reference.

Files to change:

```txt
packages/operator-config/src/assistant-cli-contracts.ts
packages/assistant-engine/src/assistant/response-media.ts
packages/operator-config/test/assistant-cli-contracts.test.ts
packages/assistant-engine/test/assistant-response-media.test.ts
```

Normalize/dedupe voice memos by `transportRefs.linq.attachmentId ?? url`, not only by URL. The existing normalizer already dedupes and caps media count, so this is a small extension rather than a new media system.

### 2. Add a minimal ElevenLabs runtime

Add:

```txt
packages/operator-config/src/elevenlabs-runtime.ts
```

Recommended env names:

```txt
ELEVENLABS_API_KEY
MURPH_ELEVENLABS_VOICE_ID
MURPH_ELEVENLABS_MODEL_ID       # optional; default eleven_multilingual_v2
```

Runtime API:

```ts
export async function generateElevenLabsSpeech(input: {
  apiKey: string
  voiceId: string
  modelId: string
  text: string
  outputFormat: 'mp3_44100_128'
  fetchImplementation?: typeof fetch
  signal?: AbortSignal
}): Promise<{
  bytes: Uint8Array
  contentType: 'audio/mpeg'
  filenameExtension: 'mp3'
}>
```

Default to `mp3_44100_128` because ElevenLabs documents it as the default output format, and Linq supports MP3 as `audio/mpeg`. ([ElevenLabs][1]) ([API Docs][3])

Use `MURPH_ELEVENLABS_VOICE_ID` as the default Murph voice. Let the agent override with a `voiceId` argument, but the tool description should say: “Defaults to Murph’s voice; override only when the user explicitly asks for a different voice.”

### 3. Extend Linq runtime with attachments + voice memo send

Murph already has a Linq runtime client in `packages/operator-config/src/linq-runtime.ts` that handles auth, base URL, JSON retry, message sending, chat creation, typing, and phone number probing.

Add three public functions there:

```ts
export async function createLinqAttachmentUpload(input: {
  contentType: 'audio/mpeg'
  filename: string
  sizeBytes: number
}, deps?: LinqRuntimeDependencies): Promise<{
  attachmentId: string
  uploadUrl: string
  downloadUrl: string | null
  requiredHeaders: Record<string, string>
  expiresAt: string
}>

export async function uploadLinqAttachmentBytes(input: {
  uploadUrl: string
  requiredHeaders: Record<string, string>
  bytes: Uint8Array
}, deps?: Pick<LinqRuntimeDependencies, 'fetchImplementation' | 'signal'>): Promise<void>

export async function sendLinqVoiceMemo(input: {
  chatId: string
  attachmentId: string
}, deps?: LinqRuntimeDependencies): Promise<{
  providerMessageId: string | null
  providerThreadId: string | null
  target: string
  voiceMemoAttachmentId: string | null
  voiceMemoUrl: string | null
}>
```

Linq’s upload flow is: request upload URL with metadata, PUT raw bytes to the presigned URL with exact `required_headers`, then reference the returned `attachment_id`. ([API Docs][4]) The voice memo endpoint accepts that `attachment_id`. ([API Docs][3])

Do **not** run the presigned upload through the existing authenticated `requestLinqJson` helper. That helper is for Linq API JSON calls. The presigned `upload_url` needs a plain `PUT` of bytes with the exact headers returned by Linq.

### 4. Add `murph.generate_voice_memo` as a dynamic tool

Dynamic tools are centralized in `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`; the existing pattern already supports media patches through `responseMediaPatch`.  The Codex app-server path already parses dynamic tool calls, executes them, applies media patches, and replies to Codex over RPC.

Add a new tool:

```ts
export const MURPH_GENERATE_VOICE_MEMO_TOOL = {
  namespace: 'murph',
  name: 'generate_voice_memo',
  description:
    'Generate one short voice memo using ElevenLabs and attach it to the final assistant response. Defaults to Murph’s configured voice. Use voiceId only when the user explicitly asks for a different voice. This does not send directly.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        minLength: 1,
        maxLength: 4000,
        description: 'The exact text to speak in the voice memo.',
      },
      voiceId: {
        anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
        default: null,
        description: 'Optional ElevenLabs voice id. Defaults to Murph voice.',
      },
      modelId: {
        anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
        default: null,
        description: 'Optional ElevenLabs model id. Defaults to Murph configured model or eleven_multilingual_v2.',
      },
    },
    required: ['text'],
  },
} as const
```

Execution should:

```txt
resolve API key + voiceId + modelId
generate ElevenLabs speech bytes
enforce bytes > 0 and <= 10 MB
create Linq attachment upload
PUT bytes to Linq upload_url
return voice_memo AssistantResponseMedia with linq attachmentId
```

Add the new tool to `MURPH_DYNAMIC_TOOLS`, request parsing, argument validation, execution, and runtime issue classification. Also add it to the serialized media-tool branch with `generate-image` and `attach-response-media`; the existing code only serializes image/media-mutating tools, and voice memo patches should be deterministic too.

### 5. Allow media-only final delivery

Today, outbox messages require non-empty text. `createAssistantOutboxIntent` normalizes message text before persisting, and `normalizeRequiredMessage` throws on empty.

For real voice memos, support:

```txt
non-empty message OR at least one media item
```

Migration:

```ts
function normalizeOutboxMessage(input: {
  message: string
  media: readonly AssistantResponseMedia[]
}): string {
  const normalized = normalizeNullableString(input.message) ?? ''
  if (!normalized && input.media.length === 0) {
    throw new Error('Assistant outbox delivery requires text or media.')
  }
  return normalized
}
```

Schema-wise, change `assistantOutboxIntentSchema.message` from `z.string().min(1)` to `z.string()`, then enforce the cross-field invariant in creation/parsing helpers. Existing `messageLength` is already nonnegative, so `0` works.

This avoids sending awkward caption texts like “voice memo attached.” The final assistant response can be empty text + one `voice_memo`.

### 6. Add per-media-kind channel capability

The channel adapter contract currently has a boolean `supportsResponseMedia`.  That should become per-kind:

```ts
supportedResponseMediaKinds: readonly AssistantResponseMediaKind[]
```

Initial config:

```ts
linq: ['image', 'voice_memo']
telegram: []
email: []
whatsapp: []
```

Later Telegram can become:

```ts
telegram: ['voice_memo']
```

without pretending Telegram supports image response media.

Update the places that currently do binary media support checks:

```txt
packages/assistant-engine/src/assistant/channels/helpers.ts
packages/assistant-engine/src/assistant/outbox.ts
packages/assistant-engine/src/assistant/delivery-service.ts
```

Those checks are already centralized enough to avoid a sprawling migration.

### 7. Route Linq `voice_memo` media through the dedicated endpoint

Do **not** reuse the current Linq `message.parts` media path for voice memos. Current Murph builds Linq media as `{ type: 'media', url }`, and today it validates those URLs as public image URLs.   Linq’s docs make clear that standard audio media parts are attachments, while voice memos need the dedicated endpoint. ([API Docs][6])

In `packages/assistant-engine/src/assistant/channels/descriptors.ts`, update the Linq adapter send logic:

```ts
if (media.some((item) => item.kind === 'voice_memo')) {
  return sendLinqVoiceMemoDelivery(...)
}

return existingSendLinqMessagePath(...)
```

Recommended MVP behavior:

```txt
- require an existing Linq chat/thread id for native voice memo delivery
- reject participant-only delivery for voice memos with a clear error
- send only one voice memo per final response
- if response text is non-empty, send the text first using existing sendLinqChatMessage, then send the voice memo
- if response text is empty, send only the voice memo
```

The existing Linq webhook model already carries `chat_id`, and the repo’s parser already recognizes inbound `voice_memo` parts.

### 8. Treat Linq voice memo sends as non-idempotent unless Linq confirms otherwise

Linq’s normal message send supports `idempotency_key`, and Murph already maps Linq sends through the outbox idempotency path. ([API Docs][7])  But the Linq voice memo API reference does **not** document an `idempotency_key` body field. ([API Docs][5])

So for voice memo delivery:

```txt
deliveryTransportIdempotent = false
```

This matters because Murph’s outbox already has logic for non-idempotent sends: it distinguishes idempotent vs non-idempotent delivery, confirmation-pending states, and stale non-idempotent sending recovery.

Implementation detail: today `deliverAssistantMessageOverBinding` returns `deliveryTransportIdempotent: adapter.supportsIdempotencyKey`, which is too coarse for mixed Linq message vs voice memo behavior.  Add one of these:

```ts
adapter.resolveDeliveryTransportIdempotent?.(input) ?? adapter.supportsIdempotencyKey
```

or include `deliveryTransportIdempotent` in the adapter send result. For Linq:

```ts
if (media.some((item) => item.kind === 'voice_memo')) return false
return true
```

If Linq later confirms `idempotency_key` support on `/voicememo`, update this and send the key.

### 9. Do not reuse the generated-image uploader

Murph’s hosted generated-image path is image-specific in both type and implementation. The execution context exposes `AssistantHostedGeneratedImageUploader` with image content types only, and the Cloudflare handler validates image bytes and uploads to Cloudflare Images.

For this MVP, do **not** add generic Murph media storage. Add a small voice memo store abstraction only if it keeps call sites clean:

```ts
interface AssistantGeneratedVoiceMemoStore {
  storeGeneratedVoiceMemo(input: {
    bytes: Uint8Array
    contentType: 'audio/mpeg'
    filename: string
    transcript: string
    voiceId: string
    modelId: string
  }): Promise<Extract<AssistantResponseMedia, { kind: 'voice_memo' }>>
}
```

First implementation: Linq attachment store. No R2, no Cloudflare Images, no public Murph audio CDN.

### 10. Files to touch

Core contracts:

```txt
packages/operator-config/src/assistant-cli-contracts.ts
packages/operator-config/src/elevenlabs-runtime.ts
packages/operator-config/src/linq-runtime.ts
packages/operator-config/test/assistant-cli-contracts.test.ts
```

Assistant engine:

```txt
packages/assistant-engine/src/assistant/response-media.ts
packages/assistant-engine/src/assistant/outbox.ts
packages/assistant-engine/src/assistant/delivery-service.ts
packages/assistant-engine/src/assistant/channels/types.ts
packages/assistant-engine/src/assistant/channels/helpers.ts
packages/assistant-engine/src/assistant/channels/descriptors.ts
packages/assistant-engine/src/assistant/channels/runtime.ts
packages/assistant-engine/src/outbound-channel.ts
packages/assistant-engine/src/assistant-codex/dynamic-tools.ts
packages/assistant-engine/src/assistant-codex/generate-voice-memo-tool.ts
packages/assistant-engine/src/assistant/providers/types.ts
packages/assistant-engine/src/assistant/codex-runtime.ts
packages/assistant-engine/src/assistant/codex-turn-runner.ts
```

Tests:

```txt
packages/assistant-engine/test/assistant-response-media.test.ts
packages/assistant-engine/test/assistant-codex-generate-voice-memo-tool.test.ts
packages/assistant-engine/test/assistant-outbox-runtime.test.ts
packages/operator-config/test/linq-runtime.test.ts
packages/operator-config/test/elevenlabs-runtime.test.ts
```

No CLI package changes are needed for the MVP.

## Suggested rollout sequence

1. **Contracts first**: add `voice_memo` media schema and media-only outbox validation.
2. **Runtime clients**: add ElevenLabs TTS and Linq attachment/voice memo functions with mocked-fetch tests.
3. **Dynamic tool**: add `murph.generate_voice_memo`, defaulting to `MURPH_ELEVENLABS_VOICE_ID`.
4. **Linq adapter**: route `voice_memo` media to `/voicememo`, requiring existing chat ID.
5. **Outbox idempotency**: mark voice memo deliveries non-idempotent until Linq documents idempotency support.
6. **Hosted config**: add `ELEVENLABS_API_KEY`, `MURPH_ELEVENLABS_VOICE_ID`, and optional `MURPH_ELEVENLABS_MODEL_ID` to the hosted runner env allowlist/secret sync path.
7. **Integration smoke**: generate a 3–5 second MP3, pre-upload to Linq, send by `attachment_id`, verify native iMessage voice memo rendering.

## Final shape

The target abstraction should remain:

```txt
assistant response media:
  kind: voice_memo
  transcript: spoken text
  source: elevenlabs
  transportRefs.linq.attachmentId: durable Linq pointer
```

The model never sends directly. ElevenLabs never becomes a delivery channel. Linq-specific behavior stays in the Linq adapter/runtime. Murph stores only execution metadata in assistant runtime/outbox, not raw audio. This is the simplest path that gives native iMessage voice memos now while leaving a clean seam for Telegram later.

[1]: https://elevenlabs.io/docs/api-reference/text-to-speech/convert "Create speech | ElevenLabs Documentation"
[2]: https://elevenlabs.io/docs/api-reference/history/get-audio "Get audio from history item | ElevenLabs Documentation"
[3]: https://docs.linqapp.com/guides/messaging/voice-memos/ "Voice Memos | API Docs"
[4]: https://docs.linqapp.com/api/resources/attachments/methods/create "Pre-upload a file | API Docs"
[5]: https://docs.linqapp.com/api/resources/chats/methods/send_voicememo "Send a voice memo to a chat | API Docs"
[6]: https://docs.linqapp.com/guides/messaging/attachments/ "Attachments | API Docs"
[7]: https://docs.linqapp.com/guides/messaging/sending-messages/ "Sending Messages | API Docs"
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
