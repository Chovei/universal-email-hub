const SUBJECT_KEYWORDS = [
  'verification', 'verify', 'otp', 'one-time', 'one time',
  'security code', 'login code', 'sign-in code', 'sign in code',
  'authentication code', 'access code', 'confirmation code',
  'your code', 'passcode', '2fa', 'two-factor', 'auth code',
  'activate your', 'reset your password', 'confirm your',
]

const BODY_KEYWORDS = [
  'verification code', 'your code is', 'your otp', 'one-time password',
  'one-time code', 'security code', 'login code', 'use this code',
  'enter this code', 'enter the code', 'temporary code', 'confirmation code',
  'access code',
]

export interface ExtractedVerification {
  code: string
  /** 0..1 — how certain we are this is a real verification code */
  confidence: number
}

const SERVICE_DOMAINS: Record<string, string> = {
  'vrchat.com': 'VRChat',
  'mail.vrchat.com': 'VRChat',
  'discord.com': 'Discord',
  'discordapp.com': 'Discord',
  'steampowered.com': 'Steam',
  'steam.pm': 'Steam',
  'valvesoftware.com': 'Steam',
  'epicgames.com': 'Epic Games',
  'ea.com': 'EA',
  'origin.com': 'EA / Origin',
  'riotgames.com': 'Riot Games',
  'meta.com': 'Meta',
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',
  'twitter.com': 'X / Twitter',
  'x.com': 'X / Twitter',
  'tiktok.com': 'TikTok',
  'twitch.tv': 'Twitch',
  'youtube.com': 'YouTube',
  'google.com': 'Google',
  'accounts.google.com': 'Google',
  'microsoft.com': 'Microsoft',
  'live.com': 'Microsoft',
  'apple.com': 'Apple',
  'amazon.com': 'Amazon',
  'paypal.com': 'PayPal',
  'github.com': 'GitHub',
  'netflix.com': 'Netflix',
  'spotify.com': 'Spotify',
  'blizzard.com': 'Blizzard',
  'ubisoft.com': 'Ubisoft',
  'activision.com': 'Activision',
  'reddit.com': 'Reddit',
  'cloudflare.com': 'Cloudflare',
  'slack.com': 'Slack',
  'zoom.us': 'Zoom',
  'linkedin.com': 'LinkedIn',
  'snapchat.com': 'Snapchat',
  'roblox.com': 'Roblox',
  'minecraft.net': 'Minecraft',
  'mojang.com': 'Minecraft',
  'dropbox.com': 'Dropbox',
  'notion.so': 'Notion',
  'steam.community': 'Steam',
}

export function isVerificationEmail(subject: string, bodyText: string): boolean {
  const lc = subject.toLowerCase()
  if (SUBJECT_KEYWORDS.some((k) => lc.includes(k))) return true
  // "483920 is your Instagram code" — number + code-word in the subject
  if (/\b\d{4,8}\b/.test(subject) && /\b(code|otp|pin|passcode|2fa)\b/i.test(subject)) return true
  const lcBody = bodyText.toLowerCase().slice(0, 3000)
  return BODY_KEYWORDS.some((k) => lcBody.includes(k))
}

// ── Scored extraction ──────────────────────────────────────────────────────
// Candidates are generated in priority order; each must survive the
// rejection filters (years, order/tracking numbers, currency, phone shapes)
// before being returned. False positives are worse than misses — a wrong
// code copied into a login form actively hurts the user.

const CONTEXT_RE =
  /\b(?:code|otp|pin|passcode|password)\b(?:\s+is)?[:\s=-]{1,5}(\d{3}[\s-]\d{3,5}|\d{4,8}|[A-Z0-9]{4,10})/i

