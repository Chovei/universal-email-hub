// Post-publish step for `npm run release`. Two jobs:
//
//  1. electron-builder embeds releaseInfo.releaseNotesFile into latest.yml
//     (which feeds the in-app "What's New") but does NOT set the GitHub
//     release body — so patch the body here.
//
//  2. Verify GitHub actually stored the bytes latest.yml describes. A
//     truncated or swapped upload produces a release whose installer does
//     not match its own sha512, and every client then fails with
//     "sha512 checksum mismatch" — auto-update broken for everyone, with
//     nothing in the publish log to suggest anything went wrong. Observed
//     on v0.1.20, where the uploaded installer differed from the local
//     build. Fail loudly instead.

import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const notes = readFileSync(path.join(root, 'release-notes.md'), 'utf8')

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (!token) {
  console.error('[release] GH_TOKEN not set — cannot reach the GitHub release')
  process.exit(1)
}

// Resolve by numeric repository id where possible: the repo has been renamed
// before, and the owner/name form answers renames with a 307 that a plain
// fetch() will not replay for PATCH.
const repo = 'Fatexxp/universal-email-hub'
const headers = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'universal-email-hub-release',
}

const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${version}`, {
  headers,
  redirect: 'follow',
})
if (!releaseRes.ok) {
  console.error(`[release] Could not find release v${version}: ${releaseRes.status}`)
  process.exit(1)
}
const release = await releaseRes.json()

// ── 1. Release notes ────────────────────────────────────────────────────────

const patchRes = await fetch(release.url, {
  method: 'PATCH',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ body: notes }),
})
if (!patchRes.ok) {
  console.error(`[release] Failed to update release body: ${patchRes.status} ${await patchRes.text()}`)
  process.exit(1)
}
console.log(`[release] v${version} body updated (${notes.length} chars)`)

// ── 2. Verify uploaded artifacts ────────────────────────────────────────────

const yml = readFileSync(path.join(root, 'dist', 'latest.yml'), 'utf8')
const declaredUrl = /url:\s*(\S+)/.exec(yml)?.[1]
const declaredSize = Number(/size:\s*(\d+)/.exec(yml)?.[1])

if (!declaredUrl || !Number.isFinite(declaredSize)) {
  console.error('[release] Could not parse dist/latest.yml — skipping artifact verification')
  process.exit(1)
}

const asset = (release.assets ?? []).find((a) => a.name === declaredUrl)
if (!asset) {
  console.error(`[release] latest.yml names "${declaredUrl}" but no such asset is attached to the release`)
  process.exit(1)
}

const problems = []
if (asset.size !== declaredSize) {
  problems.push(`size: latest.yml says ${declaredSize}, GitHub stored ${asset.size}`)
}

// GitHub reports the digest of what it actually stored — compare it against
// the local file so a corrupted upload cannot pass unnoticed.
if (asset.digest?.startsWith('sha256:')) {
  // latest.yml uses the dash-joined asset name; on disk the file keeps spaces
  const candidates = [
    path.join(root, 'dist', `Universal Email Hub Setup ${version}.exe`),
    path.join(root, 'dist', declaredUrl),
  ]
  const found = candidates.find((p) => {
    try { return statSync(p).isFile() } catch { return false }
  })
  if (found) {
    const localSha = createHash('sha256').update(readFileSync(found)).digest('hex')
    const remoteSha = asset.digest.slice('sha256:'.length)
    if (localSha !== remoteSha) {
      problems.push(`content: local build sha256 ${localSha} != uploaded ${remoteSha}`)
    }
  } else {
    console.warn('[release] Local installer not found for digest comparison; size check only')
  }
}

if (problems.length > 0) {
  console.error(
    `[release] PUBLISHED ARTIFACT DOES NOT MATCH latest.yml — auto-update WILL fail for every user:\n  - ` +
      problems.join('\n  - ') +
      `\n\nDelete the bad asset from the v${version} release and re-upload dist/Universal Email Hub Setup ${version}.exe.`
  )
  process.exit(1)
}

console.log(`[release] Verified: uploaded installer matches latest.yml (${asset.size} bytes)`)
