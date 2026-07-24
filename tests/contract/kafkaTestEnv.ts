import { Kafka, logLevel, type Message } from 'kafkajs'
import { randomUUID } from 'node:crypto'

export const KAFKA_BROKERS = (process.env.DATACON_TEST_KAFKA_BROKERS ?? 'localhost:9092')
  .split(',').map((s) => s.trim()).filter(Boolean)

function client(): Kafka {
  return new Kafka({ clientId: 'datacon-test', brokers: KAFKA_BROKERS, logLevel: logLevel.NOTHING, retry: { retries: 1 } })
}

async function probe(): Promise<boolean> {
  const admin = client().admin()
  try {
    await admin.connect()
    await admin.listTopics()
    return true
  } catch {
    return false
  } finally {
    try { await admin.disconnect() } catch { /* ignore */ }
  }
}

// 모듈 로드 시 한 번 프로브. kafka가 없으면 통합 테스트가 전부 스킵된다.
export const KAFKA_AVAILABLE: boolean = await probe()

/**
 * uuid 이름의 토픽을 만들고 seed 메시지를 produce한 뒤 fn(topic)을 부른다.
 * 끝나면 토픽 삭제(성공/실패 무관). 병렬 워커 충돌을 피하려 이름에 uuid를 쓴다.
 */
export async function withTopic(
  seed: readonly Message[],
  fn: (topic: string) => Promise<void>,
): Promise<void> {
  const topic = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const kafka = client()
  const admin = kafka.admin()
  await admin.connect()
  await admin.createTopics({ topics: [{ topic, numPartitions: 1 }], waitForLeaders: true })
  if (seed.length > 0) {
    const producer = kafka.producer()
    await producer.connect()
    await producer.send({ topic, messages: [...seed] })
    await producer.disconnect()
  }
  try {
    await fn(topic)
  } finally {
    try {
      await admin.deleteTopics({ topics: [topic] })
    } finally {
      await admin.disconnect()
    }
  }
}
