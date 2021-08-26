#!/usr/bin/env node


const BENCH_COLLECT_STATS = +process.env.BENCH_COLLECT_STATS;

const V86 = require(`../../build/${BENCH_COLLECT_STATS ? "libv86-debug" : "libv86"}.js`).V86;
const print_stats = require("../../build/libv86.js").print_stats;
const fs = require("fs");
const path = require("path");
const V86_ROOT = path.join(__dirname, "../..");

const LOG_SERIAL = true;

if(true)
{
    var emulator = new V86({
        bios: { url: __dirname + "/../../bios/seabios.bin" },
        vga_bios: { url: __dirname + "/../../bios/vgabios.bin" },
        cdrom: { url: __dirname + "/../../images/linux3.iso" },
        autostart: true,
        memory_size: 32 * 1024 * 1024,
        log_level: 0,
    });
}
else
{
    var emulator = new V86({
        bios: { url: path.join(V86_ROOT, "/bios/seabios.bin") },
        vga_bios: { url: path.join(V86_ROOT, "/bios/vgabios.bin") },
        autostart: true,
        memory_size: 512 * 1024 * 1024,
        vga_memory_size: 8 * 1024 * 1024,
        network_relay_url: "<UNUSED>",
        bzimage_initrd_from_filesystem: true,
        cmdline: "rw console=ttyS0 apm=off root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose mitigations=off audit=0 tsc=reliable nowatchdog init=/usr/bin/init-openrc",
        filesystem: {
            basefs: {
                url: path.join(V86_ROOT, "/images/fs.json"),
            },
            baseurl: path.join(V86_ROOT, "/images/arch/"),
        },
        screen_dummy: true,
        log_level: 0,
    });
}

emulator.bus.register("emulator-started", function()
{
    console.error("Booting now, please stand by");
    start_time = Date.now();
});

var serial_text = "";
var start_time;

emulator.add_listener("serial0-output-char", function(chr)
{
    if(chr < " " && chr !== "\n" && chr !== "\t" || chr > "~")
    {
        return;
    }

    if(LOG_SERIAL) process.stdout.write(chr);

    serial_text += chr;

    if(serial_text.endsWith("~% ") || serial_text.endsWith("root@localhost:~# "))
    {
        const end_time = Date.now();
        const elapsed = end_time - start_time;
        console.log("Done in %dms", elapsed);
        emulator.stop();

        if(BENCH_COLLECT_STATS)
        {
            const cpu = emulator.v86.cpu;
            console.log(print_stats.stats_to_string(cpu));
        }
    }
});
