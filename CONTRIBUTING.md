# Development

This fork targets our Home Assistant installation. Keep the UI English-only and new configurations free of sample content. Preserve real calendar titles and existing user settings when migrating configuration.

## Setup and checks

Clone `https://github.com/mmihaylov00/marco` and run `npm ci` with Node.js 22. Python 3 is required for the native HA panel's installation and authorization tests. Existing development services use automatic refresh; do not start or restart them without an explicit request.

Before submitting a change, run:

```sh
npm test
npm run typecheck
node scripts/gen-contract.mjs --check
npm run build
```

Update `config.yaml`, the package version and `home-assistant/custom_components/marco/manifest.json` for Home Assistant releases. The app's Docker build uses `--build-arg MARCO_RUNTIME_USER=root`; startup prepares `/data/marco` and drops privileges before loading the server. The panel installer never restarts Core; validate HA configuration before activating changed integration files.

## Conventions

- Match the existing ESM JavaScript server and TypeScript/Preact browser code.
- Keep validation and pure domain logic in `server/core/`; keep filesystem and network operations outside it.
- Update callers, shared types, the generated admin contract and regression tests when changing behavior.
- Handle persistence failures without discarding working credentials or cached source data.
- Keep configuration and secrets separate. Never commit private calendar URLs, OAuth tokens, passwords, Home Assistant tokens or runtime backups.

See [architecture](docs/ARCHITECTURE.md), [API](docs/API.md) and [security](SECURITY.md) for the current boundaries.
