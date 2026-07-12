// Extracts the CHANGELOG.md section for the current package.json version and
// writes it to release-notes.md. electron-builder attaches that file as the
// GitHub release body (releaseInfo.releaseNotesFile), which electron-updater
// then surfaces as "What's New" in the app.
//
// Fails the release when the changelog has no entry for the version being
// published — a release must never ship with an empty description.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')

const escaped = version.replace(/\./g, '\\.')
const sectionRe = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|$(?![\\s\\S]))`, 'm')
const match = sectionRe.exec(changelog)

if (!match || !match[1].trim()) {
  console.error(
    `[release-notes] CHANGELOG.md has no section for version ${version}.\n` +
      `Add a "## [${version}]" entry before releasing — releases must not ship without notes.`
  )
  process.exit(1)
}

const notes = match[1].trim() + '\n'
writeFileSync(path.join(root, 'release-notes.md'), notes)
console.log(`[release-notes] Extracted ${notes.split('\n').length} lines of notes for v${version} -> release-notes.md`)
