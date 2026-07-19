const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const { fuseValues, resolveExecutablePath } = require('./fusePlan.cjs')

/**
 * 패키징된 Electron 바이너리의 fuse를 뒤집는다.
 *
 * 무엇을 어떤 값으로 거는지는 `fusePlan.cjs`가 정하고 테스트가 지킨다.
 * 이 파일은 electron-builder가 부르는 얇은 배선이다 — 여기에 판단을 두면
 * 유닛 테스트가 닿지 않는 곳에 보안 결정이 남는다.
 */
exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context

  const executable = resolveExecutablePath(electronPlatformName, appOutDir, packager)
  const values = fuseValues(electronPlatformName)

  await flipFuses(executable, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: values.resetAdHocDarwinSignature,
    [FuseV1Options.RunAsNode]: values.runAsNode,
    [FuseV1Options.EnableNodeCliInspectArguments]: values.nodeCliInspectArguments,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: values.nodeOptionsEnvironmentVariable,
    [FuseV1Options.EnableCookieEncryption]: values.cookieEncryption,
    [FuseV1Options.OnlyLoadAppFromAsar]: values.onlyLoadAppFromAsar,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: values.embeddedAsarIntegrityValidation,
  })
}
