/// <reference types="vite/client" />

import type { EmailAPI } from '@shared/types/ipc'

declare global {
  interface Window {
    emailAPI: EmailAPI
  }
}

export {}
