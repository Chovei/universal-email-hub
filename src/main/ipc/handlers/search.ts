import { ipcMain } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import { SearchQuerySchema } from '../validator'
import { searchMessages, getSuggestions } from '../../db/queries/search'

export function registerSearchHandlers(): void {
  ipcMain.handle(IPC.SEARCH_QUERY, async (_event, payload: unknown) => {
    try {
      const parsed = SearchQuerySchema.parse(payload)
      const results = searchMessages(parsed)
      return { data: results }
    } catch (err) {
      return { error: { code: 'SEARCH_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.SEARCH_SUGGEST, async (_event, partial: string) => {
    try {
      if (typeof partial !== 'string' || partial.length < 2) {
        return { data: [] }
      }
      const suggestions = getSuggestions(partial.slice(0, 200))
      return { data: suggestions }
    } catch (err) {
      return { error: { code: 'SUGGEST_ERROR', message: String(err) } }
    }
  })
}
