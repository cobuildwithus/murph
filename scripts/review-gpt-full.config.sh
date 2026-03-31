#!/usr/bin/env bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/review-gpt.config.sh"
include_tests=1
include_docs=1
package_script="scripts/package-audit-context-full.sh"
