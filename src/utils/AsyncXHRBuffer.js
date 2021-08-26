import { ASYNC_SAFE } from '../config'
import { dbg_assert } from '../log'
import { determine_size_xhr } from './determine_size'
import { load_file_xhr } from './load_file'

/**
 * Asynchronous access to ArrayBuffer, loading blocks lazily as needed,
 * using the `Range: bytes=...` header
 *
 * @constructor
 * @param {string} filename Name of the file to download
 * @param {number|undefined} size
 */
export function AsyncXHRBuffer(filename, size) {
  this.filename = filename

  /** @const */
  this.block_size = 256
  this.byteLength = size

  this.loaded_blocks = Object.create(null)

  this.onload = undefined
  this.onprogress = undefined
}

AsyncXHRBuffer.prototype.load = function () {
  if (this.byteLength !== undefined) {
    if (this.onload) this.onload(Object.create(null))
    return
  }

  // Determine the size using a request

  determine_size_xhr(this.filename, (error, size) => {
    if (error) {
      throw new Error('Cannot use: ' + this.filename + '. ' + error)
    } else {
      dbg_assert(size >= 0)
      this.byteLength = size
      if (this.onload) this.onload(Object.create(null))
    }
  })
}

/**
 * @param {number} offset
 * @param {number} len
 * @param {function(!Uint8Array)} fn
 */
// eslint-disable-next-line no-unused-vars
AsyncXHRBuffer.prototype.get_from_cache = function (offset, len, fn) {
  let number_of_blocks = len / this.block_size
  let block_index = offset / this.block_size

  for (let i = 0; i < number_of_blocks; i++) {
    let block = this.loaded_blocks[block_index + i]

    if (!block) {
      return
    }
  }

  if (number_of_blocks === 1) {
    return this.loaded_blocks[block_index]
  } else {
    let result = new Uint8Array(len)
    for (let i = 0; i < number_of_blocks; i++) {
      result.set(this.loaded_blocks[block_index + i], i * this.block_size)
    }
    return result
  }
}

/**
 * @param {number} offset
 * @param {number} len
 * @param {function(!Uint8Array)} fn
 */
AsyncXHRBuffer.prototype.get = function (offset, len, fn) {
  console.assert(offset + len <= this.byteLength)
  console.assert(offset % this.block_size === 0)
  console.assert(len % this.block_size === 0)
  console.assert(len)

  let block = this.get_from_cache(offset, len, fn)
  if (block) {
    if (ASYNC_SAFE) {
      setTimeout(fn.bind(this, block), 0)
    } else {
      fn(block)
    }
    return
  }

  load_file_xhr(this.filename, {
    done: function done(buffer) {
      let block = new Uint8Array(buffer)
      this.handle_read(offset, len, block)
      fn(block)
    }.bind(this),
    range: { start: offset, length: len },
  })
}

/**
 * Relies on this.byteLength, this.loaded_blocks and this.block_size
 *
 * @this {AsyncFileBuffer|AsyncXHRBuffer|AsyncXHRPartfileBuffer}
 *
 * @param {number} start
 * @param {!Uint8Array} data
 * @param {function()} fn
 */
AsyncXHRBuffer.prototype.set = function (start, data, fn) {
  console.assert(start + data.byteLength <= this.byteLength)

  let len = data.length

  console.assert(start % this.block_size === 0)
  console.assert(len % this.block_size === 0)
  console.assert(len)

  let start_block = start / this.block_size
  let block_count = len / this.block_size

  for (let i = 0; i < block_count; i++) {
    let block = this.loaded_blocks[start_block + i]

    if (block === undefined) {
      block = this.loaded_blocks[start_block + i] = new Uint8Array(
        this.block_size
      )
    }

    let data_slice = data.subarray(
      i * this.block_size,
      (i + 1) * this.block_size
    )
    block.set(data_slice)

    console.assert(block.byteLength === data_slice.length)
  }

  fn()
}

/**
 * @this {AsyncFileBuffer|AsyncXHRBuffer|AsyncXHRPartfileBuffer}
 * @param {number} offset
 * @param {number} len
 * @param {!Uint8Array} block
 */
