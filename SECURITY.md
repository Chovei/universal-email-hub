# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Yes    |

Older versions are not supported. Please update to the latest release before reporting.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Send a private report to: **security@universalemailhub.app**

Please include:

1. A clear description of the vulnerability and its potential impact
2. Step-by-step instructions to reproduce it
3. The app version and operating system
4. Any proof-of-concept code or screenshots (if applicable)

We will acknowledge your report within **48 hours** and provide a status update within **7 days**. Critical vulnerabilities are patched and released within **14 days** where possible.

We will credit you in the release notes unless you prefer to remain anonymous.

## Security Architecture

### Token Storage

- Gmail and Outlook tokens are obtained via OAuth 2.0 and encrypted with Electron's `safeStorage` API, which delegates to the OS credential store (Windows Credential Manager on Windows, Keychain on macOS, libsecret on Linux).
- IMAP passwords are encrypted with AES-256-GCM using a machine-derived key (PBKDF2-SHA256). They are never written to disk in plaintext.

### Renderer Isolation

- `contextIsolation: true` — renderer runs in a separate JavaScript context
- `nodeIntegration: false` — renderer has no access to Node.js APIs
- `sandbox: true` — renderer process is OS-sandboxed
- All renderer ↔ main communication goes through a strongly-typed `contextBridge`
- Every IPC payload is validated with a Zod schema before the main process acts on it

### Content Security Policy

The main process enforces a strict CSP on all renderer responses:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'none';
frame-src 'none';
```

`connect-src: 'none'` means the renderer cannot make any network requests directly.

### Email Content

- All email HTML is sanitized with `sanitize-html` (allow-list of safe tags/attributes) before being stored in SQLite.
- Email bodies are displayed inside a sandboxed `<iframe srcdoc>` with `sandbox="allow-same-origin"`. JavaScript in email bodies is blocked.
- Remote images are blocked by default to prevent tracking pixels.

### External Links

`shell.openExternal` is restricted to `http:`, `https:`, and `mailto:` protocols. Any other protocol is rejected by the IPC validator before reaching the Electron API.

### Supply Chain

- All dependencies are pinned to exact or caret ranges and validated via `npm ci` in CI.
- Native modules (`better-sqlite3`) are rebuilt for the target Electron version via `electron-builder install-app-deps`.
