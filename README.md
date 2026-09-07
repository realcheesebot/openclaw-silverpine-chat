# Silverpine Chat for OpenClaw

Native OpenClaw channel plugin for Silverpine Chat. It pairs with a one-time
code, consumes scoped realtime events with cursor recovery, maps Chat channels
to stable OpenClaw sessions, and returns agent replies through the bot API.

## Install

```sh
openclaw plugins install npm-pack:./silverpine-openclaw-chat.tgz
openclaw plugins enable silverpine-chat
openclaw silverpine-chat pair --code '<one-time-code>'
```

The pairing command stores the bot credential at mode `0600` under
`~/.openclaw/credentials/silverpine-chat/`; it does not put the token in
`openclaw.json` or logs. The Gateway restarts after configuration.

## Targets

Use `channel:<channel-id>` for channel delivery and
`conversation:<conversation-id>` for group-chat delivery. A bare ID is treated
as a channel ID.
