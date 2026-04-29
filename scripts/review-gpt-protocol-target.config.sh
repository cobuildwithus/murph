#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/review-gpt.config.sh"

name_prefix="murph-chatgpt-protocol-target-audit"
snapshot_attachment_name="murph-review-gpt.protocol-target-snapshot.zip"
package_script="scripts/package-review-gpt-protocol-target-context.sh"
