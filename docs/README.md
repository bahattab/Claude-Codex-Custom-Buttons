# Documentation

Start with the project [README](../README.md) for an overview. These documents are the specification the implementation is built against.

## Understand the design

1. [Architecture](architecture.md): the components, how data flows, repository layout.
2. [Features](features.md): what each feature does, exactly, with acceptance criteria.
3. [Data model](data-model.md): the library file format.
4. [Google Drive sync](google-drive-sync.md): how saves reach Drive and other devices, and how conflicts are handled.

## Per platform

- [Claude Code and the Claude Desktop Code tab](platforms/claude-code.md)
- [Claude Desktop Chat tab](platforms/claude-desktop.md)
- [Codex](platforms/codex.md)

## Set up and run

- [Google Cloud setup](google-cloud-setup.md): one-time OAuth client creation.
- [Configuration](configuration.md): settings, paths, environment variables.

## Governance

- [Security and privacy](security-and-privacy.md)
- [Roadmap](roadmap.md)
- [Design decisions](decisions.md)
- [Platform facts ledger](platform-facts.md): which statements are checked against official sources and which still need checking.
- [Reference mapping](reference-mapping.md): what was adapted from the WordPress reference plugin.

## Conventions in these documents

- **Planned** marks behaviour not yet built.
- **Unconfirmed** marks a platform detail taken from secondary sources that must be checked in milestone M0 before code depends on it.
- Paths use `~` for the user's home folder. On Windows this is `%USERPROFILE%`.
