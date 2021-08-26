/**
 * Synchronous access to File, loading blocks from the input type=file
 * The whole file is loaded into memory during initialisation
 *
 * @constructor
 */
export function SyncFileBuffer(file) {
  this.file = file
  this.byteLength = file.size

  if (file.size > 1 << 30) {
    console.warn(
      'SyncFileBuffer: Allocating buffer of ' + (file.size >> 20) + ' MB ...'
    )
  }

  this.buffer = new ArrayBuffer(file.size)
  this.onload = undefined
  this.onprogress = undefined
}

SyncFileBuffer.prototype.load = function () {
  this.load_next(0)
}

/**
 * @param {number} start
 */
SyncFileBuffer.prototype.load_next = function (start) {
  /** @const */
  let PART_SIZE = 4 << 20

  let filereader = new FileReader()

  filereader.onload = function (e) {
    let buffer = new Uint8Array(e.target.result)
    new Uint8Array(this.buffer, start).set(buffer)
    this.load_next(start + PART_SIZE)
  }.bind(this)

  if (this.onprogress) {
    this.onprogress({
      loaded: start,
      total: this.byteLength,
      lengthComputable: true,
    })
  }

  if (start < this.byteLength) {
    let end = Math.min(start + PART_SIZE, this.byteLength)
    let slice = this.file.slice(start, end)
    filereader.readAsArrayBuffer(slice)
  } else {
    this.file = undefined
    this.onload && this.onload({ buffer: this.buffer })
  }
}

/**
 * @param {number} start
 * @param {number} len
 * @param {function(!Uint8Array)} fn
 */
SyncFileBuffer.prototype.get = function (start, len, fn) {
  console.assert(start + len <= this.byteLength)
  fn(new Uint8Array(this.buffer, start, len))
}

/**
 * @param {number} offset
 * @param {!Uint8Array} slice
 * @param {function()} fn
 */
SyncFileBuffer.prototype.set = function (offset, slice, fn) {
  console.assert(offset + slice.byteLength <= this.byteLength)

  new Uint8Array(this.buffer, offset, slice.byteLength).set(slice)
  fn()
}

SyncFileBuffer.prototype.get_buffer = function (fn) {
  fn(this.buffer)
}

SyncFileBuffer.prototype.get_state = function () {
  const state = []
  state[0] = this.byteLength
  state[1] = new Uint8Array(this.buffer)
  return state
}

SyncFileBuffer.prototype.set_state = function (state) {
  this.byteLength = state[0]
  this.buffer = state[1].slice().buffer
}
