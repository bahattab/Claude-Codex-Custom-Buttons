# Security and privacy

## Data handled

| Data | Where it goes |
|---|---|
| Prompts, categories, variables, buttons | Local `library.json` and your own Google Drive |
| Notes | Local `notes/` only |
| Google refresh token | OS credential store only |
| Text being regenerated | The model of the tool you are using (Claude in Claude Code; Codex's model in Codex) |
| Logs | Local only; never contain prompt or note text |

There is no project-operated server and no telemetry.

## Threat model

| Threat | Mitigation |
|---|---|
| **Someone edits the Drive file to plant a malicious button** (shared folder, compromised Google account) | Buttons can only send, fill or open prompts; there is no action type that runs commands or code (decision D11). Imported/synced content is validated against the schema before use |
| **Prompt text injected into the conversation contains instructions** | Prompt Bank content is the user's own text sent as the user's own message, the same as typing it. Content synced from Drive that changed on another device is marked "updated elsewhere" in the pane so the user sees new content before sending it |
| **Broad Drive access** | Only `drive.file`; the app cannot list or read your other Drive files |
| **Token theft from disk** | Token kept in the OS credential store, not in files; `ccb logout` revokes it |
| **OAuth client file leaked in a repository** | `.gitignore` excludes `client_secret*.json`; `ccb` stores its copy outside the repo with user-only permissions. Google does not treat desktop client secrets as confidential, but they are still kept private |
| **Corrupted or hostile library file** | Schema validation on load; size limits on every field; fallback to the last valid backup; a library with a newer schema opens read-only |
| **Two processes writing at once** | Lock file, revision check and merge before write |
| **Secrets stored in prompts or variables** | The pane warns when a prompt or variable looks like a key or password (common key patterns); docs advise against storing secrets, since they would be copied to Drive |
| **Dependency compromise** | Few dependencies, all pinned with a lockfile; Dependabot or equivalent alerts; `npm audit` in CI |

## Permissions requested per platform

- **Claude Code:** the plugin's MCP server runs as a local process; the mod uses no tool permissions beyond its own MCP server and the model call for Regenerate.
- **Codex:** the MCP server and skills; no shell access requested.
- **Google:** `https://www.googleapis.com/auth/drive.file` only.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
