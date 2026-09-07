#!/usr/bin/env bash
set -euo pipefail

readonly CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$HOME/.openclaw/openclaw.json}"
resolve_openclaw_bin() {
  if [[ -n "${OPENCLAW_BIN:-}" && -x "${OPENCLAW_BIN}" ]]; then
    printf '%s\n' "$OPENCLAW_BIN"
    return
  fi
  if command -v openclaw >/dev/null 2>&1; then
    command -v openclaw
    return
  fi
  if [[ -x "$HOME/.npm-global/bin/openclaw" ]]; then
    printf '%s\n' "$HOME/.npm-global/bin/openclaw"
    return
  fi
  printf '%s\n' "cannot locate an executable OpenClaw CLI" >&2
  exit 1
}

readonly OPENCLAW_BIN="$(resolve_openclaw_bin)"
readonly ROLLBACK_SCRIPT="${ROLLBACK_SCRIPT:-$(dirname "$0")/rollback-chat-plugin.py}"
readonly WINDOW_SECONDS="${WINDOW_SECONDS:-180}"
readonly INTERVAL_SECONDS="${INTERVAL_SECONDS:-5}"
readonly STARTUP_GRACE_SECONDS="${STARTUP_GRACE_SECONDS:-30}"
readonly PROBE_TIMEOUT_MS="${PROBE_TIMEOUT_MS:-15000}"
readonly MAX_CONSECUTIVE_FAILURES="${MAX_CONSECUTIVE_FAILURES:-3}"
readonly SERVICE_NAME="${OPENCLAW_SERVICE_NAME:-openclaw-gateway.service}"
readonly SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-systemctl}"
readonly CURL_BIN="${CURL_BIN:-curl}"
readonly GATEWAY_HTTP_URL="${GATEWAY_HTTP_URL:-http://127.0.0.1:18789}"

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
channel_successes=0
deadline=$((SECONDS + WINDOW_SECONDS))
while (( SECONDS < deadline )); do
  current_restarts="$("$SYSTEMCTL_BIN" --user show "$SERVICE_NAME" -p NRestarts --value || echo 999999)"
  if [[ "$current_restarts" != "$INITIAL_RESTARTS" ]]; then
    rollback "gateway restart count changed from $INITIAL_RESTARTS to $current_restarts"
  fi

  # These are direct HTTP requests to the already-running gateway. They avoid
  # conflating a slow/failing OpenClaw CLI cold start with gateway death.
  live="$($CURL_BIN --silent --show-error --max-time 3 "$GATEWAY_HTTP_URL/health" 2>&1 || true)"
  ready="$($CURL_BIN --silent --show-error --max-time 3 "$GATEWAY_HTTP_URL/ready" 2>&1 || true)"
  if ! jq -e '.ok == true' >/dev/null 2>&1 <<<"$live" ||
     ! jq -e '.ready == true and ((.failing // []) | length) == 0' >/dev/null 2>&1 <<<"$ready"; then
    failures=$((failures + 1))
    log "direct gateway health failed ($failures/$MAX_CONSECUTIVE_FAILURES): live=$(jq -c . 2>/dev/null <<<"$live" || printf '%q' "$live") ready=$(jq -c . 2>/dev/null <<<"$ready" || printf '%q' "$ready")"
    if (( failures >= MAX_CONSECUTIVE_FAILURES )); then rollback "direct gateway health remained bad"; fi
    sleep "$INTERVAL_SECONDS"
    continue
  fi

  failures=0

  # Authenticated RPC verifies channel state. A CLI-local failure is recorded
  # verbatim but is not evidence that the gateway is dead when direct health
  # remains good. The observation cannot pass without at least one good RPC.
  probe_stdout="$(mktemp)"
  probe_stderr="$(mktemp)"
  probe_started="$SECONDS"
  set +e
  "$OPENCLAW_BIN" gateway call health --json --timeout "$PROBE_TIMEOUT_MS" >"$probe_stdout" 2>"$probe_stderr"
  probe_rc=$?
  set -e
  probe_elapsed=$((SECONDS - probe_started))
  probe="$(cat "$probe_stdout")"
  probe_error="$(cat "$probe_stderr")"
  rm -f "$probe_stdout" "$probe_stderr"

  if (( probe_rc == 0 )) && jq -e '
       .ok == true and
       (.channels.slack.connected // false) == true and
       (.channels.slack.running // false) == true and
       (.channels["silverpine-chat"].connected // false) == true and
       (.channels["silverpine-chat"].running // false) == true and
       ((.channels["silverpine-chat"].reconnectAttempts // 0) <= 2) and
       ((.channels["silverpine-chat"].lastError // null) == null)
     ' >/dev/null 2>"$probe_stderr.jq" <<<"$probe"; then
    channel_successes=$((channel_successes + 1))
  else
    if [[ -s "$probe_stderr.jq" ]]; then
      probe_error="${probe_error}${probe_error:+$'\n'}jq: $(<"$probe_stderr.jq")"
    fi
    log "channel RPC inconclusive: exit=$probe_rc elapsed=${probe_elapsed}s stdout_bytes=${#probe} stderr_bytes=${#probe_error}"
    [[ -z "$probe_error" ]] || while IFS= read -r line; do log "channel RPC stderr: $line"; done <<<"$probe_error"
    [[ -z "$probe" ]] || jq -c '{ok, eventLoop, channels}' <<<"$probe" 2>/dev/null |
      sed 's/^/channel RPC snapshot: /' || true
  fi
  rm -f "$probe_stderr.jq"
  sleep "$INTERVAL_SECONDS"
done

if (( channel_successes == 0 )); then rollback "no authenticated channel health check succeeded"; fi
armed=0
log "health observation passed with $channel_successes authenticated channel checks; Silverpine Chat remains enabled"
