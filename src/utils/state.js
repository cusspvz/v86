import { DEBUG } from './config'
import { dbg_assert } from './log'

/** @const */
export const STATE_VERSION = 6

/** @const */
export const STATE_MAGIC = 0x86768676 | 0

/** @const */
export const STATE_INDEX_MAGIC = 0

/** @const */
export const STATE_INDEX_VERSION = 1

/** @const */
export const STATE_INDEX_TOTAL_LEN = 2

/** @const */
export const STATE_INDEX_INFO_LEN = 3

/** @const */
export const STATE_INFO_BLOCK_START = 16

export const ZSTD_MAGIC = 0xfd2fb528

/** @constructor */
export function StateLoadError(msg) {
  this.message = msg
}
StateLoadError.prototype = new Error()

const CONSTRUCTOR_TABLE = {
  Uint8Array: Uint8Array,
  Int8Array: Int8Array,
  Uint16Array: Uint16Array,
  Int16Array: Int16Array,
  Uint32Array: Uint32Array,
  Int32Array: Int32Array,
  Float32Array: Float32Array,
  Float64Array: Float64Array,
}

export function save_object(obj, saved_buffers) {
  if (typeof obj !== 'object' || obj === null) {
    dbg_assert(typeof obj !== 'function')
    return obj
  }

  if (obj instanceof Array) {
    return obj.map((x) => save_object(x, saved_buffers))
  }

  if (obj.constructor === Object) {
    console.log(obj)
    dbg_assert(obj.constructor !== Object, 'Expected non-object')
  }

  if (obj.BYTES_PER_ELEMENT) {
    // Uint8Array, etc.
    let buffer = new Uint8Array(
      obj.buffer,
      obj.byteOffset,
      obj.length * obj.BYTES_PER_ELEMENT
    )

    const constructor = obj.constructor.name.replace('bound ', '')

    dbg_assert(CONSTRUCTOR_TABLE[constructor])

    return {
      __state_type__: constructor,
      buffer_id: saved_buffers.push(buffer) - 1,
    }
  }

  if (DEBUG && !obj.get_state) {
    console.log('Object without get_state: ', obj)
  }

  let state = obj.get_state()
  let result = []

  for (let i = 0; i < state.length; i++) {
    let value = state[i]

    dbg_assert(typeof value !== 'function')

    result[i] = save_object(value, saved_buffers)
  }

  return result
}

export function restore_buffers(obj, buffers) {
  if (typeof obj !== 'object' || obj === null) {
    dbg_assert(typeof obj !== 'function')
    return obj
  }

  if (obj instanceof Array) {
    for (let i = 0; i < obj.length; i++) {
      obj[i] = restore_buffers(obj[i], buffers)
    }

    return obj
  }

  const type = obj['__state_type__']
  dbg_assert(type !== undefined)

  const constructor = CONSTRUCTOR_TABLE[type]
  dbg_assert(constructor, 'Unkown type: ' + type)

  const buffer = buffers[obj['buffer_id']]
  return new constructor(buffer)
}
