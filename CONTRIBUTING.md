# Contributing

Thanks for helping. Bug reports, fixes, docs and examples are all welcome.

## Set up

You need Node 22.12 or later and pnpm 12 (`corepack enable` picks the version in
`package.json`).

```bash
pnpm install
pnpm --filter ng-lynx build
cd examples/hello-world && npm run dev
```

[docs/02](docs/02-getting-started.md) explains how to open an app in Lynx Explorer.

## Before you open a pull request

Run what CI runs:

```bash
pnpm --filter ng-lynx build
pnpm --filter ng-lynx typecheck
pnpm --filter ng-lynx verify:all
node scripts/verify-consumer.mjs 22
```

`verify:all` runs the headless harnesses against a mock engine
([docs/07](docs/07-verifying.md)). `verify-consumer.mjs` packs the package and builds
fresh apps from it, the way a user would. If your change is visible on screen, also
run it on a simulator or emulator, and say in the pull request what you tried
([docs/41](docs/41-device-testing.md)).

## Pull requests

- `main` only takes pull requests. Branch from it, and keep one change per pull request.
- Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org/)
  style the history uses: `fix(testing): …`, `feat(router): …`, `docs: …`.
- Add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a user
  would notice.
- New behaviour needs a harness in `packages/ng-lynx/verify`, or a device flow in
  `packages/device-tests` if it only shows on a real engine.

## Assets and licences

Contributions are accepted under the project's [Apache-2.0](LICENSE) licence. Images,
video, audio and models in examples must be CC0, public domain, or your own work.
Add each one's source to [THIRD-PARTY.md](THIRD-PARTY.md). Code adapted from another
project needs its licence to allow that, a comment at the top of the file, and an
entry in [NOTICE](NOTICE).

Never commit keys or secrets. The genui example reads its key from `.env.local`,
which is gitignored.
