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

// Ordered most-specific first
const CODE_PATTERNS: RegExp[] = [
  /\b([0-9]{6,8})\b/,
  /\b([0-9]{3}[-\s][0-9]{3})\b/,
  /\b([0-9]{4})\b/,
]

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
  const lcBody = bodyText.toLowerCase().slice(0, 3000)
  return BODY_KEYWORDS.some((k) => lcBody.includes(k))
}

export function extractCode(subject: string, bodyText: string): string | null {
  // Try subject first: many services put the code directly there
  for (const pattern of CODE_PATTERNS) {
    const match = subject.match(pattern)
    if (match) return match[1].replace(/[-\s]/g, '')
  }

  // Strip HTML tags if any leaked into the text body
  const text = bodyText.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')

  // Context-aware extraction: code adjacent to known keywords
  const contextMatch = text.match(/(?:code|otp|pin|password|passcode)[:\s=]+([A-Z0-9]{4,10})/i)
  if (contextMatch) return contextMatch[1].replace(/[-\s]/g, '')

  // Fallback: first matching numeric pattern in body
  for (const pattern of CODE_PATTERNS) {
    const match = text.match(pattern)
    if (match) return match[1].replace(/[-\s]/g, '')
  }

  return null
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
