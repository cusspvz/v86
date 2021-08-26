export const clz32 =
  Math.clz32 ||
  function (x) {
    // Let n be ToUint32(x).
    // Let p be the number of leading zero bits in
    // the 32-bit binary representation of n.
    // Return p.
    const asUint = x >>> 0
    if (asUint === 0) {
      return 32
    }
    return (31 - ((Math.log(asUint) / Math.LN2) | 0)) | 0 // the "| 0" acts like math.floor
  }
