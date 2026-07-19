const path = require('node:path')

/**
 * 패키징된 바이너리에 걸 fuse 값.
 *
 * 이 값들이 실제 보안 경계다. 하나라도 뒤집히면 앱은 정상으로 보이면서
 * 임의 코드 실행 경로가 열린다 — 그래서 별도 모듈로 떼어 테스트한다.
 * afterPack 훅은 electron-builder가 부르는 자리라 유닛 테스트가 어렵고,
 * 테스트되지 않는 자리에 보안 결정을 두고 싶지 않다.
 */
function fuseValues(electronPlatformName) {
  return {
    // Electron 바이너리를 순수 Node로 실행하는 경로. 열려 있으면 앱 코드
    // 서명과 무관하게 임의 스크립트를 돌릴 수 있다.
    runAsNode: false,
    // --inspect 계열 인자. 열려 있으면 실행 중인 프로세스에 디버거를 붙여
    // 메모리의 자격증명을 읽을 수 있다.
    nodeCliInspectArguments: false,
    // NODE_OPTIONS 환경변수. 열려 있으면 환경변수 하나로 코드를 주입한다.
    nodeOptionsEnvironmentVariable: false,
    // 쿠키 암호화. 켜 두면 디스크의 쿠키가 평문으로 남지 않는다.
    cookieEncryption: true,
    // asar 밖의 앱 코드 로딩 금지.
    onlyLoadAppFromAsar: true,
    // asar 무결성 검증.
    embeddedAsarIntegrityValidation: true,
    // darwin에서 fuse를 뒤집으면 기존 ad-hoc 서명이 깨지므로 다시 서명해야 한다.
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
  }
}

/**
 * 플랫폼별 바이너리 경로.
 *
 * `packager`에서 무엇을 읽을지가 플랫폼마다 다르다. **`executableName`은
 * LinuxPackager에만 있다** — 이걸 객체 리터럴로 한 번에 계산하면 darwin 빌드가
 * 그 속성 접근만으로 던진다. Phase 0a에서 실제로 났던 버그라서, 여기서는
 * 분기 안에서만 읽고 테스트로 못박는다.
 */
function resolveExecutablePath(electronPlatformName, appOutDir, packager) {
  const appName = packager.appInfo.productFilename

  switch (electronPlatformName) {
    case 'darwin':
      return path.join(appOutDir, `${appName}.app`)
    case 'win32':
      return path.join(appOutDir, `${appName}.exe`)
    case 'linux':
      return path.join(appOutDir, packager.executableName)
    default:
      throw new Error(`unsupported platform: ${electronPlatformName}`)
  }
}

module.exports = { fuseValues, resolveExecutablePath }
