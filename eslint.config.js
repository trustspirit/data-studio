import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'

export default tseslint.config(
  {
    // scripts/afterPack.cjs는 electron-builder가 require()로 로딩하는 CJS 훅이다.
    // src/tests 바깥이라 tsconfig에도 포함되지 않는다 — 앱 소스가 아니라 빌드 도구이므로
    // 타입 인식 규칙(ESM 강제, no-unsafe-* 등) 대상에서 제외한다.
    ignores: ['dist/**', 'dist-electron/**', 'node_modules/**', 'scripts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
  },
  {
    // core는 안쪽 계층이다. 바깥 계층과 electron을 알아서는 안 된다.
    files: ['src/main/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/infrastructure/**'], message: 'core는 infrastructure를 import할 수 없다' },
            { group: ['**/drivers/**'], message: 'core는 drivers를 import할 수 없다' },
            { group: ['**/ipc/**'], message: 'core는 ipc를 import할 수 없다' },
            { group: ['**/security/**'], message: 'core는 security를 import할 수 없다' },
            { group: ['electron'], message: 'core는 electron에 의존할 수 없다' },
          ],
        },
      ],
    },
  },
  {
    // renderer 번들은 신뢰되지 않는 곳에서 실행된다. main 프로세스 코드가
    // 여기로 딸려 들어가면 커넥션 처리·비밀 취급 코드가 함께 실려 나간다.
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@main/*', '**/main/*'], message: 'renderer는 main 프로세스 코드를 import할 수 없다' },
            { group: ['electron'], message: 'renderer는 electron을 직접 import할 수 없다. preload를 통해라' },
          ],
        },
      ],
    },
  },
  {
    // renderer의 feature 슬라이스는 서로를 직접 import하지 않는다.
    files: ['src/renderer/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/*/*'],
              message: 'feature는 다른 feature의 내부를 import할 수 없다. entities로 내려라',
            },
          ],
        },
      ],
    },
  },
)
