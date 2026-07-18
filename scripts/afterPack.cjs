const path = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

/**
 * 패키징된 Electron 바이너리의 fuse를 뒤집는다.
 * - runAsNode / nodeCliInspectArguments / nodeOptions: 임의 코드 실행 경로를 막는다
 * - onlyLoadAppFromAsar: asar 밖의 앱 코드 로딩을 막는다
 */
exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context
  const appName = packager.appInfo.productFilename

  // NOTE: each branch is computed lazily (not as an eagerly-evaluated object
  // literal) because `packager.executableName` only exists on LinuxPackager —
  // evaluating it unconditionally throws on darwin/win32 builds.
  let executable
  switch (electronPlatformName) {
    case 'darwin':
      executable = path.join(appOutDir, `${appName}.app`)
      break
    case 'win32':
      executable = path.join(appOutDir, `${appName}.exe`)
      break
    case 'linux':
      executable = path.join(appOutDir, packager.executableName)
      break
    default:
      throw new Error(`unsupported platform: ${electronPlatformName}`)
  }

  await flipFuses(executable, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  })
}
