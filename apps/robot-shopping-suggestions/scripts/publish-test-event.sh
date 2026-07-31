#!/usr/bin/env bash
# Compatibility wrapper — prefer ./scripts/publish-event.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/publish-event.sh" "$@"
