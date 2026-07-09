import log from 'electron-log'
import { app } from 'electron'

export function initLogger(): void {
  log.initialize()

  log.transports.file.level = 'info'
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

  log.transports.console.level = app.isPackaged ? false : 'debug'

  console.log = log.log.bind(log)
  console.info = log.info.bind(log)
  console.warn = log.warn.bind(log)
  console.error = log.error.bind(log)
  console.debug = log.debug.bind(log)

  log.info('[logger] v' + app.getVersion() + ' started. Log:', log.transports.file.getFile().path)
}

export const logger = {
  info: (...args: unknown[]) => log.info(...args),
  warn: (...args: unknown[]) => log.warn(...args),
  error: (...args: unknown[]) => log.error(...args),
  debug: (...args: unknown[]) => log.debug(...args),
  verbose: (...args: unknown[]) => log.verbose(...args),
}
