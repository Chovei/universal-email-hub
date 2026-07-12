// electron-builder embeds releaseInfo.releaseNotesFile into latest.yml (which
// feeds the in-app "What's New"), but does NOT set the GitHub release body.
// This script patches the release body after publish so the release page
// shows the same notes. Runs as the final step of `npm run release`.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const notes = readFileSync(path.join(root, 'release-notes.md'), 'utf8')

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (!token) {
  console.error('[release-notes] GH_TOKEN not set — cannot update the GitHub release body')
  process.exit(1)
}

const repo = 'Fatexxp/universal-email-hub'
const headers = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'universal-email-hub-release',
}

const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${version}`, { headers })
if (!releaseRes.ok) {
  console.error(`[release-notes] Could not find release v${version}: ${releaseRes.status}`)
  process.exit(1)
}
const release = await releaseRes.json()

const patchRes = await fetch(`https://api.github.com/repos/${repo}/releases/${release.id}`, {
  method: 'PATCH',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ body: notes }),
})
if (!patchRes.ok) {
  console.error(`[release-notes] Failed to update release body: ${patchRes.status} ${await patchRes.text()}`)
  process.exit(1)
}
console.log(`[release-notes] GitHub release v${version} body updated (${notes.length} chars)`)
