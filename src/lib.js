"use strict";

var goog = goog || {};
goog.exportSymbol = function() {};
goog.exportProperty = function() {};

// pad string with spaces on the right
export const pads = function(str, len)
{
    str = (str || str === 0) ? str + "" : "";
    return str.padEnd(len, " ");
};

// pad string with zeros on the left
export const pad0 = function(str, len)
{
    str = (str || str === 0) ? str + "" : "";
    return str.padStart(len, "0");
};

// generates array given size with zeros
export const zeros = function(size)
{
    return Array(size).fill(0);
};

// generates [0, 1, 2, ..., size-1]
export const range = function(size)
{
    return Array.from(Array(size).keys());
};

export const view = function(constructor, memory, offset, length)
{
    return new Proxy({},
        {
            get: function(target, property, receiver)
            {
                const b = new constructor(memory.buffer, offset, length);
                const x = b[property];
                if(typeof x === "function")
                {
                    return x.bind(b);
                }
                dbg_assert(/^\d+$/.test(property) || property === "buffer" || property === "length" ||
                    property === "BYTES_PER_ELEMENT" || property === "byteOffset");
                return x;
            },
            set: function(target, property, value, receiver)
            {
                dbg_assert(/^\d+$/.test(property));
                new constructor(memory.buffer, offset, length)[property] = value;
                return true;
            },
        });
};

/**
 * number to hex
 * @param {number} n
 * @param {number=} len
 * @return {string}
 */
export function h(n, len)
{
    if(!n)
    {
        var str = "";
    }
    else
    {
        var str = n.toString(16);
    }

    return "0x" + pad0(str.toUpperCase(), len || 1);
}


if(typeof crypto !== "undefined" && crypto.getRandomValues)
{
    let rand_data = new Int32Array(1);

    get_rand_int = function()
    {
        crypto.getRandomValues(rand_data);
        return rand_data[0];
    };
}
else if(typeof require !== "undefined")
{
    /** @type {{ randomBytes: Function }} */
    const crypto = require("crypto");

    get_rand_int = function()
    {
        return crypto.randomBytes(4)["readInt32LE"](0);
    };
}
else
{
    dbg_assert(false, "Unsupported platform: No cryptographic random values");
}


/**
 * Synchronous access to ArrayBuffer
 * @constructor
 */
export function SyncBuffer(buffer)
{
    dbg_assert(buffer instanceof ArrayBuffer);

    this.buffer = buffer;
    this.byteLength = buffer.byteLength;
    this.onload = undefined;
    this.onprogress = undefined;
}

SyncBuffer.prototype.load = function()
{
    this.onload && this.onload({ buffer: this.buffer });
};

/**
 * @param {number} start
 * @param {number} len
 * @param {function(!Uint8Array)} fn
 */
SyncBuffer.prototype.get = function(start, len, fn)
{
    dbg_assert(start + len <= this.byteLength);
    fn(new Uint8Array(this.buffer, start, len));
};

/**
 * @param {number} start
 * @param {!Uint8Array} slice
 * @param {function()} fn
 */
SyncBuffer.prototype.set = function(start, slice, fn)
{
    dbg_assert(start + slice.byteLength <= this.byteLength);

    new Uint8Array(this.buffer, start, slice.byteLength).set(slice);
    fn();
};

/**
 * @param {function(!ArrayBuffer)} fn
 */
SyncBuffer.prototype.get_buffer = function(fn)
{
    fn(this.buffer);
};

SyncBuffer.prototype.get_state = function()
{
    const state = [];
    state[0] = this.byteLength;
    state[1] = new Uint8Array(this.buffer);
    return state;
};

SyncBuffer.prototype.set_state = function(state)
{
    this.byteLength = state[0];
    this.buffer = state[1].slice().buffer;
};

const clz32 = Math.clz32 || function (x)  {
    // Let n be ToUint32(x).
    // Let p be the number of leading zero bits in
    // the 32-bit binary representation of n.
    // Return p.
    asUint = x >>> 0;
    if (asUint === 0) {
      return 32;
    }
    return 31 - (Math.log(asUint) / Math.LN2 | 0) |0; // the "| 0" acts like math.floor
  }

const useClz32 = typeof clz32 === "function" && clz32(0) === 32 &&
       clz32(0x12345) === 15 && clz32(-1) === 0

const int_log2_table = new Int8Array(256);

if (!useClz32) {
    for(var i = 0, b = -2; i < 256; i++)
    {
        if(!(i & i - 1))
            b++;

        int_log2_table[i] = b;
    }

}

        /**
         * calculate the integer logarithm base 2 of a byte
         * @param {number} x
         * @return {number}
         */
        export const int_log2_byte = useClz32 ? function(x)
        {
            dbg_assert(x > 0);
            dbg_assert(x < 0x100);

            return 31 - Math.clz32(x);
        } : function(x)
    {
        dbg_assert(x > 0);
        dbg_assert(x < 0x100);

        return int_log2_table[x];
    };

        /**
         * calculate the integer logarithm base 2
         * @param {number} x
         * @return {number}
         */
        export const int_log2 = useClz32 ? function(x)
        {
            dbg_assert(x > 0);

            return 31 - Math.clz32(x);
        }: function(x)
    {
        x >>>= 0;
        dbg_assert(x > 0);

        // http://jsperf.com/integer-log2/6
        var tt = x >>> 16;

        if(tt)
        {
            var t = tt >>> 8;
            if(t)
            {
                return 24 + int_log2_table[t];
            }
            else
            {
                return 16 + int_log2_table[tt];
            }
        }
        else
        {
            var t = x >>> 8;
            if(t)
            {
                return 8 + int_log2_table[t];
            }
            else
            {
                return int_log2_table[x];
            }
        }
    };

        return;
    

