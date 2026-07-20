import { describe, expect, it } from 'vitest'
import { compareVersions, isUpgrade, parseVersion } from '@main/core/update/version'

describe('parseVersion', () => {
  it('v 접두사를 허용한다', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('접두사 없이도 파싱한다', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('pre-release 꼬리를 무시하고 core를 파싱한다', () => {
    expect(parseVersion('1.2.3-beta.1')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseVersion('2.0.0+build.5')).toEqual({ major: 2, minor: 0, patch: 0 })
  })

  it('형식이 아니면 null', () => {
    expect(parseVersion('not-a-version')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('1.2.3.4')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('major/minor/patch 순으로 비교한다', () => {
    expect(compareVersions({ major: 1, minor: 0, patch: 0 }, { major: 2, minor: 0, patch: 0 })).toBe(-1)
    expect(compareVersions({ major: 1, minor: 3, patch: 0 }, { major: 1, minor: 2, patch: 9 })).toBe(1)
    expect(compareVersions({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 })).toBe(0)
  })

  it('patch 차이를 major/minor가 같을 때 본다', () => {
    expect(compareVersions({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 4 })).toBe(-1)
  })
})

describe('isUpgrade', () => {
  it('더 높은 버전은 업그레이드다', () => {
    expect(isUpgrade('1.2.3', '1.2.4')).toBe(true)
    expect(isUpgrade('1.2.3', '2.0.0')).toBe(true)
    expect(isUpgrade('v1.0.0', 'v1.0.1')).toBe(true)
  })

  it('같은 버전은 업그레이드가 아니다 (재설치 방지)', () => {
    expect(isUpgrade('1.2.3', '1.2.3')).toBe(false)
  })

  it('낮은 버전은 업그레이드가 아니다 (downgrade 방지)', () => {
    // 서명이 유효해도 오래된 취약 버전으로 내리면 안 된다.
    expect(isUpgrade('1.2.3', '1.2.2')).toBe(false)
    expect(isUpgrade('2.0.0', '1.9.9')).toBe(false)
  })

  it('파싱 불가는 업그레이드가 아니다 (fail-safe)', () => {
    expect(isUpgrade('1.2.3', 'garbage')).toBe(false)
    expect(isUpgrade('garbage', '1.2.4')).toBe(false)
  })
})
