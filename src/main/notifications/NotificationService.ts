import { Notification } from 'electron'
import { getMainWindow, setBadgeCount } from '../window'
import { getTotalUnreadCount } from '../db/queries/threads'
import { getSetting } from '../settings'
import { IPC } from '@shared/constants/ipc-channels'

export type NavigatePanel = 'inbox' | 'search' | 'settings' | 'verification'

interface NewMessageNotification {
  subject: string
  fromName: string | null
  fromAddress: string
  accountId: string
}

const MAX_INDIVIDUAL_NOTIFICATIONS = 3

export class NotificationService {
  private static instance: NotificationService

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  notifyNewMessages(messages: NewMessageNotification[]): void {
    const settings = getSetting('notifications')
    if (!settings.enabled) return
    if (this.isInQuietHours()) return

    // Respect per-account preferences — accounts default to enabled
    const allowed = messages.filter((m) => settings.perAccount[m.accountId] !== false)
    if (allowed.length === 0) return

    if (allowed.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
      // Grouped: one summary instead of a notification storm
      const senders = [...new Set(allowed.map((m) => m.fromName ?? m.fromAddress))]
      const preview = senders.slice(0, 3).join(', ')
      const more = senders.length > 3 ? ` and ${senders.length - 3} more` : ''
      this.show({
        title: `${allowed.length} new emails`,
        body: `From ${preview}${more}`,
        silent: !settings.sound,
        panel: 'inbox',
      })
    } else {
      for (const msg of allowed) {
        this.show({
          title: msg.fromName ?? msg.fromAddress,
          body: msg.subject || '(No Subject)',
          silent: !settings.sound,
          panel: 'inbox',
        })
      }
    }

    this.updateBadge()
  }

  notifyVerificationCode(payload: {
    serviceName: string
    code: string
    accountEmail: string
    accountId: string
  }): void {
    const settings = getSetting('notifications')
    if (!settings.enabled) return
    if (this.isInQuietHours()) return
    if (settings.perAccount[payload.accountId] === false) return

    this.show({
      title: `${payload.serviceName} verification code`,
      body: `${payload.code} — ${payload.accountEmail}\nClick to open the Verification Center`,
      silent: !settings.sound,
      panel: 'verification',
    })
  }

  private show(opts: { title: string; body: string; silent: boolean; panel: NavigatePanel }): void {
    const notification = new Notification({
      title: opts.title,
      body: opts.body,
      silent: opts.silent,
    })

    notification.on('click', () => {
      const win = getMainWindow()
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send(IPC.APP_NAVIGATE, { panel: opts.panel })
    })

    notification.show()
  }

  updateBadge(): void {
    const count = getTotalUnreadCount()
    setBadgeCount(count)
  }

  private isInQuietHours(): boolean {
    const settings = getSetting('notifications')
    if (!settings.quietHoursStart || !settings.quietHoursEnd) return false

    const now = new Date()
    const [startH, startM] = settings.quietHoursStart.split(':').map(Number)
    const [endH, endM] = settings.quietHoursEnd.split(':').map(Number)

    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const startMinutes = (startH ?? 0) * 60 + (startM ?? 0)
    const endMinutes = (endH ?? 0) * 60 + (endM ?? 0)

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes
    }
    return currentMinutes >= startMinutes || currentMinutes < endMinutes
  }
}
