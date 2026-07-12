# Changelog

All notable changes to Universal Email Hub are documented in this file.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and the format from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.17] - 2026-07-12

### ✨ Improvements

- Real-time email delivery for IMAP accounts — new mail appears within about a second instead of waiting for the next sync cycle
- Account Health dashboard in Settings: connection status, live-sync badge, last sync time, message counts, and one-click reconnect
- Smarter verification-code detection: alphanumeric codes (like Steam Guard), spaced and hyphenated formats, and far fewer false positives from order numbers, years, prices, and phone numbers
- Verification codes trigger their own desktop notification — click it to jump straight to the Verification Center
- Search operators: `has:attachment`, `is:unread`, `is:starred`, `after:2026-01-01`, `before:`, and `account:you@example.com`
- Grouped notifications: many new emails collapse into one summary instead of a notification storm
- Friendly connection errors when adding accounts, with provider-specific App Password guidance
- Failing accounts back off automatically instead of retrying every cycle; syncs are capped at 4 concurrent accounts for stability with many inboxes
- Older messages load in the background beyond the initial 500 per folder
- Emails deleted in other mail apps now disappear here too (IMAP deletion reconciliation)
- Settings → Security shows how your credentials are protected (Windows DPAPI / macOS Keychain)
- Keyboard shortcut overlay — press Ctrl+/ to see every shortcut
- Release notes now appear with every update

### 🐛 Fixes

- Fixed IMAP operations targeting the wrong mailbox — archive, delete, star, and mark-read now always act on the folder a message actually lives in
- Fixed attachment downloads returning the first attachment instead of the one you clicked
- Fixed sent messages via Microsoft 365 getting placeholder IDs that broke reply threading
- Fixed a corrupt database permanently preventing the app from starting — it now recovers automatically and re-syncs
- Fixed silent startup failures — problems now show an error dialog
- Security: patched SMTP command-injection and header-injection vulnerabilities in the email sending library (nodemailer 6 → 9)
- Empty Trash and Empty Spam now permanently delete on the mail server as well

## [0.1.16] - 2026-07-12

### ✨ Improvements

- Added Rambler.ru as an email provider

### 🐛 Fixes

- Empty Trash and Empty Spam now actually delete messages instead of doing nothing

## [0.1.15] - 2026-07-11

### ✨ Improvements

- Folder management: Empty Trash, Empty Spam, Mark All Read, Archive All Read, and Delete All from sidebar right-click menus and the folder action bar
- Manage All Accounts section for cross-account cleanup in one click
- Confirmation dialogs with email counts and storage estimates before destructive actions

## [0.1.10] - 2026-07-10

### Fixed

- **Outlook OAuth token exchange failed** — `TOKEN_URL` was still pointing at `/common` endpoint while the auth URL used `/consumers`; both now use `/consumers` so personal Microsoft accounts authenticate correctly

## [0.1.9] - 2026-07-10

### Added

- **"Sign in with Microsoft" for Outlook accounts** — clicking the button opens a browser popup for normal Microsoft login; no app password or IMAP config needed
- `OAuthConnectingStep` component shows a live spinner while the browser auth completes, then transitions to sync progress automatically

### Changed

- Outlook wizard no longer shows email/password fields — uses OAuth browser flow instead
- Microsoft OAuth no longer requires a Client Secret — only the Azure app's Client ID is needed (public client / desktop app flow)
- Authority changed from `/common/` to `/consumers/` to target personal Microsoft accounts specifically
- Settings → OAuth Credentials → Microsoft section updated to show only Client ID field with clearer setup instructions

## [0.1.8] - 2026-07-10

### Fixed

- **Connection error now shows raw server response** — the error box in the wizard shows the exact message the mail server returned (in small text below the friendly error), making it possible to diagnose provider-specific auth failures

## [0.1.7] - 2026-07-10

### Fixed

- **Outlook "Command failed" error** — Microsoft's IMAP server returns a generic `NO` response on auth failure; the error is now correctly detected and shown as "Authentication failed" instead of the raw "Command failed" message
- **App passwords with spaces fail silently** — Microsoft and Google display app passwords with spaces (e.g. `xxxx xxxx xxxx xxxx`); the app now strips all spaces before authenticating so copy-pasting works without manual editing
- **Logout error masks successful connection** — if IMAP `connect()` succeeded but `LOGOUT` returned an error, the wizard incorrectly showed "Connection failed"; the connection result is now reported correctly in this case

## [0.1.4] - 2026-07-10

### Added

- **Check for Updates button** in Settings → About — triggers an immediate update check and shows live status (checking, up to date, downloading with percentage, ready to install)
- Version number in Settings is now pulled live from the app instead of being hardcoded

### Fixed

- **Restart to install** button appears automatically when an update finishes downloading

## [0.1.3] - 2026-07-10

### Added

