# Beta Smoke Test Checklist

Run this checklist against the **packaged installer** (not `npm run dev`)
before publishing any release. Automated tests cover logic; this covers what
they can't — real installers, real mail servers, real OS integration.

Last executed: _(fill in)_ · Version: _(fill in)_ · Result: _(pass/fail)_

## 1. Install & first launch

- [ ] Download `Universal-Email-Hub-Setup-x.x.x.exe` from the GitHub release
- [ ] SmartScreen note: unsigned build — "More info → Run anyway" is expected
- [ ] Installer completes without UAC prompt (per-user install)
- [ ] App launches; Add Account wizard opens automatically (no accounts yet)
- [ ] Only ONE app instance can run (launching a second focuses the first)

## 2. Account setup

- [ ] **Gmail**: add via App Password — guided steps show, links open in browser
- [ ] **Gmail with wrong password**: friendly error ("requires an App Password…"), raw error behind "Technical details"
- [ ] **Outlook**: "Sign in with Microsoft" opens browser OAuth and completes
- [ ] **Generic IMAP** (or Yahoo/Rambler): connects with correct host defaults
- [ ] Wizard shows staged progress: verify → add → sync with live message count

## 3. Sync & real-time

- [ ] Initial sync fills the inbox; folders appear in sidebar
- [ ] Settings → Account Health shows "Connected ✓" with a **Live** badge (IMAP)
- [ ] Send yourself an email from another device → appears within ~2 seconds without clicking anything, desktop notification fires
- [ ] "Loading older messages — N remaining" appears for large mailboxes and shrinks over time
- [ ] Delete an email from the webmail UI → it disappears from Email Hub within a sync cycle (ghost reconciliation)
- [ ] Disconnect Wi-Fi → Account Health shows "Server unreachable"; reconnect Wi-Fi → recovers automatically

## 4. Mail operations (IMAP account)

- [ ] Archive a message from a **non-inbox** folder → verify in webmail it moved correctly
- [ ] Mark read/unread syncs to the server
- [ ] Download the **second** attachment of a multi-attachment email → correct file
- [ ] Empty Trash → messages are gone from the server too
- [ ] Send an email with an attachment → arrives intact

## 5. Verification Center

- [ ] Trigger a real verification email (e.g. Discord login) → desktop notification shows service + code
- [ ] Clicking the notification opens the Verification Center
- [ ] Copy button works; pressing `c` copies the newest code
- [ ] "Open email" jumps to the source message
- [ ] The same code does not appear twice after a forced re-sync

## 6. Search

- [ ] Plain text search returns results with highlighting
- [ ] `from:someone is:unread` and `has:attachment after:2026-01-01` filter correctly

## 7. Settings & security

- [ ] Security section shows "Windows DPAPI active" (or Keychain on macOS)
- [ ] Notification toggles work; quiet hours suppress notifications
- [ ] Ctrl+/ opens the shortcuts overlay; Ctrl+Shift+P opens the palette

## 8. Updater

- [ ] With an older version installed: update is detected within ~10s of launch
- [ ] "What's new" panel shows real release notes (never empty)
- [ ] "Restart to install" applies the update and relaunches into the new version
- [ ] Skipped version stays skipped across restarts

## 9. Uninstall / reinstall

- [ ] Uninstall from Windows Settings → app removed, no orphaned Start Menu entry
- [ ] Reinstall → previous accounts and mail are still there (userData preserved)

## 10. Crash recovery (destructive — optional, spare machine)

- [ ] Kill the process mid-sync (Task Manager) → relaunch resumes cleanly, no duplicates
- [ ] Corrupt `%APPDATA%/universal-email-hub/emails.db` (truncate it) → app backs it up as `emails.db.corrupt-*`, starts fresh, re-syncs
