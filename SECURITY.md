# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main`, as deployed at [deftrack.xyz](https://deftrack.xyz) | :white_check_mark: |
| Older commits | :x: |

There are no versioned releases; fixes land on `main` and are deployed from there.

## Reporting a vulnerability

**Please do not report security issues in public GitHub issues, pull requests or community channels.**

Report them privately through GitHub:
[**Report a vulnerability**](https://github.com/defcon-project/explorer/security/advisories/new)
(the *Security* tab of this repository → *Report a vulnerability*).

Please include:

- the affected component (`server/`, `client/`, `shared/`, `mcp/` or `scripts/`) and the route, page or
  file;
- the commit you tested, and any configuration the issue depends on (for example `NODE_ENV`, the proxy
  setup or an optional feature being enabled);
- what an attacker could do, and under which conditions;
- steps to reproduce against a local instance, with a minimal proof of concept.

Remove private keys, RPC credentials, API keys, tokens and non-public IP addresses from reports, logs and
screenshots.

The report is visible only to the maintainers. We will acknowledge it, keep you informed while a fix is
prepared, and coordinate the disclosure with you. There is no bug bounty program.

## Testing rules

Do not run load tests, vulnerability scanners, fuzzers or exploit attempts against deftrack.xyz or the
infrastructure behind it. Reproduce issues on a local instance instead; the [README](README.md) explains how
to run one. Normal use of the public site and API is fine.

## Scope

This policy covers the code in this repository: the API and background services (`server/`), the web client
(`client/`), the shared package (`shared/`), the MCP server (`mcp/`), and the operations scripts and
reference server configs (`scripts/`, `docs/server-config/`).

DeFCoN Core consensus, P2P, wallet and daemon issues belong to
[DeFCoN Core](https://github.com/defcon-project/defcon/security/policy). Vulnerabilities in third-party
services the explorer calls, such as market data or IP lookup providers, should be reported to those
services.
