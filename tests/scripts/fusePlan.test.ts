import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

interface FuseValues {
  runAsNode: boolean
  nodeCliInspectArguments: boolean
  nodeOptionsEnvironmentVariable: boolean
  cookieEncryption: boolean
  onlyLoadAppFromAsar: boolean
  embeddedAsarIntegrityValidation: boolean
  resetAdHocDarwinSignature: boolean
}

interface Packager {
  appInfo: { productFilename: string }
  executableName?: string
}

const { fuseValues, resolveExecutablePath } = require(
  path.resolve('scripts/fusePlan.cjs'),
) as {
  fuseValues: (platform: string) => FuseValues
  resolveExecutablePath: (platform: string, outDir: string, packager: Packager) => string
}

/** darwin/win32 패키저에는 `executableName`이 없다. 읽으면 던지게 해 둔다. */
function packagerWithoutExecutableName(): Packager {
  const packager = { appInfo: { productFilename: 'Database Studio' } }

  Object.defineProperty(packager, 'executableName', {
    get() {
      throw new Error('executableName is only available on LinuxPackager')
    },
  })

  return packager
}

describe('fuseValues', () => {
  it('임의 코드 실행 경로를 전부 닫는다', () => {
    // 이 셋 중 하나라도 true면 앱은 정상으로 보이면서 서명과 무관하게
    // 임의 스크립트를 돌릴 수 있다.
    const values = fuseValues('darwin')

    expect(values.runAsNode).toBe(false)
    expect(values.nodeCliInspectArguments).toBe(false)
    expect(values.nodeOptionsEnvironmentVariable).toBe(false)
  })

  it('asar 로딩 제한과 무결성 검증을 켠다', () => {
    const values = fuseValues('linux')

    expect(values.onlyLoadAppFromAsar).toBe(true)
    expect(values.embeddedAsarIntegrityValidation).toBe(true)
  })

  it('쿠키 암호화를 켠다', () => {
    expect(fuseValues('win32').cookieEncryption).toBe(true)
  })

  it('플랫폼이 달라도 보안 값은 같다', () => {
    // 한 플랫폼에서만 조여 두면 다른 플랫폼 빌드가 조용히 약해진다.
    // resetAdHocDarwinSignature만 플랫폼별로 다르며, 그건 보안 값이 아니라
    // darwin 서명 절차의 일부다.
    const security = (platform: string) => {
      const values = fuseValues(platform)
      return {
        runAsNode: values.runAsNode,
        nodeCliInspectArguments: values.nodeCliInspectArguments,
        nodeOptionsEnvironmentVariable: values.nodeOptionsEnvironmentVariable,
        cookieEncryption: values.cookieEncryption,
        onlyLoadAppFromAsar: values.onlyLoadAppFromAsar,
        embeddedAsarIntegrityValidation: values.embeddedAsarIntegrityValidation,
      }
    }

    expect(security('win32')).toEqual(security('darwin'))
    expect(security('linux')).toEqual(security('darwin'))
  })

  it('darwin에서만 ad-hoc 서명을 다시 만든다', () => {
    // fuse를 뒤집으면 기존 ad-hoc 서명이 깨진다. darwin에서 이걸 빠뜨리면
    // 패키징은 성공하는데 앱이 실행되지 않는다.
    expect(fuseValues('darwin').resetAdHocDarwinSignature).toBe(true)
    expect(fuseValues('win32').resetAdHocDarwinSignature).toBe(false)
    expect(fuseValues('linux').resetAdHocDarwinSignature).toBe(false)
  })
})

describe('resolveExecutablePath', () => {
  it('darwin에서 .app 번들 경로를 준다', () => {
    const resolved = resolveExecutablePath('darwin', '/out', packagerWithoutExecutableName())

    expect(resolved).toBe(path.join('/out', 'Database Studio.app'))
  })

  it('win32에서 .exe 경로를 준다', () => {
    const resolved = resolveExecutablePath('win32', '/out', packagerWithoutExecutableName())

    expect(resolved).toBe(path.join('/out', 'Database Studio.exe'))
  })

  it('linux에서 executableName을 쓴다', () => {
    const packager: Packager = {
      appInfo: { productFilename: 'Database Studio' },
      executableName: 'database-studio',
    }

    expect(resolveExecutablePath('linux', '/out', packager)).toBe(
      path.join('/out', 'database-studio'),
    )
  })

  it('darwin에서 executableName을 읽지 않는다', () => {
    // Phase 0a에서 실제로 났던 버그다: 분기를 객체 리터럴로 한 번에 계산하면
    // darwin 빌드가 이 속성 접근만으로 던진다. LinuxPackager에만 있는 값이다.
    expect(() =>
      resolveExecutablePath('darwin', '/out', packagerWithoutExecutableName()),
    ).not.toThrow()
  })

  it('win32에서도 executableName을 읽지 않는다', () => {
    expect(() =>
      resolveExecutablePath('win32', '/out', packagerWithoutExecutableName()),
    ).not.toThrow()
  })

  it('모르는 플랫폼은 조용히 넘어가지 않고 던진다', () => {
    // 조용히 통과시키면 fuse가 하나도 걸리지 않은 바이너리가 나간다.
    expect(() =>
      resolveExecutablePath('freebsd', '/out', packagerWithoutExecutableName()),
    ).toThrow(/unsupported platform/)
  })
})
