# Runner Audio Benchmark

## Goal

Add an explicit local final-image benchmark for the hosted runner audio parser path. It should use the actual hosted runner Docker image, generate a 65 second MP4 voice-memo-like fixture from the existing smoke WAV fixture inside the restored fixture vault, and report metadata-only timing for ffmpeg normalization and whisper.cpp transcription.

## Constraints

- Do not disturb existing hosted-local or e2e containers/processes.
- Keep benchmark output metadata-only: no transcript text, raw payloads, local host paths, secrets, or direct user identifiers.
- Keep the normal runner smoke deterministic; the benchmark must be opt-in.
- Match the deployed runner resource class where practical: 1 vCPU and 3072 MiB memory.

## Files

- `apps/cloudflare/package.json`
- `apps/cloudflare/tsconfig.smoke-build.json`
- `apps/cloudflare/scripts/runner-audio-benchmark.ts`
- `apps/cloudflare/src/hosted-runner-audio-benchmark*.ts`
- focused Cloudflare tests for the benchmark contract/script wiring

## Verification

- Focused Cloudflare Vitest coverage for the new contract/script wiring.
- Run the opt-in Docker benchmark locally if the final image/base-image path is available.
- Typecheck or scoped diff verification as time permits without interfering with active hosted-local runs.

## Result

- Local final-image benchmark passed with `linux/amd64` image on an arm64 host under Docker emulation.
- Docker run requested 1 vCPU and 3072 MiB memory, matching the configured hosted runner resource class.
- 65 second MP4 audio fixture was generated from the existing hosted runner smoke WAV fixture inside the restored fixture vault.
- Production-faithful measured path used `createConfiguredParserRegistry(...)` plus `parseAttachment(...)`.
- `parseAttachmentMs`: 571786
- Parser metadata duration: 64960 ms
- Source bytes: 578010
- Transcript chars: 94
- Memory limit bytes: 3221225472
- Memory peak bytes: 446820352
- Process max RSS KB: 167952
- Conclusion: local final-image benchmark is CPU-bound under the one-vCPU constrained/emulated run; memory is not the limiter.
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