/**
 * @constructor
 *
 * Queue wrapper around Uint8Array
 * Used by devices such as the PS2 controller
 */
export function ByteQueue(size)
{
    var data = new Uint8Array(size),
        start,
        end;

    dbg_assert((size & size - 1) === 0);

    this.length = 0;

    this.push = function(item)
    {
        if(this.length === size)
        {
            // intentional overwrite
        }
        else
        {
            this.length++;
        }

        data[end] = item;
        end = end + 1 & size - 1;
    };

    this.shift = function()
    {
        if(!this.length)
        {
            return -1;
        }
        else
        {
            var item = data[start];

            start = start + 1 & size - 1;
            this.length--;

            return item;
        }
    };

    this.peek = function()
    {
        if(!this.length)
        {
            return -1;
        }
        else
        {
            return data[start];
        }
    };

    this.clear = function()
    {
        start = 0;
        end = 0;
        this.length = 0;
    };

    this.clear();
}


/**
 * @constructor
 *
 * Queue wrapper around Float32Array
 * Used by devices such as the sound blaster sound card
 */
export function FloatQueue(size)
{
    this.size = size;
    this.data = new Float32Array(size);
    this.start = 0;
    this.end = 0;
    this.length = 0;

    dbg_assert((size & size - 1) === 0);
}

FloatQueue.prototype.push = function(item)
{
    if(this.length === this.size)
    {
        // intentional overwrite
        this.start = this.start + 1 & this.size - 1;
    }
    else
    {
        this.length++;
    }

    this.data[this.end] = item;
    this.end = this.end + 1 & this.size - 1;
};

FloatQueue.prototype.shift = function()
{
    if(!this.length)
    {
        return undefined;
    }
    else
    {
        var item = this.data[this.start];

        this.start = this.start + 1 & this.size - 1;
        this.length--;

        return item;
    }
};

FloatQueue.prototype.shift_block = function(count)
{
    var slice = new Float32Array(count);

    if(count > this.length)
    {
        count = this.length;
    }
    var slice_end = this.start + count;

    var partial = this.data.subarray(this.start, slice_end);

    slice.set(partial);
    if(slice_end >= this.size)
    {
        slice_end -= this.size;
        slice.set(this.data.subarray(0, slice_end), partial.length);
    }
    this.start = slice_end;

    this.length -= count;

    return slice;
};

FloatQueue.prototype.peek = function()
{
    if(!this.length)
    {
        return undefined;
    }
    else
    {
        return this.data[this.start];
    }
};

FloatQueue.prototype.clear = function()
{
    this.start = 0;
    this.end = 0;
    this.length = 0;
};


/**
 * Simple circular queue for logs
 *
 * @param {number} size
 * @constructor
 */
export function CircularQueue(size)
{
    this.data = [];
    this.index = 0;
    this.size = size;
}

CircularQueue.prototype.add = function(item)
{
    this.data[this.index] = item;
    this.index = (this.index + 1) % this.size;
};

CircularQueue.prototype.toArray = function()
{
    return [].slice.call(this.data, this.index).concat([].slice.call(this.data, 0, this.index));
};

CircularQueue.prototype.clear = function()
{
    this.data = [];
    this.index = 0;
};

/**
 * @param {Array} new_data
 */
CircularQueue.prototype.set = function(new_data)
{
    this.data = new_data;
    this.index = 0;
};

function dump_file(ab, name)
{
    if(!(ab instanceof Array))
    {
        ab = [ab];
    }

    var blob = new Blob(ab);
    download(blob, name);
}

export function download(file_or_blob, name)
{
    var a = document.createElement("a");
    a["download"] = name;
    a.href = window.URL.createObjectURL(file_or_blob);
    a.dataset["downloadurl"] = ["application/octet-stream", a["download"], a.href].join(":");

    if(document.createEvent)
    {
        var ev = document.createEvent("MouseEvent");
        ev.initMouseEvent("click", true, true, window,
                          0, 0, 0, 0, 0, false, false, false, false, 0, null);
        a.dispatchEvent(ev);
    }
    else
    {
        a.click();
    }

    window.URL.revokeObjectURL(a.href);
}

/**
 * A simple 1d bitmap
 * @constructor
 */
export const Bitmap = function(length_or_buffer)
{
    if(typeof length_or_buffer === "number")
    {
        this.view = new Uint8Array(length_or_buffer + 7 >> 3);
    }
    else if(length_or_buffer instanceof ArrayBuffer)
    {
        this.view = new Uint8Array(length_or_buffer);
    }
    else
    {
        console.assert(false);
    }
};

Bitmap.prototype.set = function(index, value)
{
    const bit_index = index & 7;
    const byte_index = index >> 3;
    const bit_mask = 1 << bit_index;

    this.view[byte_index] =
        value ? this.view[byte_index] | bit_mask : this.view[byte_index] & ~bit_mask;
};

Bitmap.prototype.get = function(index)
{
    const bit_index = index & 7;
    const byte_index = index >> 3;

    return this.view[byte_index] >> bit_index & 1;
};

Bitmap.prototype.get_buffer = function()
{
    return this.view.buffer;
};
