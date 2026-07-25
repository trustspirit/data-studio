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
  {
    ...shared,
    entry: { index: 'src/preload/index.ts' },
    outDir: 'dist/preload',
    // 샌드박스 preload는 node_modules를 require할 수 없으므로
    // electron을 제외한 모든 의존성을 번들에 포함한다.
    noExternal: [/^(?!electron$)/],
  },
])
