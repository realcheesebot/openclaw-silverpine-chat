#!/usr/bin/env bash
set -euo pipefail

readonly CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$HOME/.openclaw/openclaw.json}"
readonly OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw)}"
readonly ROLLBACK_SCRIPT="${ROLLBACK_SCRIPT:-$(dirname "$0")/rollback-chat-plugin.py}"
readonly WINDOW_SECONDS="${WINDOW_SECONDS:-180}"
readonly INTERVAL_SECONDS="${INTERVAL_SECONDS:-5}"
readonly STARTUP_GRACE_SECONDS="${STARTUP_GRACE_SECONDS:-20}"
readonly MAX_CONSECUTIVE_FAILURES="${MAX_CONSECUTIVE_FAILURES:-3}"
readonly SERVICE_NAME="${OPENCLAW_SERVICE_NAME:-openclaw-gateway.service}"
readonly SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-systemctl}"

log() { printf '%s %s\n' "$(date --iso-8601=seconds)" "$*"; }

armed=0
on_exit() {
  status=$?
  if (( status != 0 && armed == 1 )); then
    armed=0
    set +e
    log "guard exited unexpectedly; forcing Silverpine Chat rollback"
    OPENCLAW_CONFIG_PATH="$CONFIG_PATH" python3 "$ROLLBACK_SCRIPT"
    "$SYSTEMCTL_BIN" --user restart "$SERVICE_NAME"
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 1' INT TERM

rollback() {
  log "health guard failed: $1; disabling Silverpine Chat"
  exit 1
}

python3 - "$CONFIG_PATH" <<'PY'
import json, os, pathlib, tempfile
path = pathlib.Path(__import__('sys').argv[1])
data = json.loads(path.read_text())
data.setdefault('plugins', {}).setdefault('entries', {}).setdefault('silverpine-chat', {})['enabled'] = True
data.setdefault('channels', {}).setdefault('silverpine-chat', {})['enabled'] = True
fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
try:
    with os.fdopen(fd, 'w') as handle:
        json.dump(data, handle, indent=2); handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PY
armed=1

"$SYSTEMCTL_BIN" --user restart "$SERVICE_NAME"
log "Silverpine Chat enabled under a ${WINDOW_SECONDS}s health guard"
sleep "$STARTUP_GRACE_SECONDS"

# NRestarts belongs to the current service activation and can reset when the
# deliberate activation restart creates a new unit invocation. Establish the
# crash baseline only after that restart has completed; from here onward an
# increase means systemd had to restart the guarded gateway unexpectedly.
readonly INITIAL_RESTARTS="$("$SYSTEMCTL_BIN" --user show "$SERVICE_NAME" -p NRestarts --value)"

failures=0
deadline=$((SECONDS + WINDOW_SECONDS))
while (( SECONDS < deadline )); do
  current_restarts="$("$SYSTEMCTL_BIN" --user show "$SERVICE_NAME" -p NRestarts --value || echo 999999)"
  if [[ "$current_restarts" != "$INITIAL_RESTARTS" ]]; then
    rollback "gateway restart count changed from $INITIAL_RESTARTS to $current_restarts"
  fi

  if probe="$($OPENCLAW_BIN gateway probe --json --timeout 3000 2>/dev/null)" &&
     jq -e '
       .ok == true and .degraded == false and
       (.targets[] | select(.id == .id and .active == true) | .health) as $h |
       $h.ok == true and $h.eventLoop.degraded == false and
       $h.channels.slack.connected == true and
       $h.channels.slack.healthState == "healthy" and
       $h.channels["silverpine-chat"].connected == true and
       $h.channels["silverpine-chat"].healthState == "healthy" and
       (($h.channels["silverpine-chat"].reconnectAttempts // 0) <= 2) and
       ($h.channels["silverpine-chat"].lastError == null)
     ' >/dev/null <<<"$probe"; then
    failures=0
  else
    failures=$((failures + 1))
    log "health check failed ($failures/$MAX_CONSECUTIVE_FAILURES)"
    if [[ -n "${probe:-}" ]]; then
      jq -c '{ok, degraded, channels: (.targets[0].health.channels // null)}' <<<"$probe" 2>/dev/null |
        sed 's/^/health snapshot: /' || true
    else
      log "health snapshot: gateway probe returned no JSON"
    fi
    if (( failures >= MAX_CONSECUTIVE_FAILURES )); then rollback "gateway or channel health remained bad"; fi
  fi
  sleep "$INTERVAL_SECONDS"
done

armed=0
log "health observation passed; Silverpine Chat remains enabled"
