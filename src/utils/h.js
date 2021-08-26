import { pad0 } from './pad0'

/**
 * number to hex
 * @param {number} n
 * @param {number=} len
 * @return {string}
 */
export function h(n, len) {
  const str = !n ? '' : n.toString(16)
  return '0x' + pad0(str.toUpperCase(), len || 1)
}
