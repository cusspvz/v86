// pad string with spaces on the right
export function pads(str, len) {
  str = str || str === 0 ? str + '' : ''
  return str.padEnd(len, ' ')
}
