# Recap show real-provider recovery

Status: active

## Outcome and boundary

Synthetic pair shows use the hosted image and song file paths successfully, preserve a publishable show when media fails, and produce redacted diagnostic classifications. Work only in the authorized task checkout. No production reads, regeneration, messages, merge, deployment, or ReviewGPT.

## Work

1. Reproduce with the production media clients, reference resolution, reservation and byte validation. Run paid calls only through focused sanctioned live tests, using local test credentials.
2. Fix verified provider/file failures and preserve safe diagnostics through dynamic-tool issue capture.
3. Return typed game errors for exhausted media and frozen drafts. Preserve immutable accepted selections and make same-draft recovery explicit; finish text/photo shows when generation fails before submission.
4. Prove deterministic negative paths, real-provider acceptance, Linux regression and full workspace typecheck. Commit, push and open a template-complete PR.

## Evidence and decisions

- Baseline: the recap image dynamic adapter discards the generator failureDiagnostic, causing result/unknown rows. Song failures preserve only a generic handler_exception.
- Baseline: media attempt exhaustion and frozen selection mismatch throw ordinary Error values, which the route converts to HTTP 500.
- A local test OpenAI credential was available. Real GPT-6.1 Sol file-mode journey generated two JPEGs, previewed/revised, and accepted one show with one chat line/link and no chat media. This rules out a universal OpenAI b64/JPEG decoder failure. No local ElevenLabs credential was available; its host sentinel → actual SDK → Worker credential substitution → validated twenty-second MP3 path passed with a synthetic provider response. A live ElevenLabs failure is not reproduced or claimed fixed.

## Amendments and disposition

- Confirmed hosted image defect: even after consuming a valid recap reservation, the Worker called the ordinary image subscription gate. A synthetic room without separate image funding reproduced HTTP 403 `MURPH_IMAGE_SUBSCRIPTION_REQUIRED` before the provider. A consumed, scoped recap reservation is the server-owned spending authority for that one request; skip the redundant ordinary subscription gate only for `{scoped:true, allowed:true}`. Invalid and unscoped reservation headers cannot grant this exemption. Ordinary image/model/song/voice behavior stays under its existing policy.
- Preserve bounded failures through image and song adapters: provider HTTP class, transport/timeout, byte format/size class and exact source-owned validation rule. Never persist provider messages, payloads, IDs, keys, or arbitrary error context. Preparation failures use the same diagnostics.
- Media attempt exhaustion and frozen-draft mismatch become HTTP 200 typed rejected tool results, not infrastructure 500s. Frozen selections remain immutable. Generation failures are omitted before freeze; after an unconfirmed submission the writer retries the same draft/receipts. A focused retry test and the real Postgres prepare/stage/accept suite preserve this invariant.
- Extend native Linux proof with failed image/song providers followed by preview, revision and accepted media-free show. Paid provider calls remain restricted to the sanctioned local live journey; all Linux CI media is synthetic.
- New provider testkit seams are public test-support exports, not relative imports across workspace boundaries. No schema, iOS decoder, deployment flag, budget, deadline or production configuration changes.

## Verification

- Full `pnpm typecheck`, focused media/game adapters, Web route, contracts, hosted-execution and Worker tests; isolated loopback Postgres game suite (94 tests).
- Real-provider artifacts: `audit-packages/recap-show-real-providers/accepted-presentation.json`, `verification.json`, and `previews/` (ignored, synthetic only).
- Native Linux sandbox CI is required on the pushed candidate. Local ARM emulation cannot replace that proof. No production access, regeneration, messages or deployment performed.

Updated: 2026-11-11
