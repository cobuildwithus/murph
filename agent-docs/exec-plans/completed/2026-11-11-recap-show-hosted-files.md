# Restore recap file access in the hosted Linux sandbox

Status: completed

Outcome: restore pair-show authoring from authorized local inputs through file media, preview and one accepted recap with one chat line/link.
Reaches: hosted recap shows only; ordinary conversations and plain/group recaps keep their existing cwd and profiles.

## Root cause and fix

The pinned Codex Linux sandbox binds readable roots, masks explicitly denied ancestors, then restores writable children. The recap profile's explicit workspace `.` deny therefore hid the read-only inputs while leaving drafts/media/previews usable. The same profile also failed to enter the procfs cwd. Source: [pinned bubblewrap mount ordering](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/linux-sandbox/src/bwrap.rs#L604).

Use the concrete restored vault cwd for recap shows. Remove the explicit deny ancestor from both the base profile and per-turn overrides. Restricted mode starts from an empty filesystem, granting only system/runtime reads, the task's read-only inputs and its writable drafts/media/previews. Network remains disabled. No additional filesystem work or early materialization remains.

The composed test also exposed file-mode songs reading the sanitized Codex environment. Carry the existing audio credential in the host-owned file runtime instead. It never enters the shell environment or tool receipt; ordinary voice/song behavior and media admission are unchanged.

## Native Linux evidence

- Reproduction run `43003171519`, commit `ebc1731378a5`, pinned Codex 0.166.0: `read_game` returned a fully materialized manifest, but shell startup exited 1 with `bwrap: Can't chdir to /tmp/mv/r-QY5WtH: No such file or directory`.
- Exact synthetic command: `cat .runtime/tmp/recap/745d12188d17e92e80decb204ae2d72d/inputs/writing-guide.md .runtime/tmp/recap/745d12188d17e92e80decb204ae2d72d/inputs/game.json .runtime/tmp/recap/745d12188d17e92e80decb204ae2d72d/inputs/chat.jsonl`.
- With concrete cwd alone, run `43004815839` reached `cat` and returned `No such file or directory` for all three inputs. Image generation, previews and acceptance already worked; song file mode reported unavailable credentials.
- Moving directory creation before Codex did not fix reads (`43006747619`). That experiment and its extra filesystem operations were removed after pinned-source inspection identified the masking rule.
- Native run `43007734791`, code head `1c4fc6516a49`: the recap container step passed. The real runner image and Codex sandbox read the inputs; rejected private/sibling reads and input writes; allowed all three output directories; kept the audio key out of the shell; generated one image and one 20-second song; produced two valid preview drafts; accepted once; queued exactly one saved line/link and no chat media.
- `pnpm hosted-local e2e recap-show-files --no-bundle` is an explicit hosted-local scenario and runs in the native Linux permission CI gate. Model responses and media providers are synthetic; tool dispatch, decoding, reservation checks, renderer, validator and outbox are real. No paid provider call or production data is involved.

## Local verification

- 88 focused assistant-engine tests, six hosted permission-profile tests and 38 hosted-local harness tests passed.
- Assistant-engine, hosted-execution, Cloudflare and harness typechecks passed; scoped lint and complexity guard passed.
- Optional `pnpm test:assistant:live -- --test 'pair recap show parent files preview revision and selected media'` stopped before provider execution because the installed Mac binary lacks the required Murph native patch. The native container proof uses the pinned patched binary.
- Local AMD64 Docker emulation cannot install the inner seccomp filter; existing Frog issue #3862 owns that constraint. No sandbox weakening was used as a substitute for native proof.

## Delivery

Runner-only deployment. No Web, database, iOS, presentation, tool-schema or environment-variable change. Old warm runners may fall back until the parent deploys and converges the new runner; existing accepted recaps remain compatible. Parent owns ReviewGPT, merge, deployment and post-deploy checks. No ReviewGPT was started.
Updated: 2026-11-11
Completed: 2026-11-11
