#!/usr/bin/env bash
set -euo pipefail

# Downloads only artifacts whose manifest entry is explicitly redistributable.
# Default inputs match the Health Commons Norwegian 4x4 artifact manifest.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../.." && pwd)"
manifest_path="${1:-$repo_root/packages/health-commons/content/artifacts/norwegian-4x4/research-artifacts.json}"
artifact_root="${2:-$repo_root}"

if [[ ! -f "$manifest_path" ]]; then
  echo "Missing manifest: $manifest_path" >&2
  exit 1
fi

python3 - "$manifest_path" <<'PYPARSE' | while IFS=$'\t' read -r artifact_id source_url local_path; do
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text())
for artifact in manifest.get("artifacts", []):
    if not artifact.get("redistributable"):
        continue
    if artifact.get("rightsStatus") != "open_access":
        raise SystemExit(f"Refusing redistributable artifact with non-open-access rightsStatus: {artifact.get('artifactId')}")
    source_url = artifact.get("sourceUrl")
    local_path = artifact.get("localPath")
    if not source_url or not local_path:
        raise SystemExit(f"Redistributable artifact is missing sourceUrl/localPath: {artifact.get('artifactId')}")
    print(f"{artifact['artifactId']}\t{source_url}\t{local_path}")
PYPARSE
  target_path="$artifact_root/$local_path"
  mkdir -p "$(dirname -- "$target_path")"
  echo "Downloading $artifact_id -> $local_path"
  curl --fail --location --show-error --silent "$source_url" --output "$target_path"
  byte_count="$(wc -c < "$target_path" | tr -d ' ')"
  echo "Downloaded $artifact_id ($byte_count bytes)"
done

echo "Done. Run the Health Commons artifact hash helper before enabling R2 upload."
