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
    // src/shared/**는 renderer가 import할 수 있는 공용 코드다. renderer는
    // sandbox: true / nodeIntegration: false로 뜨므로 Node 전역이 번들에 아예
    // 없다 — 참조하면 런타임에 ReferenceError로 죽는다. tsconfig의
    // "types": ["node"]가 프로젝트 전역이라 tsc는 이것을 통과시킨다.
    //
    // tests/architecture/boundaries.test.ts에도 같은 취지의 정규식 가드가
    // 있지만 그것은 **텍스트**를 볼 뿐이라 구조적으로 놓치는 형태가 있다:
    // `const B = Buffer; B.from(x)` 같은 별칭과 `Buffer['from'](x)` 같은
    // 계산된 접근이 그렇다. 실제로 두 형태 모두 그 테스트와 lint와 tsc를
    // 전부 통과한 적이 있고, wire.ts가 이 버그를 한 번 실어 보낸 적도 있다.
    // ESLint는 텍스트가 아니라 **식별자를 스코프로 해석**하므로 두 형태를
    // 모두 잡는다. 정규식 가드는 심층 방어로 남겨 둔다.
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Buffer', message: 'shared는 renderer가 쓴다. Buffer 대신 Uint8Array를 써라' },
        { name: 'process', message: 'shared에서는 process를 쓸 수 없다. 값을 인자로 넘겨라' },
        { name: '__dirname', message: 'shared에서는 __dirname을 쓸 수 없다' },
        { name: '__filename', message: 'shared에서는 __filename을 쓸 수 없다' },
        { name: 'require', message: 'shared에서는 require를 쓸 수 없다. ESM import를 써라' },
        { name: 'global', message: 'shared에서는 global을 쓸 수 없다. globalThis를 써라' },
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
