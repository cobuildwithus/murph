#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/review-gpt.config.sh"

name_prefix="murph-chatgpt-protocol-audit"
snapshot_attachment_name="murph-review-gpt.protocol-snapshot.zip"
package_script="scripts/package-review-gpt-protocol-context.sh"

filtered_repomix_ignore_patterns=()
for pattern in "${repomix_ignore_patterns[@]}"; do
  case "$pattern" in
    "packages/health-commons/content/**")
      continue
      ;;
  esac
  filtered_repomix_ignore_patterns+=("$pattern")
done
repomix_ignore_patterns=("${filtered_repomix_ignore_patterns[@]}")
