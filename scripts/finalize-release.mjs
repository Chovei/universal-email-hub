// Post-publish step for `npm run release`.
//
//  1. Sets the GitHub release body from CHANGELOG (electron-builder writes
//     the notes into latest.yml for the in-app "What's New" but leaves the
//     release page empty).
//
//  2. Verifies — and repairs — the uploaded artifacts.
//
// Why (2) exists: electron-builder's GitHub uploader has silently truncated
// the installer on consecutive releases (v0.1.20 short by 315 bytes, v0.1.21
// by 253). It reports a clean publish either way. The damage surfaces only on
// users' machines, as "sha512 checksum mismatch" or, when the download dies
// mid-stream, ERR_HTTP2_PROTOCOL_ERROR — auto-update broken for everyone.
//
// Checking once immediately after publish is not enough: GitHub's API reports
// the expected size while the object is still settling, so an early check
// passes and the truncation appears afterwards. This polls until the reported
// state is stable, compares against the local build by sha256, and re-uploads
// through the REST API (which has been reliable) when they differ.

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

const headers = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'universal-email-hub-release',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getRelease() {
  // Resolve by tag and then reuse the API urls the response carries: they are
  // canonical and survive a repository rename, which the owner/name form does
  // not (it answers with a 307 that fetch will not replay for PATCH/DELETE).
  const res = await fetch(
    `https://api.github.com/repos/Fatexxp/universal-email-hub/releases/tags/v${version}`,
    { headers, redirect: 'follow' }
  )
  if (!res.ok) throw new Error(`Could not find release v${version}: ${res.status}`)
  return res.json()
}

// ── 1. Release notes ────────────────────────────────────────────────────────

let release = await getRelease()

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

// ── 2. Verify and repair artifacts ──────────────────────────────────────────

/** Local files that must appear on the release byte-for-byte. */
function localArtifacts() {
  const yml = readFileSync(path.join(root, 'dist', 'latest.yml'), 'utf8')
  const installerAsset = /url:\s*(\S+)/.exec(yml)?.[1]
  if (!installerAsset) throw new Error('Could not read the installer name from dist/latest.yml')

  const installerLocal = path.join(root, 'dist', `Universal Email Hub Setup ${version}.exe`)
  const out = [{ assetName: installerAsset, localPath: installerLocal }]

  const blockmapLocal = `${installerLocal}.blockmap`
  try {
    if (statSync(blockmapLocal).isFile()) {
      out.push({ assetName: `${installerAsset}.blockmap`, localPath: blockmapLocal })
    }
  } catch { /* differential updates disabled — nothing to check */ }
  return out
}

function fingerprint(file) {
  const buf = readFileSync(file)
  return { buf, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }
}

function assetMatches(asset, fp) {
  if (!asset || asset.size !== fp.size) return false
  // GitHub reports the digest of what it actually stored; when present it is
  // authoritative and catches corruption that a size check alone would miss.
  if (asset.digest?.startsWith('sha256:')) {
    return asset.digest.slice('sha256:'.length) === fp.sha256
  }
  return true
}

async function uploadAsset(rel, assetName, buf) {
  const uploadUrl = `${rel.upload_url.split('{')[0]}?name=${encodeURIComponent(assetName)}`
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    body: buf,
  })
  if (!res.ok) throw new Error(`upload of ${assetName} failed: ${res.status} ${await res.text()}`)
}

const MAX_REPAIRS = 2
let failed = false

for (const { assetName, localPath } of localArtifacts()) {
  const fp = fingerprint(localPath)
  let ok = false

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    // Let the freshly uploaded object settle before trusting what the API says
    await sleep(attempt === 0 ? 5000 : 3000)
    release = await getRelease()
    const asset = release.assets.find((a) => a.name === assetName)

    if (assetMatches(asset, fp)) {
      ok = true
      console.log(`[release] Verified ${assetName} (${fp.size} bytes)`)
      break
    }

    if (attempt === MAX_REPAIRS) break
    console.warn(
      `[release] ${assetName} on GitHub does not match the local build ` +
        `(stored ${asset ? asset.size : 'missing'} vs built ${fp.size}) — re-uploading`
    )
    if (asset) {
      const del = await fetch(asset.url, { method: 'DELETE', headers })
      if (!del.ok && del.status !== 404) {
        console.error(`[release] Could not delete the bad asset: ${del.status}`)
        break
      }
    }
    await uploadAsset(release, assetName, fp.buf)
  }

  if (!ok) {
    failed = true
    console.error(
      `[release] ${assetName} could NOT be published intact after ${MAX_REPAIRS} repair attempts.\n` +
        `  Auto-update will fail for every user until this is fixed.\n` +
        `  Upload dist/${path.basename(localPath)} to the v${version} release by hand.`
    )
  }
}

if (failed) process.exit(1)
console.log(`[release] v${version} published and verified intact`)
