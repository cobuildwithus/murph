#!/usr/bin/env bash
set -euo pipefail

# Run immediately after image preparation in the same builder. Invalid runtime
# pins deliberately prove that the native target cannot depend on Node at all.
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$repo_root"
trace=$(mktemp)
trap 'rm -f "$trace"' EXIT
cache=$(node --input-type=module -e 'import { hostedRunnerBaseImageBuildCacheTag } from "./apps/cloudflare/scripts/runner-base-image-contract.ts"; process.stdout.write(hostedRunnerBaseImageBuildCacheTag)')
SECONDS=0
docker buildx build --platform linux/amd64 \
  --target codex-builder --output type=cacheonly --progress plain \
  --cache-from "type=registry,ref=$cache" \
  --build-arg NODE_VERSION=unused-native-cache-proof \
  --build-arg NODE_IMAGE_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  --build-arg CODEX_CARGO_JOBS \
  -f Dockerfile.cloudflare-hosted-runner-base . 2>&1 | tee "$trace"
python3 - "$trace" <<'PY'
import pathlib
import re
import sys

trace = pathlib.Path(sys.argv[1]).read_text()
steps = set(re.findall(r"^#(\d+) \[codex-builder [^\]]+\] RUN .*cargo build", trace, re.M))
if len(steps) != 1:
    raise SystemExit("Expected exactly one native Cargo build vertex in BuildKit proof")
step = steps.pop()
if not re.search(rf"^#{step} CACHED$", trace, re.M):
    raise SystemExit("Native Cargo build was not reused after changing runtime-only Node pins")
PY
receipt="Native Cargo layer reused with changed Node pins in ${SECONDS}s."
printf '%s\n' "$receipt"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '%s\n' "$receipt" >> "$GITHUB_STEP_SUMMARY"
fi
