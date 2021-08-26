import { randomBytes } from 'crypto'

export function get_rand_int() {
  return randomBytes(4)['readInt32LE'](0)
}

// if(typeof crypto !== "undefined" && crypto.getRandomValues)
// {
//     let rand_data = new Int32Array(1);

//     get_rand_int = function()
//     {
//         crypto.getRandomValues(rand_data);
//         return rand_data[0];
//     };
// }
// else if(typeof require !== "undefined")
// {
//     /** @type {{ randomBytes: Function }} */
//     const crypto = require("crypto");

//     get_rand_int = function()
//     {
//         return crypto.randomBytes(4)["readInt32LE"](0);
//     };
// }
// else
// {
//     dbg_assert(false, "Unsupported platform: No cryptographic random values");
// }
