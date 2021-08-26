import { dbg_assert } from './debug'

/**
 * Synchronous access to ArrayBuffer
 * @constructor
 */
export class SyncBuffer {
  constructor(buffer) {
    dbg_assert(buffer instanceof ArrayBuffer)
    this.onload = undefined
    this.onprogress = undefined
    this.byteLength = 0
    this.buffer = buffer
    this.byteLength = buffer.byteLength
  }

  load() {
    if (this.onload == 'function') {
      this.onload({ buffer: this.buffer })
    }
  }

  /**
   * @param {number} start
   * @param {number} len
   * @param {function(!Uint8Array)} fn
   */
  get(start, len, fn) {
    dbg_assert(start + len <= this.byteLength)
    fn(new Uint8Array(this.buffer, start, len))
  }

  /**
   * @param {number} start
   * @param {!Uint8Array} slice
   * @param {function()} fn
   */
  set(start, slice, fn) {
    dbg_assert(start + slice.byteLength <= this.byteLength)

    new Uint8Array(this.buffer, start, slice.byteLength).set(slice)
    fn()
  }

  /**
   * @param {function(!ArrayBuffer)} fn
   */
  get_buffer(fn) {
    fn(this.buffer)
  }

  get_state() {
    const state = []
    state[0] = this.byteLength
    state[1] = new Uint8Array(this.buffer)
    return state
  }

  set_state(state) {
    this.byteLength = state[0]
    this.buffer = state[1].slice().buffer
  }
}
