// Reads len characters at offset from Memory object mem as a JS string
export function read_sized_string_from_mem(mem, offset, len) {
  offset >>>= 0
  len >>>= 0
  return String.fromCharCode(...new Uint8Array(mem.buffer, offset, len))
}
