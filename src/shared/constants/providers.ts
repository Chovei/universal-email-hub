export type ProviderKind =
  | 'gmail'
  | 'graph'
  | 'outlook'
  | 'imap'
  | 'yahoo'
  | 'icloud'
  | 'exchange'
  | 'zoho'
  | 'fastmail'
  | 'aol'
  | 'gmx'
  | 'rambler'

export interface ProviderMeta {
  kind: ProviderKind
  label: string
  color: string
  authType: 'oauth' | 'password' | 'apppassword'
  defaultHost?: string
  defaultPort?: number
  defaultSmtpHost?: string
  defaultSmtpPort?: number
  supportsIdle: boolean
  supportsPush: boolean
  iconId: string
}

export const PROVIDER_META: Record<ProviderKind, ProviderMeta> = {
  gmail: {
    kind: 'gmail',
    label: 'Gmail',
    color: '#EA4335',
    authType: 'apppassword',
    defaultHost: 'imap.gmail.com',
    defaultPort: 993,
    defaultSmtpHost: 'smtp.gmail.com',
    defaultSmtpPort: 587,
    supportsIdle: true,
    supportsPush: false,
    iconId: 'gmail',
  },
  graph: {
    kind: 'graph',
    label: 'Microsoft (Outlook / 365)',
    color: '#0078D4',
    authType: 'oauth',
    supportsIdle: false,
    supportsPush: true,
    iconId: 'microsoft',
  },
  outlook: {
    kind: 'outlook',
    label: 'Outlook / Hotmail',
    color: '#0078D4',
    authType: 'password',
    defaultHost: 'outlook.office365.com',
    defaultPort: 993,
    defaultSmtpHost: 'smtp.office365.com',
    defaultSmtpPort: 587,
    supportsIdle: true,
    supportsPush: false,
    iconId: 'microsoft',
  },
  imap: {
    kind: 'imap',
    label: 'Custom IMAP / SMTP',
    color: '#6366F1',
    authType: 'password',
    supportsIdle: true,
    supportsPush: true,
    iconId: 'mail',
  },
  yahoo: {
    kind: 'yahoo',
    label: 'Yahoo Mail',
    color: '#6001D2',
    authType: 'password',
    defaultHost: 'imap.mail.yahoo.com',
    defaultPort: 993,
    defaultSmtpHost: 'smtp.mail.yahoo.com',
    defaultSmtpPort: 465,
    supportsIdle: true,
    supportsPush: true,
    iconId: 'yahoo',
  },
  icloud: {
    kind: 'icloud',
    label: 'iCloud Mail',
    color: '#3A7BD5',
    authType: 'apppassword',
    defaultHost: 'imap.mail.me.com',
    defaultPort: 993,
    defaultSmtpHost: 'smtp.mail.me.com',
    defaultSmtpPort: 587,
    supportsIdle: true,
    supportsPush: true,
    iconId: 'apple',
  },
  exchange: {
    kind: 'exchange',
    label: 'Microsoft Exchange',
    color: '#0078D4',
    authType: 'oauth',
    supportsIdle: false,
    supportsPush: false,
    iconId: 'microsoft',
  },
  zoho: {
    kind: 'zoho',
    label: 'Zoho Mail',
    color: '#E42527',
    authType: 'password',
    defaultHost: 'imappro.zoho.com',
    defaultPort: 993,
    defaultSmtpHost: 'smtppro.zoho.com',
    defaultSmtpPort: 465,
    supportsIdle: true,
    supportsPush: false,
    iconId: 'zoho',
  },
  fastmail: {
    kind: 'fastmail',
    label: 'Fastmail',
    color: '#E36B00',
    authType: 'password',
    defaultHost: 'imap.fastmail.com',
    defaultPort: 993,
    defaultSmtpHost: 'smtp.fastmail.com',
    defaultSmtpPort: 465,
    supportsIdle: true,
    supportsPush: false,
    iconId: 'fastmail',
  },
  aol: {
    kind: 'aol',
    label: 'AOL Mail',
    color: '#FF0B00',
    authType: 'password',
    defaultHost: 'imap.aol.com',
    defaultPort: 993,
    defaultSmtpHost: 'smtp.aol.com',
    defaultSmtpPort: 465,
    supportsIdle: true,
    supportsPush: false,
    iconId: 'aol',
  },
  gmx: {
    kind: 'gmx',
    label: 'GMX Mail',
    color: '#1F5FA6',
    authType: 'password',
    defaultHost: 'imap.gmx.com',
    defaultPort: 993,
    defaultSmtpHost: 'mail.gmx.com',
    defaultSmtpPort: 465,
    supportsIdle: true,
    supportsPush: false,
    iconId: 'gmx',
  },
  rambler: {
    kind: 'rambler',
    label: 'Rambler Mail',
    color: '#F24C00',
    authType: 'password',
    defaultHost: 'imap.rambler.ru',
    defaultPort: 993,
    defaultSmtpHost: 'smtp.rambler.ru',
    defaultSmtpPort: 465,
    supportsIdle: true,
    supportsPush: false,
    iconId: 'rambler',
  },
}
