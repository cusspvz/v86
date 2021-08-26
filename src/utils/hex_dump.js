/** @param {number=} length */
export function hex_dump(buffer, length)
{
    var result = [];
    length = length || buffer.byteLength;
    var addr = 0;
    var line, byt;

    for(var i = 0; i < length >> 4; i++)
    {
        line = h(addr + (i << 4), 5) + "   ";

        for(var j = 0; j < 0x10; j++)
        {
            byt = buffer[addr + (i << 4) + j];
            line += h(byt, 2) + " ";
        }

        line += "  ";

        for(j = 0; j < 0x10; j++)
        {
            byt = buffer[addr + (i << 4) + j];
            line += (byt < 33 || byt > 126) ? "." : String.fromCharCode(byt);
        }

        result.push(line);
    }

    return "\n" + result.join("\n");
}