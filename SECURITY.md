# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or exposed
credential. Use GitHub's private vulnerability reporting for this repository.

Include the affected version, reproduction steps, impact, and any suggested
mitigation. Please avoid accessing data that is not yours and do not retain or
share credentials encountered during research.

## Credential handling

Bot credentials are scoped and revocable. The plugin stores them outside the
OpenClaw configuration in a mode-`0600` credential file. If a credential may
have been disclosed, remove or rotate it in Silverpine Chat immediately and
pair the plugin again.
