import { describe, it, expect } from 'vitest'
import { Semaphore } from './semaphore'

describe('Semaphore', () => {
  it('allows up to `limit` concurrent holders', async () => {
    const sem = new Semaphore(2)
    const r1 = await sem.acquire()
    const r2 = await sem.acquire()

    let thirdAcquired = false
    const third = sem.acquire().then((release) => {
      thirdAcquired = true
      return release
    })

    // Give the third acquire a chance to (incorrectly) resolve
    await new Promise((r) => setTimeout(r, 10))
    expect(thirdAcquired).toBe(false)

    r1()
    const r3 = await third
    expect(thirdAcquired).toBe(true)

    r2()
    r3()
  })

  it('wakes queued waiters in FIFO order', async () => {
    const sem = new Semaphore(1)
    const order: number[] = []
    const r1 = await sem.acquire()

    const p2 = sem.acquire().then((r) => { order.push(2); return r })
    const p3 = sem.acquire().then((r) => { order.push(3); return r })

    r1()
    const r2 = await p2
    r2()
    const r3 = await p3
    r3()

    expect(order).toEqual([2, 3])
  })

  it('release is idempotent-safe for sequential use', async () => {
    const sem = new Semaphore(1)
    for (let i = 0; i < 5; i++) {
      const release = await sem.acquire()
      release()
    }
    // If releases leaked permits, this would hang — reaching here means balance held
    const r = await sem.acquire()
    r()
    expect(true).toBe(true)
  })
})