- **Outlook / Hotmail support** — outlook.com, hotmail.com, and live.com accounts now connect via IMAP (`outlook.office365.com:993`) — no Azure app registration required
- **Verify before save** — the wizard tests credentials against the live IMAP server before creating any database record; wrong passwords show a specific error message instead of false success
- **Live sync progress in wizard** — after connecting, the wizard shows a real-time counter of messages being imported and transitions to "Done" automatically when the initial sync completes
- **Per-provider setup instructions** — every provider card shows step-by-step guidance (with clickable links) for obtaining App Passwords or enabling IMAP

### Fixed

- **Gmail IMAP broken** — credentials were silently discarded due to a bug in the `isImapProvider` check; Gmail App Password accounts now sync correctly
- **Zoho Mail not syncing** — `zoho` was missing from the IMAP switch case in SyncEngine and fell through to a no-op; it now routes to `ImapProvider`
- **Wrong colors/display names for IMAP accounts** — Gmail and Outlook now show correct accent colors; email address and display name are derived correctly for all IMAP providers
- **Outlook still routed through OAuth** — the wizard was sending `graph` OAuth for Outlook accounts; now uses IMAP directly

### Changed

- `ProviderKind` union extended with `'outlook'`
- `AddAccountSchema` and new `VerifyAccountSchema` both accept `'outlook'`
- Gmail's `authType` in `PROVIDER_META` corrected to `'apppassword'`; Zoho corrected to `'password'`

## [0.1.2] - 2026-07-10

### Added

- **Verification Center** — a dedicated panel that automatically detects login and 2FA codes from all connected inboxes and surfaces them with a one-click copy button
- Auto-detection supports 40+ services including VRChat, Discord, Steam, Epic Games, Google, Microsoft, Apple, Roblox, Twitch, Reddit, GitHub, and more
- Codes appear in real-time as emails arrive — no manual searching required
- Per-service color-coded cards with large, easy-to-read code display and animated "Copied!" feedback
- "Verification Codes" nav item in sidebar with live unread badge count
- Codes persist locally and can be dismissed individually

### Changed

- Account database schema gains `notes` and `label` columns (groundwork for account metadata in a future release)

## [0.1.1] - 2026-07-10

### Changed

- Gmail now uses App Password (IMAP) instead of OAuth — works instantly for any Gmail account with no Google verification or test-user approval required
- Add Account wizard shows step-by-step App Password setup instructions inline

### Fixed

- Gmail and IMAP "Add Account" flows no longer show false success when the underlying connection fails — errors are now shown in the wizard
- OAuth credential errors now include an "Open Settings →" link to jump directly to the credentials section

## [0.1.0] - 2026-07-09

### Added

- Multi-account support: Gmail (OAuth 2.0), Microsoft Outlook (OAuth 2.0 / Graph API), IMAP/SMTP for Yahoo, iCloud, Exchange, Zoho, Fastmail, AOL, GMX, and any standard IMAP provider
- Unified inbox with thread view across all accounts
- Full-text search powered by SQLite FTS5 — supports `from:`, `to:`, `subject:` field filters and prefix matching
- Rich-text composer via TipTap — formatting, file attachments, reply threading
- Thread list with virtualized scroll (`@tanstack/react-virtual`) for smooth performance at 100k+ emails
- Message reader with sandboxed `<iframe>` rendering to block remote trackers
- Attachment download, open, and Save As
- Command palette (`Ctrl+Shift+P`) with fuzzy search over all app actions
- Keyboard shortcut system — `j`/`k` navigation, `r` reply, `e` archive, `#` delete, and more
- Dark / light / system theme with instant switching
- Account settings: display name, accent colour, sync interval
- Sidebar with folder tree, unread badges, and drag-to-reorder accounts
- Resizable split pane (thread list ↔ message reader)
- Auto-updater via GitHub Releases — background download, progress dialog, one-click restart
- Windows NSIS installer: per-user install, no admin rights required, silent one-click
- Crash-loop detection with optional safe mode (skips account sync on repeated crashes)
- Professional logging via `electron-log` with 5 MB rotation to `userData/logs/main.log`
- GitHub Actions CI workflow (typecheck → lint → test on every PR)
- GitHub Actions release workflow (tag-triggered: typecheck → test → package → publish)
- Strict security model: `contextIsolation`, `sandbox`, strict CSP, Zod-validated IPC, `safeStorage` token encryption

[Unreleased]: https://github.com/Fatexxp/universal-email-hub/compare/v0.1.17...HEAD
[0.1.17]: https://github.com/Fatexxp/universal-email-hub/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/Fatexxp/universal-email-hub/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/Fatexxp/universal-email-hub/compare/v0.1.10...v0.1.15
[0.1.4]: https://github.com/Fatexxp/universal-email-hub/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Fatexxp/universal-email-hub/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Fatexxp/universal-email-hub/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Fatexxp/universal-email-hub/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Fatexxp/universal-email-hub/releases/tag/v0.1.0
