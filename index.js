// load all files to run v86 in browser, uncompiled

// CORE_FILES
import "./src/const.js"
import "./src/config.js"
import "./src/log.js"
import "./src/lib.js"
import "./src/cpu.js"
import "./src/io.js"
import "./src/main.js"
import "./src/ide.js"
import "./src/pci.js"
import "./src/floppy.js"
import "./src/memory.js"
import "./src/dma.js"
import "./src/pit.js"
import "./src/vga.js"
import "./src/ps2.js"
import "./src/pic.js"
import "./src/rtc.js"
import "./src/uart.js"
import "./src/acpi.js"
import "./src/apic.js"
import "./src/ioapic.js"
import "./src/hpet.js"
import "./src/sb16.js"
import "./src/ne2k.js"
import "./src/state.js"
import "./src/virtio.js"
import "./src/bus.js"
import "./src/elf.js"
import "./src/kernel.js"

// BROWSER_FILES
import "./src/browser/main.js" 
import "./src/browser/screen.js" 
import "./src/browser/keyboard.js" 
import "./src/browser/mouse.js" 
import "./src/browser/speaker.js" 
import "./src/browser/serial.js" 
import "./src/browser/lib.js" 
import "./src/browser/network.js" 
import "./src/browser/starter.js" 
import "./src/browser/worker_bus.js" 
import "./src/browser/print_stats.js" 
import "./src/browser/filestorage.js"

// LIB_FILES
import "./lib/jor1k.js"
import "./lib/9p.js"
import "./lib/filesystem.js"
import "./lib/marshall.js"
import "./lib/utf8.js"

// BUILD_FILES
import "capstonejs"
import "wabt"
