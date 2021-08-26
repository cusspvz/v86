import { dbg_assert } from './debug'

/**
 * @constructor
 *
 * Queue wrapper around Float32Array
 * Used by devices such as the sound blaster sound card
 */
export class FloatQueue {
  constructor(size) {
    this.start = 0
    this.end = 0
    this.length = 0
    this.size = size
    this.data = new Float32Array(size)

    dbg_assert((size & (size - 1)) === 0)
  }

  push(item) {
    if (this.length === this.size) {
      // intentional overwrite
      this.start = (this.start + 1) & (this.size - 1)
    } else {
      this.length++
    }

    this.data[this.end] = item
    this.end = (this.end + 1) & (this.size - 1)
  }

  shift() {
    if (!this.length) {
      return undefined
    } else {
      let item = this.data[this.start]

      this.start = (this.start + 1) & (this.size - 1)
      this.length--

      return item
    }
  }

  shift_block(count) {
    let slice = new Float32Array(count)

    if (count > this.length) {
      count = this.length
    }
    let slice_end = this.start + count

    let partial = this.data.subarray(this.start, slice_end)

    slice.set(partial)
    if (slice_end >= this.size) {
      slice_end -= this.size
      slice.set(this.data.subarray(0, slice_end), partial.length)
    }
    this.start = slice_end

    this.length -= count

    return slice
  }

  peek() {
    if (!this.length) {
      return undefined
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
