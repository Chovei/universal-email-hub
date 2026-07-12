// Translate raw provider/network errors into guidance a non-technical user
// can act on. The raw error stays available behind a details disclosure —
// never as the primary message.

export interface HumanError {
  title: string
  hint: string
}

const AUTH_RE = /authenticationfailed|invalid credentials|login failed|auth failed|username and password not accepted|application-specific password/i
const NETWORK_RE = /enotfound|econnrefused|etimedout|ehostunreach|enetunreach|socket hang up|getaddrinfo/i
const TLS_RE = /certificate|self[- ]signed|unable to verify|ssl|tls handshake/i

const APP_PASSWORD_HINTS: Record<string, HumanError> = {
  gmail: {
    title: 'Your Gmail sign-in was rejected',
    hint: 'Gmail requires an App Password — your normal password won’t work here. Turn on 2-Step Verification, then create one at myaccount.google.com/apppasswords.',
  },
  yahoo: {
    title: 'Your Yahoo sign-in was rejected',
    hint: 'Yahoo requires an App Password for mail apps. Create one under Yahoo Account Security → Generate app password.',
  },
  icloud: {
    title: 'Your iCloud sign-in was rejected',
    hint: 'iCloud requires an app-specific password. Create one at appleid.apple.com → Sign-In and Security → App-Specific Passwords.',
  },
  aol: {
    title: 'Your AOL sign-in was rejected',
    hint: 'AOL requires an App Password for mail apps. Create one under AOL Account Security → Generate app password.',
  },
}

export function humanizeWizardError(providerId: string, raw: string): HumanError {
  if (AUTH_RE.test(raw)) {
    const specific = APP_PASSWORD_HINTS[providerId]
    if (specific) return specific
    return {
      title: 'Your sign-in was rejected',
      hint: 'Check your username and password. Some providers also require enabling IMAP access in their settings before mail apps can connect.',
    }
  }

  if (NETWORK_RE.test(raw)) {
    return {
      title: "Can't reach the mail server",
      hint: 'Check the server address and your internet connection, then try again.',
    }
  }

  if (TLS_RE.test(raw)) {
    return {
      title: 'Secure connection failed',
      hint: 'The server’s security certificate could not be verified. Double-check the server address and port.',
    }
  }

  return {
    title: 'Connection failed',
    hint: raw,
  }
}