const REJECT_PREFIX_RE = /\b(order|invoice|tracking|ticket|case|ref|room|flight)\b[\s#:.]*$/i
const CURRENCY_PREFIX_RE = /[$€£¥]\s{0,2}[\d.,]*$/

function normalizeBody(bodyText: string): string {
  return bodyText.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').slice(0, 5000)
}

function cleanCode(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

function isYear(code: string): boolean {
  if (!/^\d{4}$/.test(code)) return false
  const n = Number(code)
  return n >= 1900 && n <= 2099
}

/** Reject candidates embedded in phone-number-shaped digit runs. */
function looksLikePhoneContext(text: string, index: number, matchLength: number): boolean {
  let start = index
  let end = index + matchLength
  const isPhoneChar = (c: string) => /[\d\s()+\-.]/.test(c)
  while (start > 0 && isPhoneChar(text[start - 1])) start--
  while (end < text.length && isPhoneChar(text[end])) end++
  const expansion = text.slice(start, end)
  const digitCount = (expansion.match(/\d/g) ?? []).length
  return digitCount > 8 || /[+(]/.test(expansion)
}

function passesFilters(text: string, index: number, rawMatch: string, code: string): boolean {
  if (isYear(code)) return false
  const before = text.slice(Math.max(0, index - 24), index)
  if (REJECT_PREFIX_RE.test(before)) return false
  if (CURRENCY_PREFIX_RE.test(before)) return false
  if (looksLikePhoneContext(text, index, rawMatch.length)) return false
  return true
}

export function extractVerification(
  subject: string,
  bodyText: string
): ExtractedVerification | null {
  const body = normalizeBody(bodyText)
  const lcBody = body.toLowerCase()
  const hasBodyKeyword = BODY_KEYWORDS.some((k) => lcBody.includes(k))

  // 1. Context-labelled code in body or subject ("your code is: X")
  for (const text of [body, subject]) {
    const m = CONTEXT_RE.exec(text)
    if (m) {
      const code = cleanCode(m[1])
      const codeIndex = m.index + m[0].indexOf(m[1])
      // Alphanumeric tokens must contain a digit — pure words like "PASS" aren't codes
      const validShape = /\d/.test(code) && code.length >= 4
      if (validShape && passesFilters(text, codeIndex, m[1], code)) {
        return { code, confidence: code.length <= 5 ? 0.85 : 0.95 }
      }
    }
  }

  // 2. Code in the subject line of a code-flavored subject
  if (/\b(code|otp|pin|passcode|2fa|verification)\b/i.test(subject)) {
    const m = /\b(\d{3}[\s-]\d{3,5}|\d{4,8})\b/.exec(subject)
    if (m) {
      const code = cleanCode(m[1])
      if (passesFilters(subject, m.index, m[1], code)) {
        return { code, confidence: 0.9 }
      }
    }
  }

  // 3. Bare 6-8 digit number in a verification-flavored email
  if (isVerificationEmail(subject, bodyText)) {
    const re = /\b(\d{3}[\s-]\d{3,5}|\d{6,8})\b/g
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) {
      const code = cleanCode(m[1])
      if (code.length >= 6 && passesFilters(body, m.index, m[1], code)) {
        return { code, confidence: 0.7 }
      }
    }
  }

  // 4. Bare 4-5 digit number — lowest confidence, body keywords required
  if (hasBodyKeyword) {
    const re = /\b(\d{4,5})\b/g
    let m: RegExpExecArray | null
    while ((m = re.exec(body)) !== null) {
      const code = m[1]
      if (passesFilters(body, m.index, m[1], code)) {
        return { code, confidence: 0.55 }
      }
    }
  }

  return null
}

/** Backward-compatible wrapper for callers that only want the code string. */
export function extractCode(subject: string, bodyText: string): string | null {
  return extractVerification(subject, bodyText)?.code ?? null
}

export function detectServiceName(fromAddress: string, fromName: string | null): string {
  const domain = fromAddress.split('@')[1]?.toLowerCase() ?? ''

  const exact = SERVICE_DOMAINS[domain]
  if (exact) return exact

  for (const [key, name] of Object.entries(SERVICE_DOMAINS)) {
    if (domain.endsWith('.' + key)) return name
  }

  if (fromName) {
    const cleaned = fromName
      .replace(/\s+(support|noreply|no-reply|notifications?|team|help|security|account|info|alerts?|service)$/i, '')
      .trim()
    if (cleaned.length > 0 && cleaned.length <= 40) return cleaned
  }

  // Derive from base domain: "vrchat.com" -> "Vrchat"
  const baseDomain = domain.split('.').slice(-2, -1)[0] ?? domain
  return baseDomain.charAt(0).toUpperCase() + baseDomain.slice(1)
}
