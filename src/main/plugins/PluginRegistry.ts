import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { InstalledPlugin, PluginManifest } from '@shared/types/plugin'

export class PluginRegistry {
  private static instance: PluginRegistry
  private plugins = new Map<string, InstalledPlugin>()
  private storePath: string

  private constructor() {
    this.storePath = path.join(app.getPath('userData'), 'plugins.json')
    this.load()
  }

  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry()
    }
    return PluginRegistry.instance
  }

  listPlugins(): PluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest)
  }

  async install(manifestPath: string): Promise<PluginManifest> {
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Plugin manifest not found')
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest
    this.validateManifest(manifest)

    const plugin: InstalledPlugin = {
      manifest,
      installedAt: Date.now(),
      isEnabled: true,
      path: path.dirname(manifestPath),
    }

    this.plugins.set(manifest.id, plugin)
    this.save()
    return manifest
  }

  async uninstall(pluginId: string): Promise<void> {
    this.plugins.delete(pluginId)
    this.save()
  }

  private validateManifest(manifest: unknown): asserts manifest is PluginManifest {
    if (!manifest || typeof manifest !== 'object') throw new Error('Invalid manifest')
    const m = manifest as Record<string, unknown>
    if (typeof m['id'] !== 'string') throw new Error('Missing plugin id')
    if (typeof m['name'] !== 'string') throw new Error('Missing plugin name')
    if (typeof m['version'] !== 'string') throw new Error('Missing plugin version')
    if (typeof m['entrypoint'] !== 'string') throw new Error('Missing plugin entrypoint')
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) as InstalledPlugin[]
        for (const plugin of data) {
          this.plugins.set(plugin.manifest.id, plugin)
        }
      }
    } catch {
      // Corrupt store — start fresh
    }
  }

  private save(): void {
    const data = [...this.plugins.values()]
    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2))
  }
}
