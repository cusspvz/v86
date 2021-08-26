import { AsyncXHRBuffer } from './AsyncXHRBuffer'

/**
 * Asynchronous access to File, loading blocks from the input type=file
 *
 * @constructor
 */
export function AsyncFileBuffer(file) {
  this.file = file
  this.byteLength = file.size

  /** @const */
  this.block_size = 256
  this.loaded_blocks = Object.create(null)

  this.onload = undefined
  this.onprogress = undefined
}

AsyncFileBuffer.prototype.load = function () {
  if (this.onload) this.onload(Object.create(null))
}

/**
 * @param {number} offset
 * @param {number} len
 * @param {function(!Uint8Array)} fn
 */
AsyncFileBuffer.prototype.get = function (offset, len, fn) {
  console.assert(offset % this.block_size === 0)
  console.assert(len % this.block_size === 0)
  console.assert(len)

  let block = this.get_from_cache(offset, len, fn)
  if (block) {
    fn(block)
    return
  }

  let fr = new FileReader()

  fr.onload = function (e) {
    let buffer = e.target.result
    let block = new Uint8Array(buffer)

    this.handle_read(offset, len, block)
    fn(block)
  }.bind(this)

  fr.readAsArrayBuffer(this.file.slice(offset, offset + len))
}
AsyncFileBuffer.prototype.get_from_cache =
  AsyncXHRBuffer.prototype.get_from_cache
AsyncFileBuffer.prototype.set = AsyncXHRBuffer.prototype.set
AsyncFileBuffer.prototype.handle_read = AsyncXHRBuffer.prototype.handle_read
AsyncFileBuffer.prototype.get_state = AsyncXHRBuffer.prototype.get_state

AsyncFileBuffer.prototype.get_buffer = function (fn) {
  // We must load all parts, unlikely a good idea for big files
  fn()
}

AsyncFileBuffer.prototype.get_as_file = function (name) {
  let parts = []
  let existing_blocks = Object.keys(this.loaded_blocks)
    .map(Number)
    .sort(function (x, y) {
      return x - y
    })

  let current_offset = 0

  for (let i = 0; i < existing_blocks.length; i++) {
    let block_index = existing_blocks[i]
    let block = this.loaded_blocks[block_index]
    let start = block_index * this.block_size
    console.assert(start >= current_offset)

    if (start !== current_offset) {
      parts.push(this.file.slice(current_offset, start))
      current_offset = start
    }

    parts.push(block)
    current_offset += block.length
  }

  if (current_offset !== this.file.size) {
    parts.push(this.file.slice(current_offset))
  }

  let file = new File(parts, name)
  console.assert(file.size === this.file.size)

  return file
}
