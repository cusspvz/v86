// pad string with zeros on the left
export function pad0(str, len) {
  str = str || str === 0 ? str + '' : ''
  return str.padStart(len, '0')
}
