/**
 * Simple circular queue for logs
 *
 * @param {number} size
 * @constructor
 */
export class CircularQueue {
  constructor(size) {
    this.data = []
    this.index = 0
    this.size = size
  }

  add(item) {
    this.data[this.index] = item
    this.index = (this.index + 1) % this.size
  }

  toArray() {
    return [].slice
      .call(this.data, this.index)
      .concat([].slice.call(this.data, 0, this.index))
  }

  clear() {
    this.data = []
    this.index = 0
  }

  /**
   * @param {Array} new_data
   */
  set(new_data) {
    this.data = new_data
    this.index = 0
  }
}
