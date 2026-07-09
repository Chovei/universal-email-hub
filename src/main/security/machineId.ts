import { machineIdSync } from 'node-machine-id'
import { deriveKey } from './encryption'

const APP_SALT = 'universal-email-hub-v1'

let _key: Buffer | null = null

export function getMachineKey(): Buffer {
  if (_key) return _key

  const id = machineIdSync()
  _key = deriveKey(id, APP_SALT)
  return _key
}
