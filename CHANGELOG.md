# Changelog

All notable changes to Universal Email Hub are documented in this file.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and the format from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/Fatexxp/universal-email-hub/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Fatexxp/universal-email-hub/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Fatexxp/universal-email-hub/releases/tag/v0.1.0
