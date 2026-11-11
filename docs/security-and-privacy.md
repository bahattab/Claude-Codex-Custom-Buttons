# Security and privacy

## Data handled

| Data | Where it goes |
|---|---|
| Prompts, categories, variables, buttons, notes | Local `library.json` (plus a Markdown copy of each note) and your own Google Drive |
| Google refresh token | The OS credential store (macOS Keychain, Linux Secret Service, Windows DPAPI-encrypted file); a file readable only by you only if you choose `google.tokenStore = "file"` |
| Text being regenerated or translated (including text you select while instant translation is on) | The model of the tool you are using (Claude in Claude Code; Codex's model in Codex). No translation service is called |
| Generated Codex skills (buttons and favourite prompts) | `~/.codex/skills/ccb-*`, only while the Codex plugin is installed |
| Logs | Local only; never contain prompt or note text |

There is no project-operated server and no telemetry. The full policy is [privacy-policy.md](privacy-policy.md).

## Threat model

| Threat | Mitigation |
|---|---|
| **Someone edits the Drive file to plant a malicious button** (shared folder, compromised Google account) | Buttons can only send, fill or open prompts; there is no action type that runs commands or code (decision D11). Imported/synced content is validated against the schema before use |
| **Prompt text injected into the conversation contains instructions** | Prompt Bank content is the user's own text sent as the user's own message, the same as typing it. Content synced from Drive that changed on another device is marked "updated elsewhere" in the pane so the user sees new content before sending it |
| **Broad Drive access** | Only `drive.file`; the app cannot list or read your other Drive files |
| **Token theft from disk** | Token kept by the OS credential store (on Windows, a file only your Windows account can decrypt), never in the library; passed to the OS tools on standard input, never on a command line; `ccb logout` revokes it |
| **A forged sign-in redirect** | The sign-in uses PKCE and a random `state`; the loopback server listens on 127.0.0.1 only and ignores answers with the wrong state |
| **A hostile device file in Drive** | Every downloaded device file is validated before merging; an invalid one is skipped and reported by `ccb status` and `ccb doctor` |
| **OAuth client file leaked in a repository** | `.gitignore` excludes `client_secret*.json`; `ccb` stores its copy outside the repo with user-only permissions. Google does not treat desktop client secrets as confidential, but they are still kept private |
| **Corrupted or hostile library file** | Schema validation on load; size limits on every field; fallback to the last valid backup (also when `library.json` is missing); the damaged file is kept; a library or backup with a newer schema opens read-only |
| **Other local users reading note titles** | The data folder and `notes/` are created readable only by your user (0700), and files 0600 |
| **Two processes writing at once** | One writer at a time through a lock file with a heartbeat; each change is applied to a fresh read of the library while the lock is held (tested with 8 concurrent processes) |
| **Secrets stored in prompts, variables or notes** | The panes warn when text looks like a key or password (common key patterns); docs advise against storing secrets, since they would be copied to Drive |
| **Background sync service misuse** | Runs as the user with no administrator rights, only syncs the plugin's own Drive folder, can be declined or removed (`ccb service uninstall`) |
| **Malformed device file from another PC** | Every device file is schema-validated before merging; an invalid one is skipped and reported, never applied |
| **Dependency compromise** | Few dependencies, all pinned with a lockfile; Dependabot or equivalent alerts; `npm audit` in CI |

## Permissions requested per platform

- **Claude Code:** the plugin's MCP server runs as a local process; the mod uses no tool permissions beyond its own MCP server and the model calls for Regenerate and Translate. Instant translation sends selected text to the session's model: turn it off with `translate.instant` if you select sensitive text.
- **Codex:** the MCP server and skills; no shell access requested.
- **Google:** `https://www.googleapis.com/auth/drive.file` only.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
