# Google Cloud setup

Drive API sync needs a Google Cloud **OAuth client**. You create it once; everyone who installs your build of the plugin signs in through it.

You can skip this page if you use the [Drive for desktop fallback mode](google-drive-sync.md#fallback-google-drive-for-desktop-folder).

> Google's console changes its menu names from time to time. The steps below describe what to do; if a label differs, look for the closest match. Exact steps are rechecked in milestone M0.

## 1. Create a project

1. Open the Google Cloud console and sign in.
2. Create a new project, for example **Claude Codex Buttons**.

## 2. Enable the Google Drive API

1. In the project, open **APIs & Services → Library**.
2. Search for **Google Drive API** and press **Enable**.

## 3. Configure the OAuth consent screen

1. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**).
2. User type: **External** (or **Internal** if everyone using it is in your Google Workspace organisation; internal apps avoid the 7-day token limit below).
3. App name: **Claude Codex Buttons**. Add a support email and developer contact.
4. Scopes: add only `.../auth/drive.file`. Google classes it as a non-sensitive scope: it gives access only to files the app creates or the user opens with it.
5. While the app is in **Testing**, add each Google account that will use it as a **test user**.

## 4. Create the OAuth client

1. Open **Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name it **ccb desktop**.
3. Download the JSON file.

## 5. Give the client to the plugin

```bash
npx ccb config set google.clientFile /path/to/client_secret.json
npx ccb login
```

`ccb` copies the client ID and secret into its own config (`~/.claude-codex-buttons/google-client.json`, readable only by your user). For a desktop app Google does not treat the client secret as confidential, but the file is still kept out of the repository; `.gitignore` excludes `client_secret*.json`.

## Publishing status

| Status | Effect |
|---|---|
| **Testing** | Only listed test users can sign in. Refresh tokens expire after about 7 days, so `ccb login` must be repeated weekly |
| **In production** | Anyone can sign in after accepting the consent screen; tokens do not expire on that schedule. With only non-sensitive scopes, Google's review is lighter than for sensitive or restricted scopes |
| **Internal** (Workspace only) | Only accounts in your organisation; no 7-day limit |

For personal use, either accept the weekly sign-in or publish the app. The 7-day behaviour comes from Google's documented policy for apps in testing as reported by several sources; it is reconfirmed in M0 (see [platform-facts.md](platform-facts.md)).

## Revoking access

- `npx ccb logout` revokes the token and deletes it locally.
- You can also remove the app from your Google Account's **Third-party connections** page.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| "Access blocked: app has not completed verification" | Your account is not a test user | Add it under test users, or publish the app |
| Sign-in worked, then fails a week later | App is in Testing | Run `ccb login` again, or publish |
| "redirect_uri_mismatch" | Client type is not Desktop app | Create a Desktop app client |
| `ccb doctor` reports "Drive API not enabled" | Step 2 skipped | Enable the Google Drive API |
