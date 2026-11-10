# Security policy

## Supported versions

The project has no release yet. Once v0.1.0 ships, security fixes go to the latest minor version.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Include:

- what the problem is and its impact;
- steps to reproduce;
- the affected component (Claude mod, MCP server, CLI, Codex plugin, desktop extension) and version.

You should get a reply within 7 days. Fixes are released as soon as practical, and reporters are credited unless they prefer otherwise.

## Scope

In scope: anything in this repository, including how it stores tokens, handles the library file and talks to Google Drive.

Out of scope: vulnerabilities in Claude Code, Codex, Claude Desktop, Google Drive or third-party libraries themselves (report those to their maintainers), unless this project uses them unsafely.

See [docs/security-and-privacy.md](docs/security-and-privacy.md) for the threat model.
