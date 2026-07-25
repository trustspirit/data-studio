import * as amqp from 'amqplib'
import { randomUUID } from 'node:crypto'

export const RABBIT_HOST = process.env.DATACON_TEST_RABBIT_HOST ?? 'localhost'
export const RABBIT_MGMT = `http://${RABBIT_HOST}:15672`
export const RABBIT_AUTH = Buffer.from('guest:guest').toString('base64')

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(`${RABBIT_MGMT}/api/overview`, { headers: { Authorization: `Basic ${RABBIT_AUTH}` } })
    return res.ok
  } catch {
    return false
  }
}

// 모듈 로드 시 한 번 프로브. rabbit이 없으면 통합 테스트가 전부 스킵된다.
export const RABBIT_AVAILABLE: boolean = await probe()

interface AmqpTestConn {
  createChannel(): Promise<{
    assertExchange(x: string, t: string, o: { durable: boolean }): Promise<unknown>
    deleteExchange(x: string): Promise<unknown>
    assertQueue(q: string, o: { durable: boolean; autoDelete: boolean }): Promise<{ queue: string }>
    bindQueue(q: string, x: string, p: string): Promise<unknown>
    get(q: string, o: { noAck: boolean }): Promise<false | { content: Buffer }>
    publish(x: string, rk: string, body: Buffer): boolean
    close(): Promise<void>
  }>
  close(): Promise<void>
}

/** uuid 이름의 exchange를 만들고 fn(exchange, publish, conn)을 부른다. 끝나면 삭제. */
export async function withExchange(
  type: 'fanout' | 'topic',
  fn: (
    exchange: string,
    publish: (routingKey: string, body: string) => void,
    conn: AmqpTestConn,
  ) => Promise<void>,
): Promise<void> {
  const exchange = `x_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const conn = (await amqp.connect({
    hostname: RABBIT_HOST, port: 5672, username: 'guest', password: 'guest', vhost: '/',
  })) as unknown as AmqpTestConn
  const ch = await conn.createChannel()
  await ch.assertExchange(exchange, type, { durable: false })
  const publish = (rk: string, body: string): void => { ch.publish(exchange, rk, Buffer.from(body)) }
  try {
    await fn(exchange, publish, conn)
  } finally {
    try {
      await ch.deleteExchange(exchange)
    } finally {
      await ch.close()
      await conn.close()
    }
  }
}
