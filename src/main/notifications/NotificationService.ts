import { Notification, app } from 'electron'
import { getMainWindow, setBadgeCount } from '../window'
import { getTotalUnreadCount } from '../db/queries/threads'
import { getSetting } from '../settings'

export class NotificationService {
  private static instance: NotificationService

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  notifyNewMessages(messages: { subject: string; fromName: string | null; fromAddress: string; accountId: string }[]): void {
    const settings = getSetting('notifications')
    if (!settings.enabled) return

    if (this.isInQuietHours()) return

    for (const msg of messages.slice(0, 3)) {
      const notification = new Notification({
        title: msg.fromName ?? msg.fromAddress,
        body: msg.subject || '(No Subject)',
        silent: !settings.sound,
      })

      notification.on('click', () => {
        const win = getMainWindow()
        if (win) {
          if (win.isMinimized()) win.restore()
          win.focus()
        }
      })

      notification.show()
    }

    this.updateBadge()
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
