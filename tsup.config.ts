import { defineConfig, type Options } from 'tsup'

const shared: Partial<Options> = {
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  clean: false,
}

export default defineConfig([
  { ...shared, entry: { index: 'src/main/index.ts' }, outDir: 'dist/main', clean: true },
  { ...shared, entry: { index: 'src/preload/index.ts' }, outDir: 'dist/preload' },
])
