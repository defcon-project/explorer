# Contributing to DeFCoN Explorer

DeFCoN Explorer is open to contributions in the form of code, review, testing and documentation. This
document describes how changes get into the repository.

## Before you start

- **Security issues are never reported or fixed in public.** Follow [`SECURITY.md`](SECURITY.md).
- **Questions and support** belong on the [DeFCoN Discord](https://discord.gg/WzN5jawYZk), not in the
  issue tracker.
- For anything larger than a small fix, open an issue first so the approach can be agreed before the work
  is done.

## Setting up

You need Node.js at the version in [`.node-version`](.node-version) and npm. MongoDB and a DeFCoN Core node
with RPC enabled are needed to run the explorer against a real chain; the server tests and the browser smoke
tests need neither.

```bash
npm ci
cp .env.example .env     # set MONGODB_URI and the RPC_* values
npm run dev              # server and client together
npm run dev -w server    # server only
npm run dev -w client    # client only (Vite on http://localhost:5173)
```

Every setting is described in [`docs/configuration.md`](docs/configuration.md).

## Making a change

1. Fork the repository and branch from `main`, naming the branch after the change (`feat/<topic>`,
   `fix/<topic>`, `docs/<topic>`).
2. Keep each pull request to one logical change. Unrelated fixes go in separate pull requests.
3. Add or update tests with the change. A pull request that changes behaviour without a test that covers it
   will be asked for one.
4. Follow the style of the surrounding code. Code, comments, commit messages, documentation and UI text are
   in English.
5. If you add or remove a script under `scripts/`, update
   [`scripts/operations.manifest.json`](scripts/operations.manifest.json).

### Commit messages

Use the `type: summary` form with a short summary in the imperative:

```
feat: show the ChainLock height on the Nodes page
fix: keep the rich list sorted after a reorg
docs: describe the network noise ingest payload
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`. Use the body to explain *why* the
change is needed.

### Checks

Run the same checks as CI before you open a pull request:

```bash
npm run lint
npm run ops:validate
npm run build
npm run build -w deftrack-mcp
npm run test:ci
npx playwright install chromium   # once
npm run test:e2e:smoke -w @defcon/client
```

### Sensitive data

Never include private infrastructure addresses or hostnames, RPC credentials, API keys, tokens, private
keys, or log excerpts that contain secrets in issues, pull requests, commits, test fixtures or screenshots.
Use documentation addresses (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) and `example.com`
hostnames in examples.

## Review and merging

- Every pull request is built and tested by GitHub Actions; a pull request is merged only with a green
  build.
- A maintainer reviews every change. Pull requests are squash-merged into `main`, and `main` is what runs at
  [deftrack.xyz](https://deftrack.xyz).
- Address review comments with new commits while the review is ongoing.

## License

By contributing, you agree that your contributions are licensed under the MIT license (see
[`LICENSE`](LICENSE)).