AsyncXHRBuffer.prototype.handle_read = function (offset, len, block) {
  // Used by AsyncXHRBuffer and AsyncFileBuffer
  // Overwrites blocks from the original source that have been written since

  let start_block = offset / this.block_size
  let block_count = len / this.block_size

  for (let i = 0; i < block_count; i++) {
    let written_block = this.loaded_blocks[start_block + i]

    if (written_block) {
      block.set(written_block, i * this.block_size)
    }
    //else
    //{
    //    let cached = this.loaded_blocks[start_block + i] = new Uint8Array(this.block_size);
    //    cached.set(block.subarray(i * this.block_size, (i + 1) * this.block_size));
    //}
  }
}

AsyncXHRBuffer.prototype.get_buffer = function (fn) {
  // We must download all parts, unlikely a good idea for big files
  fn()
}

AsyncXHRBuffer.prototype.get_written_blocks = function () {
  let count = Object.keys(this.loaded_blocks).length

  let buffer = new Uint8Array(count * this.block_size)
  let indices = []

  let i = 0
  for (let index of Object.keys(this.loaded_blocks)) {
    let block = this.loaded_blocks[index]
    dbg_assert(block.length === this.block_size)
    index = +index
    indices.push(index)
    buffer.set(block, i * this.block_size)
    i++
  }

  return {
    buffer,
    indices,
    block_size: this.block_size,
  }
}

AsyncXHRBuffer.prototype.get_state = function () {
  const state = []
  const loaded_blocks = []

  for (let [index, block] of Object.entries(this.loaded_blocks)) {
    dbg_assert(isFinite(+index))
    loaded_blocks.push([+index, block])
  }

  state[0] = loaded_blocks
  return state
}

AsyncXHRBuffer.prototype.set_state = function (state) {
  const loaded_blocks = state[0]
  this.loaded_blocks = Object.create(null)

  for (let [index, block] of Object.values(loaded_blocks)) {
    this.loaded_blocks[index] = block
  }
}

/**
 * Asynchronous access to ArrayBuffer, loading blocks lazily as needed,
 * downloading files named filename-\d-\d.ext.
 *
 * @constructor
 * @param {string} filename Name of the file to download
 * @param {number|undefined} size
 */
export function AsyncXHRPartfileBuffer(filename, size) {
  const parts = filename.match(/(.*)(\..*)/)

  if (parts) {
    this.basename = parts[1]
    this.extension = parts[2]
  } else {
    this.basename = filename
    this.extension = ''
  }

  /** @const */
  this.block_size = 256
  this.byteLength = size

  this.loaded_blocks = Object.create(null)

  this.onload = undefined
  this.onprogress = undefined
}

AsyncXHRPartfileBuffer.prototype.load = function () {
  if (this.byteLength !== undefined) {
    if (this.onload) this.onload(Object.create(null))
    return
  }
  dbg_assert(false)
  if (this.onload) this.onload(Object.create(null))
}
AsyncXHRPartfileBuffer.prototype.get_from_cache =
  AsyncXHRBuffer.prototype.get_from_cache

/**
 * @param {number} offset
 * @param {number} len
 * @param {function(!Uint8Array)} fn
 */
AsyncXHRPartfileBuffer.prototype.get = function (offset, len, fn) {
  console.assert(offset + len <= this.byteLength)
  console.assert(offset % this.block_size === 0)
  console.assert(len % this.block_size === 0)
  console.assert(len)

  let block = this.get_from_cache(offset, len, fn)
  if (block) {
    if (ASYNC_SAFE) {
      setTimeout(fn.bind(this, block), 0)
    } else {
      fn(block)
    }
    return
  }

  const part_filename =
    this.basename + '-' + offset + '-' + (offset + len) + this.extension

  load_file_xhr(part_filename, {
    done: function done(buffer) {
      dbg_assert(buffer.byteLength === len)
      let block = new Uint8Array(buffer)
      this.handle_read(offset, len, block)
      fn(block)
    }.bind(this),
  })
}

AsyncXHRPartfileBuffer.prototype.set = AsyncXHRBuffer.prototype.set
AsyncXHRPartfileBuffer.prototype.handle_read =
  AsyncXHRBuffer.prototype.handle_read
AsyncXHRPartfileBuffer.prototype.get_written_blocks =
  AsyncXHRBuffer.prototype.get_written_blocks
AsyncXHRPartfileBuffer.prototype.get_state = AsyncXHRBuffer.prototype.get_state
AsyncXHRPartfileBuffer.prototype.set_state = AsyncXHRBuffer.prototype.set_state
