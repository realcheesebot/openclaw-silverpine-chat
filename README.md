# Silverpine Chat for OpenClaw

An OpenClaw channel plugin that connects an OpenClaw bot to
[Silverpine Chat](https://chat.spsw.io). It receives channel and conversation
events over WebSocket, recovers missed events with cursors, maps Chat
containers to stable OpenClaw sessions, and sends agent replies back through
the scoped bot API.

## Features

- One-time, 15-minute pairing codes
- Bot credentials stored outside `openclaw.json` in a mode-`0600` file
- WebSocket ingress with cursor recovery and reconnect backoff
- Stable sessions per Chat channel or conversation
- Scoped channel access and bot permissions enforced by the Chat server
- Outbound text delivery
- Self-message loop prevention

## Requirements

- OpenClaw 2026.7.1 or newer
- A Silverpine Chat account
- Membership in the group and access to the channel(s) where the bot will run
- A one-time bot pairing code created in the Silverpine Chat client

## Install

Install directly from GitHub:

```sh
openclaw plugins install https://github.com/realcheesebot/openclaw-silverpine-chat.git
openclaw plugins enable silverpine-chat
```

For local development, clone the repository and link it:

```sh
git clone https://github.com/realcheesebot/openclaw-silverpine-chat.git
cd openclaw-silverpine-chat
npm ci
npm test
openclaw plugins install --link .
openclaw plugins enable silverpine-chat
```

## Pair a bot

1. In Silverpine Chat, open the group where the bot should participate.
2. Add an OpenClaw bot and select its permitted channels and permissions.
3. Copy the one-time pairing code. It expires after 15 minutes and can be used
   only once.
4. On the OpenClaw host, run:

```sh
openclaw silverpine-chat pair --code '<one-time-pairing-code>'
```

The default server is `https://chat.spsw.io`. A self-hosted or development
server may be selected explicitly:

```sh
openclaw silverpine-chat pair \
  --server-url 'https://chat.example.com' \
  --code '<one-time-pairing-code>'
```

The command stores the returned bot credential under:

```text
~/.openclaw/credentials/silverpine-chat/
```

The credential file is created with mode `0600`. The credential is not written
to `openclaw.json` or intentionally emitted to logs.

## Access model

Silverpine Chat controls the bot's effective access. Pairing or installing a
bot requires at least one of these scopes:

- `messages:read`
- `messages:write`
- `events:read`

A group-level installation can access current and future public channels in
that group. Private channels always require an explicit grant. A selected-
channel installation can access only the selected channels.

Removing the bot from a group or rotating/revoking its credential takes effect
server-side without reinstalling the plugin.

## OpenClaw targets

Use these targets when sending from OpenClaw:

```text
channel:<channel-id>
conversation:<conversation-id>
```

A bare identifier is treated as a channel ID.

## Upgrade

Re-run the installation with `--force`, then restart the gateway if your
OpenClaw installation does not do so automatically:

```sh
openclaw plugins install --force https://github.com/realcheesebot/openclaw-silverpine-chat.git
openclaw gateway restart
```

Existing credentials and event cursors remain outside the installed plugin and
are preserved during upgrades.

## Troubleshooting

### Pairing code rejected

- Create a fresh pairing code; codes expire after 15 minutes and are single-use.
- Confirm the pairing invitation has not been cancelled.
- Confirm the OpenClaw host can reach the configured Chat server over HTTPS.

### Connected but no messages arrive

- Confirm the bot still has `events:read` and access to the relevant channel.
- Confirm the Silverpine Chat channel and plugin entry are enabled in OpenClaw.
- Inspect `openclaw status --deep` and the gateway logs for the
  `silverpine-chat` channel state.

### Replies fail

- Confirm the bot has `messages:write`.
- Confirm the bot has not been removed and its credential has not been revoked.
- Confirm the destination uses `channel:<id>` or `conversation:<id>`.

## Security

- Treat the bot credential like a password. Never commit or paste it into logs.
- Grant only the channels and permissions the bot needs.
- Rotate the credential immediately if the OpenClaw host or credential file may
  have been exposed.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
npm run check
npm test
npm pack --dry-run
```

Pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
