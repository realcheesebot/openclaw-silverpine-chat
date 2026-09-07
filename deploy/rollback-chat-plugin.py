#!/usr/bin/env python3
"""Atomically disable Silverpine Chat without depending on the gateway."""

import json
import os
import pathlib
import shutil
import tempfile
import time

config_path = pathlib.Path(os.environ.get("OPENCLAW_CONFIG_PATH", pathlib.Path.home() / ".openclaw/openclaw.json"))
data = json.loads(config_path.read_text())
data.setdefault("plugins", {}).setdefault("entries", {}).setdefault("silverpine-chat", {})["enabled"] = False
data.setdefault("channels", {}).setdefault("silverpine-chat", {})["enabled"] = False

backup = config_path.with_name(f"{config_path.name}.before-silverpine-rollback-{int(time.time())}")
shutil.copy2(config_path, backup)
fd, temporary = tempfile.mkstemp(prefix=f".{config_path.name}.", suffix=".tmp", dir=config_path.parent)
try:
    with os.fdopen(fd, "w") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, config_path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)

print(f"disabled Silverpine Chat; pre-rollback config: {backup}")
