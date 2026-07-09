# Universal Email Hub

> Premium multi-account desktop email client built with Electron + React

Universal Email Hub connects all your email accounts — Gmail, Outlook, IMAP, Yahoo, iCloud, and Exchange — behind a single, fast, beautiful interface. It runs natively on Windows (macOS and Linux builds included).

## Features

- **Unlimited accounts** — Gmail OAuth, Microsoft Graph OAuth, IMAP/SMTP for everything else
- **Unified inbox** — all accounts in one thread list, sorted by date
- **Full-text search** — SQLite FTS5, prefix matching, `from:` / `subject:` field filters
- **Rich composer** — TipTap editor, CC/BCC, file attachments, reply threading
- **Command palette** — `Ctrl+Shift+P` for instant keyboard navigation
- **Dark / light / system theme**
- **Auto-updating** — background update check via GitHub Releases, no admin required
- **Secure by design** — OAuth tokens encrypted via OS keychain (`safeStorage`), sandboxed renderer, strict CSP

## Download

Go to [Releases](../../releases) to download the latest installer.

| Platform | File |
|----------|------|
| Windows (x64) | `Universal-Email-Hub-Setup-x.x.x.exe` |
| Windows (ARM64) | `Universal-Email-Hub-Setup-x.x.x-arm64.exe` |

The Windows installer is **per-user** (no admin / UAC prompt) and installs silently in one click.

## Development

### Prerequisites

- **Node.js 22+** and npm 10+
- **Windows 11** (for Windows-specific features; macOS/Linux work for cross-platform dev)

### Get started

```bash
git clone https://github.com/Fatexxp/universal-email-hub.git
cd universal-email-hub
npm install
node scripts/generate-icons.mjs   # generates icon.png and icon.ico
npm run dev
```

### Available scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Electron in dev mode with HMR |
| `npm run build` | Compile TypeScript (main + renderer) |
| `npm run typecheck` | TypeScript type-check without emit |
| `npm run lint` | ESLint across `src/` |
| `npm test` | Vitest unit tests |
| `npm run icons` | Regenerate icon files from `source.svg` |
| `npm run package` | Build + package installer (local) |
| `npm run release` | Build + publish to GitHub Releases |

### Releasing a new version

1. Bump the version in `package.json`
2. Update `CHANGELOG.md`
3. Commit: `git commit -m "chore: release v1.2.3"`
4. Tag: `git tag v1.2.3 && git push --tags`

The [Release workflow](.github/workflows/release.yml) runs automatically and uploads the installer to GitHub Releases. Users receive the update silently in the background.

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop runtime | Electron 33 |
| Frontend | React 19, TypeScript |
| Styling | TailwindCSS v4 |
| Animations | Framer Motion |
| Rich text | TipTap |
| Server state | TanStack Query v5 |
| Client state | Zustand v5 |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| Full-text search | SQLite FTS5 |
| Auth | OAuth 2.0 (Google, Microsoft), IMAP/SMTP |
| Security | Electron safeStorage, sanitize-html, Zod |
| Build | electron-vite, electron-builder |
| Updates | electron-updater |
| Logging | electron-log |

## Project structure

```
src/
├── main/           Electron main process (Node.js)
│   ├── crash/      Crash-loop detection and safe mode
│   ├── db/         SQLite schema, client, queries (Drizzle ORM)
│   ├── ipc/        Handler registration and Zod validators
│   ├── logger/     electron-log wrapper
│   ├── security/   safeStorage token encryption
│   ├── sync/       Email provider sync engine
│   └── updater/    electron-updater service
├── preload/        contextBridge — typed window.emailAPI
├── renderer/       React SPA (no Node access)
│   ├── components/
│   ├── hooks/
│   └── stores/     Zustand stores
└── shared/         Types and constants shared across processes
```

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure policy.

Key security properties:
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- All renderer–main communication goes through a typed `contextBridge`
- Every IPC payload is validated by a Zod schema before touching the database
- Tokens never stored in plaintext — always encrypted via `safeStorage`
- Email HTML sanitized with `sanitize-html` before storage; rendered in a sandboxed `<iframe>`
- `shell.openExternal` restricted to `http:`, `https:`, and `mailto:` protocols

## Contributing

Pull requests are welcome. Please read the [PR template](.github/pull_request_template.md) before submitting.

## License

[MIT](LICENSE) © 2026 Universal Email Hub
