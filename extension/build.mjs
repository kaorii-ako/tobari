import { build } from 'esbuild'
import { cp, mkdir, readdir } from 'node:fs/promises'

await mkdir('dist', { recursive: true })

await build({
  entryPoints: ['src/background.ts'],
  outfile: 'dist/background.js',
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  logLevel: 'info',
})

await build({
  entryPoints: ['src/sidepanel.ts'],
  outfile: 'dist/sidepanel.js',
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  logLevel: 'info',
})

await build({
  entryPoints: ['src/extract.ts'],
  outfile: 'dist/extract.js',
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  logLevel: 'info',
})

const staticDir = 'static'
try {
  const files = await readdir(staticDir)
  for (const file of files) {
    await cp(`${staticDir}/${file}`, `dist/${file}`)
  }
} catch (err) {
  if (err.code !== 'ENOENT') throw err
}
await cp('manifest.json', 'dist/manifest.json')
