import { dbg_assert } from './debug'

export function view(constructor, memory, offset, length) {
  return new Proxy(
    {},
    {
      // eslint-disable-next-line no-unused-vars
      get: function (target, property, receiver) {
        const b = new constructor(memory.buffer, offset, length)
        const x = b[property]
        if (typeof x === 'function') {
          return x.bind(b)
        }
        dbg_assert(
          /^\d+$/.test(property) ||
            property === 'buffer' ||
            property === 'length' ||
            property === 'BYTES_PER_ELEMENT' ||
            property === 'byteOffset'
        )
        return x
      },
      // eslint-disable-next-line no-unused-vars
      set: function (target, property, value, receiver) {
        dbg_assert(/^\d+$/.test(property))
        new constructor(memory.buffer, offset, length)[property] = value
        return true
      },
    }
  )
}
