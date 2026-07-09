#!/usr/bin/env node
/**
 * Generates icon files from resources/icons/source.svg.
 *
 * Outputs:
 *   resources/icons/icon.png  — 512×512, used for Linux
 *   resources/icons/icon.ico  — multi-size ICO, used for Windows
 *
 * Run:  node scripts/generate-icons.mjs
 * Deps: @resvg/resvg-js, png2icons  (devDependencies)
 */
import { Resvg } from '@resvg/resvg-js'
import png2icons from 'png2icons'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const iconsDir = join(root, 'resources', 'icons')

mkdirSync(iconsDir, { recursive: true })

console.log('Generating icons from source.svg…')

const svgInput = readFileSync(join(iconsDir, 'source.svg'))

// Render at 512×512
const resvg = new Resvg(svgInput, { fitTo: { mode: 'width', value: 512 } })
const rendered = resvg.render()
const png512 = rendered.asPng()

writeFileSync(join(iconsDir, 'icon.png'), png512)
console.log('  ✓ icon.png  (512×512)')

// Multi-resolution ICO (256, 128, 64, 48, 32, 16)
const ico = png2icons.createICO(png512, png2icons.BILINEAR, 0, true, true)
if (!ico) throw new Error('ICO generation failed')
writeFileSync(join(iconsDir, 'icon.ico'), ico)
console.log('  ✓ icon.ico  (multi-size Windows ICO)')

console.log('Done.')
