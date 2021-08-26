import { dbg_assert } from './debug'

/**
 * @constructor
 *
 * Queue wrapper around Uint8Array
 * Used by devices such as the PS2 controller
 */
export class ByteQueue {
  constructur(size) {
    dbg_assert((size & (size - 1)) === 0)
    this.data = new Uint8Array(size)
    this.length = 0
    this.start = 0
    this.end = 0
  }

  push(item) {
    if (this.length === this.size) {
      // intentional overwrite
    } else {
      this.length++
    }

    this.data[this.end] = item
    this.end = (this.end + 1) & (this.size - 1)
  }

  shift() {
    if (!this.length) {
      return -1
    } else {
      let item = this.data[this.start]

      this.start = (this.start + 1) & (this.size - 1)
      this.length--

      return item
    }
  }

  peek() {
    if (!this.length) {
      return -1
    } else {
      return this.data[this.start]
    }
  }

  clear() {
    this.start = 0
    this.end = 0
    this.length = 0
  }
}
