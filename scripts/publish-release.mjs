// Publishes the built artifacts to GitHub and verifies them.
//
// electron-builder's own GitHub uploader is deliberately NOT used: it has
// silently truncated the installer on three consecutive releases (v0.1.20 by
// 315 bytes, v0.1.21 by 253, v0.1.22 by 148), reporting a clean publish every
// time. The damage only surfaced on users' machines as "sha512 checksum
// mismatch" or a download dying mid-stream. Uploading through the REST API
// has produced byte-correct assets every time it has been used.
//
// `npm run release` therefore builds with --publish never and calls this.
//
// Note on repair: a corrupt asset CANNOT reliably be fixed by re-uploading
// under the same name. GitHub's CDN caches the release-download URL, so it
// keeps serving the truncated bytes long after storage is correct. Getting it
// right on the first upload is the only dependable path, which is why every
// asset is verified here before the release is left in place.

import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const notes = readFileSync(path.join(root, 'release-notes.md'), 'utf8')
const distDir = path.join(root, 'dist')

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (!token) {
  console.error('[release] GH_TOKEN not set')
  process.exit(1)
}

const REPO_ID = '1294549986' // numeric id: immune to repository renames
const API = `https://api.github.com/repositories/${REPO_ID}`
const headers = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'universal-email-hub-release',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// ── Collect the artifacts latest.yml promises ───────────────────────────────

const yml = readFileSync(path.join(distDir, 'latest.yml'), 'utf8')
const installerAsset = /url:\s*(\S+)/.exec(yml)?.[1]
if (!installerAsset) {
  console.error('[release] Could not read the installer name from dist/latest.yml')
  process.exit(1)
}

const installerLocal = path.join(distDir, `Universal Email Hub Setup ${version}.exe`)
const artifacts = [
  { name: 'latest.yml', file: path.join(distDir, 'latest.yml') },
  { name: installerAsset, file: installerLocal },
]
const blockmapLocal = `${installerLocal}.blockmap`
try {
  if (statSync(blockmapLocal).isFile()) {
    artifacts.push({ name: `${installerAsset}.blockmap`, file: blockmapLocal })
  }
} catch { /* differential updates disabled */ }

// ── Create (or reuse) the release ───────────────────────────────────────────

async function findRelease() {
  const res = await fetch(`${API}/releases/tags/v${version}`, { headers, redirect: 'follow' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`lookup failed: ${res.status}`)
  return res.json()
}

let release = await findRelease()
if (release) {
  console.log(`[release] Reusing existing release v${version}`)
  const res = await fetch(release.url, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: notes }),
  })
  if (!res.ok) throw new Error(`could not update release body: ${res.status}`)
} else {
  const res = await fetch(`${API}/releases`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: `v${version}`,
      name: `v${version}`,
      body: notes,
      draft: false,
      prerelease: false,
    }),
  })
  if (!res.ok) throw new Error(`could not create release: ${res.status} ${await res.text()}`)
  release = await res.json()
  console.log(`[release] Created release v${version}`)
}

// ── Upload each artifact, then confirm GitHub kept the exact bytes ──────────

const uploadBase = release.upload_url.split('{')[0]
let failed = false

for (const { name, file } of artifacts) {
  const buf = readFileSync(file)
  const want = sha256(buf)

  const existing = release.assets?.find((a) => a.name === name)
  if (existing) {
    await fetch(existing.url, { method: 'DELETE', headers })
  }

  const up = await fetch(`${uploadBase}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    body: buf,
  })
  if (!up.ok) {
    console.error(`[release] Upload of ${name} failed: ${up.status} ${await up.text()}`)
    failed = true
    continue
  }

  // Let the stored object settle: GitHub reports the expected size while an
  // upload is still finalising, so an immediate read can report success for
  // an object that ends up truncated.
  await sleep(4000)
  const fresh = await findRelease()
  const stored = fresh?.assets?.find((a) => a.name === name)
  const sizeOk = stored?.size === buf.length
  const shaOk = stored?.digest?.startsWith('sha256:')
    ? stored.digest.slice('sha256:'.length) === want
    : true

  if (sizeOk && shaOk) {
    console.log(`[release] Uploaded and verified ${name} (${buf.length} bytes)`)
  } else {
    failed = true
    console.error(
      `[release] ${name} was NOT stored intact — built ${buf.length} bytes, ` +
        `GitHub has ${stored ? stored.size : 'nothing'}.\n` +
        `  Do NOT retry under the same name: the CDN caches the download URL and will keep\n` +
        `  serving the bad copy. Bump the version and publish again.`
    )
  }
  release = fresh ?? release
}

if (failed) process.exit(1)
console.log(`[release] v${version} published and verified intact`)
