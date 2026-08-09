# VRCX bridge — interface boundary (NOT IMPLEMENTED)

This records the intended contract for a future integration that lets VRCX
obtain a verification code from Email Hub. **No part of it is built.** It
exists so the TOTP subsystem was designed with the boundary already in mind.

## The one rule

VRCX receives a **short-lived code**. It never receives a secret, and there is
no operation that returns one. That constraint is already structural: the IPC
layer has no channel that reads a stored seed, and secrets are only ever
decrypted inside the main process for the duration of a single HMAC.

## Shape

```
VRCX  ──request(accountRef)──▶  Email Hub (main process)
      ◀──{ code, expiresIn }──
```

Requests name **one configured account**. There is deliberately no "list all"
and no wildcard: a compromised client should be able to ask for one thing the
user already opted into, not enumerate everything.

## Transport: a named pipe, not localhost HTTP

A loopback HTTP or WebSocket server is reachable by every process on the
machine, and in several browser configurations by any web page the user has
open. For a value that grants account access that is the wrong shape. A
Windows named pipe is reachable only by local processes and carries the
caller's identity.

Rejected, with reasons:

| Option | Why not |
|---|---|
| localhost HTTP | reachable by any local process and by browser pages; needs its own auth layer |
| WebSocket | same exposure; browser Local Network Access rules do not currently gate WebSockets |
| arbitrary TCP port | same as above, plus firewall prompts |
| clipboard automation | races with whatever the user is doing; observable by every app |

VRCX's own overlay server binds `127.0.0.1:34582` with no origin check. That
is the pattern to avoid, not to copy.

## Required before any of this is built

1. **Explicit per-account opt-in.** Off by default. Enabling it is a
   deliberate act, per authenticator, not a global switch.
2. **Caller authentication.** A shared secret established through the UI, so
   any local process cannot simply connect and ask.
3. **Sender trust for email codes.** Email-sourced codes currently take the
   service name from the sender's display name, and Spam is synced. A spoofed
   "VRChat" email could therefore present a plausible code. Automating a code
   into a login form without verifying message authenticity (DKIM/DMARC) would
   turn a phishing email into an automated account takeover. **This must be
   fixed before any bridge ships**, and it is worth fixing regardless.
4. **Rate limiting and an audit trail**, so unexpected requests are visible.

## Explicitly out of scope

Filling VRChat login forms, browser automation, and any modification to VRCX
itself. Handing over a code is the whole job; deciding what to do with it is
the other application's.
