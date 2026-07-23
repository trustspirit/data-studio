import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const CORE_DIR = path.resolve('src/main/core')
const RENDERER_DIR = path.resolve('src/renderer')
const SHARED_DIR = path.resolve('src/shared')
const SRC_DIR = path.resolve('src')
const PRELOAD_DIR = path.resolve('src/preload')

// Actor는 권한을 결정한다. renderer나 preload가 이걸 만들거나 IPC DTO에 실어
// 보낼 수 있게 되는 순간 XSS 하나로 `{ type: 'user' }`를 위조해 쓰기 승인
// 게이트 전체가 장식이 된다. actor는 언제나 main의 호출 경로가 만든다.
//
// 이건 한 줄짜리 import로 무너지는 성질이고, 코드 리뷰가 놓치기 쉽다.
// 그래서 문서가 아니라 테스트로 지킨다.
const ACTOR_MODULE_PATTERN = /['"][^'"]*core\/execution\/Actor['"]/

// renderer(sandbox: true, nodeIntegration: false)가 import할 수 있는 shared 모듈
// 안에서 이 전역들을 쓰면 타입은 통과하지만("types": ["node"]가 프로젝트 전역에
// 걸려 있어서) 번들에는 Node 폴리필이 없어 런타임에 ReferenceError로 죽는다.
// 실제 사용 형태(프로퍼티 접근/호출/식별자 자체)만 잡도록 좁혀서, 'require'
// 같은 흔한 단어를 값으로 쓰는 문자열 리터럴이나 문서 주석 속 언급을 오탐하지
// 않게 한다. 완벽한 파서는 아니므로 여전히 우회는 가능하지만, 실수로
// 재도입되는 것은 확실히 잡는다.
const NODE_ONLY_GLOBAL_PATTERN =
  /\bBuffer\s*[.(]|\bnew\s+Buffer\b|\bprocess\s*[.[]|\brequire\s*\(|\b__dirname\b|\b__filename\b/

// 바깥 계층 디렉토리 이름. core는 이 디렉토리들을 어떤 형태로도 import할 수 없다:
//   - 상대 경로, 어떤 깊이든: '../infrastructure', '../../../infrastructure/x' 등
//   - 별칭 경로: '@main/infrastructure', '@main/infrastructure/x'
const FORBIDDEN_LAYER_SEGMENTS = ['infrastructure', 'drivers', 'ipc', 'security']

// import/export의 정적 specifier(`from '...'`, `from "..."`)와
// 동적 import(`import('...')`), CommonJS `require('...')`를 모두 잡는다.
// `from`과 따옴표 사이의 공백은 optional이다 (`from"electron"`도 유효한 JS이기 때문).
const SPECIFIER_PATTERN = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g

function violatedLayer(specifier: string): string | null {
  if (specifier === 'electron' || specifier.startsWith('electron/')) {
    return 'electron'
  }

  for (const segment of FORBIDDEN_LAYER_SEGMENTS) {
    const relativeEscape = new RegExp(`^(\\.\\./)+${segment}(/|$)`)
    const aliasEscape = new RegExp(`^@main/${segment}(/|$)`)
    if (relativeEscape.test(specifier) || aliasEscape.test(specifier)) {
      return segment
    }
  }

  return null
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full
  }
}

describe('의존성 경계', () => {
  it('core는 바깥 계층이나 electron을 import하지 않는다', async () => {
    const violations: string[] = []

    for await (const file of walk(CORE_DIR)) {
      const source = await readFile(file, 'utf8')
      const imports = [...source.matchAll(SPECIFIER_PATTERN)].map((m) => m[1] ?? '')

      for (const specifier of imports) {
        const violated = violatedLayer(specifier)
        if (violated !== null) {
          violations.push(`${path.relative(process.cwd(), file)} → ${specifier} (${violated})`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('renderer는 main 프로세스 코드를 import하지 않는다', async () => {
    // renderer 번들은 신뢰되지 않는 곳에서 실행된다. main 프로세스 모듈이
    // 여기로 딸려 들어가면 커넥션 처리·비밀 취급 코드가 renderer 번들에
    // 실려 나간다.
    const violations: string[] = []

    for await (const file of walk(RENDERER_DIR)) {
      const source = await readFile(file, 'utf8')

      for (const match of source.matchAll(SPECIFIER_PATTERN)) {
        const specifier = match[1] ?? ''
        const reachesMain =
          /^@main(\/|$)/.test(specifier) || /^(\.\.\/)+main(\/|$)/.test(specifier)

        if (reachesMain) {
          violations.push(`${path.relative(process.cwd(), file)} → ${specifier}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('shared는 Node 전용 전역을 참조하지 않는다', async () => {
    // src/shared/**는 renderer가 import할 수 있는 공용 코드다. renderer는
    // sandbox: true / nodeIntegration: false로 뜨므로 Buffer/process/
    // __dirname/__filename/require는 번들에 존재하지 않는다. tsconfig의
    // "types": ["node"]가 프로젝트 전역이라 타입 체크는 통과해 버리므로,
    // 이 테스트가 유일한 안전망이다.
    const violations: string[] = []

    for await (const file of walk(SHARED_DIR)) {
      const source = await readFile(file, 'utf8')
      if (NODE_ONLY_GLOBAL_PATTERN.test(source)) {
        violations.push(path.relative(process.cwd(), file))
      }
    }

    expect(violations).toEqual([])
  })

  it('renderer가 고른 URL을 OS 브라우저로 넘기는 코드가 없다', async () => {
    // shell.openExternal에 renderer 출처 URL을 넘기면 그 자체가 유출 통로가
    // 된다 — CSP는 window.open을 덮지 못한다. 되살아나는 것을 막는 가드다.
    // 나중에 정당한 필요가 생기면 호스트 허용목록과 사용자 확인을 붙이고
    // 이 테스트를 그 조건에 맞게 고쳐야 한다.
    const violations: string[] = []

    for await (const file of walk(SRC_DIR)) {
      const source = await readFile(file, 'utf8')
      if (/openExternal/.test(source)) {
        violations.push(path.relative(process.cwd(), file))
      }
    }

    expect(violations).toEqual([])
  })

  it('shared와 preload는 Actor를 참조하지 않는다', async () => {
    // Actor가 IPC 계약에 들어가면 renderer가 자기 권한을 스스로 주장할 수 있게
    // 된다. 지금은 참조가 없지만, 이 성질은 한 줄로 무너지므로 테스트로 지킨다.
    const violations: string[] = []

    for (const dir of [SHARED_DIR, PRELOAD_DIR]) {
      for await (const file of walk(dir)) {
        const source = await readFile(file, 'utf8')
        if (ACTOR_MODULE_PATTERN.test(source)) {
          violations.push(path.relative(process.cwd(), file))
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('IPC 채널 계약에 actor 필드가 없다', async () => {
    // 위 테스트는 모듈 import를 막는다. 이건 타입을 베껴 적어 같은 구멍을 내는
    // 것을 막는다 — renderer가 보낸 값이 actor 판정에 쓰이면 안 된다.
    const violations: string[] = []

    for (const dir of [SHARED_DIR, PRELOAD_DIR]) {
      for await (const file of walk(dir)) {
        const source = await readFile(file, 'utf8')
        if (/\bactor\s*[?:]/i.test(source) || /\bsessionId\s*[?:]/.test(source)) {
          violations.push(path.relative(process.cwd(), file))
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('acquire()는 실행 관문과 커넥션 매니저 자신 외에서 호출되지 않는다', async () => {
    // acquire는 raw 드라이버를 담은 lease를 돌려준다. 정책 관문(OperationExecutor)을
    // 통하지 않고 이걸 쓰면 AI가 승인 없이 sql을 돌리는 우회가 생긴다. 관문이
    // 하나여야 한다는 설계는 이 호출을 한 곳에 가두는 것으로만 성립한다.
    //
    // ipcRoutes.ts(connection:open)는 예외로 허용한다 — lease를 얻은 즉시
    // describeCapabilities(lease.driver)로 어떤 capability 객체가 존재하는지만
    // (동기적으로) 읽고 finally에서 release한다. sql/schema/data의 어떤 메서드도
    // 호출하지 않으므로 actor 판정을 우회하는 데이터 접근 경로가 아니다.
    const allowed = new Set([
      path.resolve('src/main/core/execution/OperationExecutor.ts'),
      path.resolve('src/main/infrastructure/connection/PooledConnectionManager.ts'),
      path.resolve('src/main/app/ipcRoutes.ts'),
    ])
    const violations: string[] = []

    for await (const file of walk(SRC_DIR)) {
      if (allowed.has(file)) continue
      const source = await readFile(file, 'utf8')
      if (/\.acquire\s*\(/.test(source)) {
        violations.push(path.relative(process.cwd(), file))
      }
    }

    expect(violations).toEqual([])
  })
})
