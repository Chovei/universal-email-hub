/**
 * Minimal counting semaphore. acquire() resolves with a release function;
 * callers MUST release in a finally block. Waiters wake in FIFO order.
 *
 * Used to cap concurrent account syncs — with 100 accounts, an unbounded
 * startup sync storm saturates the network, the DB, and provider rate
 * limits all at once.
 */
export class Semaphore {
  private queue: (() => void)[] = []
  private active = 0

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++
      return this.makeRelease()
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++
        resolve(this.makeRelease())
      })
    })
  }

  private makeRelease(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      const next = this.queue.shift()
      if (next) next()
    }
  }
}
