# Contributing

Issues and pull requests are welcome.

## Development setup

```sh
npm ci
npm run check
npm test
npm pack --dry-run
```

Keep credentials, pairing codes, OpenClaw state, and private server details out
of commits and test fixtures. Use obvious placeholder values in tests.

Changes to authentication, credential storage, message routing, cursor
recovery, or reconnect behavior should include focused tests. By submitting a
contribution, you agree that it is licensed under Apache-2.0.
