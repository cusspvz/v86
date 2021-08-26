import { dbg_assert } from './debug'
import { clz32 } from './clz32'

const useClz32 =
  typeof clz32 === 'function' &&
  clz32(0) === 32 &&
  clz32(0x12345) === 15 &&
  clz32(-1) === 0

const int_log2_table = new Int8Array(256)

if (!useClz32) {
  for (let i = 0, b = -2; i < 256; i++) {
    if (!(i & (i - 1))) b++

    int_log2_table[i] = b
  }
}

/**
 * calculate the integer logarithm base 2 of a byte
 * @param {number} x
 * @return {number}
 */
export const int_log2_byte = useClz32
  ? function (x) {
      dbg_assert(x > 0)
      dbg_assert(x < 0x100)

      return 31 - Math.clz32(x)
    }
  : function (x) {
      dbg_assert(x > 0)
      dbg_assert(x < 0x100)

      return int_log2_table[x]
    }

/**
 * calculate the integer logarithm base 2
 * @param {number} x
 * @return {number}
 */
export const int_log2 = useClz32
  ? function (x) {
      dbg_assert(x > 0)

      return 31 - Math.clz32(x)
    }
  : function (x) {
      x >>>= 0
      dbg_assert(x > 0)

      // http://jsperf.com/integer-log2/6
      let tt = x >>> 16

      if (tt) {
        let t = tt >>> 8
        if (t) {
          return 24 + int_log2_table[t]
        } else {
          return 16 + int_log2_table[tt]
        }
      } else {
        let t = x >>> 8
        if (t) {
          return 8 + int_log2_table[t]
        } else {
          return int_log2_table[x]
        }
      }
    }
