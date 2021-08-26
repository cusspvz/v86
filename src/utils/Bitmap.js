/**
 * A simple 1d bitmap
 * @constructor
 */
export class Bitmap {
  constructor(length_or_buffer) {
    if (typeof length_or_buffer === 'number') {
      this.view = new Uint8Array((length_or_buffer + 7) >> 3)
    } else if (length_or_buffer instanceof ArrayBuffer) {
      this.view = new Uint8Array(length_or_buffer)
    } else {
      console.assert(false)
    }
  }

  set(index, value) {
    const bit_index = index & 7
    const byte_index = index >> 3
    const bit_mask = 1 << bit_index

    this.view[byte_index] = value
      ? this.view[byte_index] | bit_mask
      : this.view[byte_index] & ~bit_mask
  }

  get(index) {
    const bit_index = index & 7
    const byte_index = index >> 3

    return (this.view[byte_index] >> bit_index) & 1
  }

  get_buffer() {
    return this.view.buffer
  }
}
