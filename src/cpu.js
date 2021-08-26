import microtick from 'performance-now'
import { pads } from './utils/pads'
import { CircularQueue } from './utils/CircularQueue'
import { view } from './utils/view'
import { load_kernel } from './kernel'
import { IDEDevice } from './ide'
import { VGAScreen } from './vga'
import { FloppyController } from './floppy'
import { Virtio9p } from './virtio'
import { IO } from './io'
import { DMA } from './dma'
import { HPET } from './hpet'
import { APIC, IOAPIC } from './apic'
import { ACPI } from './acpi'
import { read_elf } from './utils/elf'
import {
  CR0_PG,
  DEBUG,
  FLAGS_DEFAULT,
  FLAG_ADJUST,
  FLAG_CARRY,
  FLAG_DIRECTION,
  FLAG_INTERRUPT,
  FLAG_OVERFLOW,
  FLAG_PARITY,
  FLAG_SIGN,
  FLAG_TRAP,
  FLAG_VM,
  FLAG_ZERO,
  FW_CFG_CUSTOM_START,
  FW_CFG_FILE_DIR,
  FW_CFG_FILE_START,
  FW_CFG_ID,
  FW_CFG_MAX_CPUS,
  FW_CFG_NB_CPUS,
  FW_CFG_NUMA,
  FW_CFG_RAM_SIZE,
  FW_CFG_SIGNATURE,
  FW_CFG_SIGNATURE_QEMU,
  LOG_BIOS,
  LOG_CPU,
  MMAP_BLOCK_BITS,
  MMAP_BLOCK_SIZE,
  REG_CS,
  REG_DS,
  REG_EAX,
  REG_EBP,
  REG_EBX,
  REG_ECX,
  REG_EDI,
  REG_EDX,
  REG_ES,
  REG_ESI,
  REG_ESP,
  REG_FS,
  REG_GS,
  REG_LDTR,
  REG_SS,
  WASM_TABLE_OFFSET,
  WASM_TABLE_SIZE,
} from './const'
import {
  DUMP_GENERATED_WASM,
  DUMP_UNCOMPILED_ASSEMBLY,
  ENABLE_HPET,
  TIME_PER_FRAME,
} from './config'
import { dbg_assert, dbg_log } from './log'
import { Bitmap } from './utils/Bitmap'

import {
  CMOS_EQUIPMENT_INFO,
  CMOS_MEM_BASE_LOW,
  CMOS_MEM_BASE_HIGH,
  CMOS_MEM_OLD_EXT_LOW,
  CMOS_MEM_OLD_EXT_HIGH,
  CMOS_MEM_EXTMEM_LOW,
  CMOS_MEM_EXTMEM_HIGH,
  CMOS_MEM_EXTMEM2_LOW,
  CMOS_MEM_EXTMEM2_HIGH,
  CMOS_BIOS_BOOTFLAG1,
  CMOS_BIOS_BOOTFLAG2,
  CMOS_MEM_HIGHMEM_LOW,
  CMOS_MEM_HIGHMEM_MID,
  CMOS_MEM_HIGHMEM_HIGH,
  CMOS_BIOS_SMP_COUNT,
  RTC,
} from './rtc'
import { h } from './utils/h'
import {
  restore_buffers,
  save_object,
  StateLoadError,
  STATE_INDEX_INFO_LEN,
  STATE_INDEX_MAGIC,
  STATE_INDEX_TOTAL_LEN,
  STATE_INDEX_VERSION,
  STATE_INFO_BLOCK_START,
  STATE_MAGIC,
  STATE_VERSION,
  ZSTD_MAGIC,
} from './utils/state'
import { SB16 } from './sb16'
import { Ne2k } from './ne2k'
import { PIT } from './pit'
import { UART } from './uart'
import { PS2 } from './ps2'
import { PCI } from './pci'
import { PIC } from './pic'

/** @const */
export const CPU_LOG_VERBOSE = false

// Resources:
// https://pdos.csail.mit.edu/6.828/2006/readings/i386/toc.htm
// https://www-ssl.intel.com/content/www/us/en/processors/architectures-software-developer-manuals.html
// http://ref.x86asm.net/geek32.html

/** @constructor */
export class CPU {
  constructor(bus, wm) {
    this.wm = wm
    this.wasm_patch()
    this.create_jit_imports()

    const memory = this.wm.exports.memory

    this.wasm_memory = memory

    this.memory_size = view(Uint32Array, memory, 812, 1)

    this.mem8 = new Uint8Array(0)
    this.mem32s = new Int32Array(this.mem8.buffer)

    this.segment_is_null = view(Uint8Array, memory, 724, 8)
    this.segment_offsets = view(Int32Array, memory, 736, 8)
    this.segment_limits = view(Uint32Array, memory, 768, 8)

    /**
     * Wheter or not in protected mode
     */
    this.protected_mode = view(Int32Array, memory, 800, 1)

    this.idtr_size = view(Int32Array, memory, 564, 1)
    this.idtr_offset = view(Int32Array, memory, 568, 1)

    /**
     * global descriptor table register
     */
    this.gdtr_size = view(Int32Array, memory, 572, 1)
    this.gdtr_offset = view(Int32Array, memory, 576, 1)

    this.tss_size_32 = view(Int32Array, memory, 1128, 1)

    /*
     * whether or not a page fault occured
     */
    this.page_fault = view(Uint32Array, memory, 540, 8)

    this.cr = view(Int32Array, memory, 580, 8)

    // current privilege level
    this.cpl = view(Uint8Array, memory, 612, 1)

    // current operand/address size
    this.is_32 = view(Int32Array, memory, 804, 1)

    this.stack_size_32 = view(Int32Array, memory, 808, 1)

    /**
     * Was the last instruction a hlt?
     */
    this.in_hlt = view(Uint8Array, memory, 616, 1)

    this.last_virt_eip = view(Int32Array, memory, 620, 1)
    this.eip_phys = view(Int32Array, memory, 624, 1)

    this.sysenter_cs = view(Int32Array, memory, 636, 1)

    this.sysenter_esp = view(Int32Array, memory, 640, 1)

    this.sysenter_eip = view(Int32Array, memory, 644, 1)

    this.prefixes = view(Int32Array, memory, 648, 1)

    this.flags = view(Int32Array, memory, 120, 1)

    /**
     * bitmap of flags which are not updated in the flags variable
     * changed by arithmetic instructions, so only relevant to arithmetic flags
     */
    this.flags_changed = view(Int32Array, memory, 116, 1)

    /**
     * enough infos about the last arithmetic operation to compute eflags
     */
    this.last_op1 = view(Int32Array, memory, 96, 1)
    this.last_op_size = view(Int32Array, memory, 104, 1)
    this.last_result = view(Int32Array, memory, 112, 1)

    this.current_tsc = view(Uint32Array, memory, 960, 2) // 64 bit

    /** @type {!Object} */
    this.devices = {}

    this.instruction_pointer = view(Int32Array, memory, 556, 1)
    this.previous_ip = view(Int32Array, memory, 560, 1)

    // configured by guest
    this.apic_enabled = view(Uint8Array, memory, 548, 1)
    // configured when the emulator starts (changes bios initialisation)
    this.acpi_enabled = view(Uint8Array, memory, 552, 1)

    // managed in io.js
    /** @const */ this.memory_map_read8 = []
    /** @const */ this.memory_map_write8 = []
    /** @const */ this.memory_map_read32 = []
    /** @const */ this.memory_map_write32 = []

    /**
     * @const
     * @type {{main: ArrayBuffer, vga: ArrayBuffer}}
     */
    this.bios = {
      main: null,
      vga: null,
    }

    this.instruction_counter = view(Uint32Array, memory, 664, 1)

    // registers
    this.reg32 = view(Int32Array, memory, 64, 8)

    this.fpu_st = view(Int32Array, memory, 1152, 4 * 8)

    this.fpu_stack_empty = view(Uint8Array, memory, 816, 1)
    this.fpu_stack_empty[0] = 0xff
    this.fpu_stack_ptr = view(Uint8Array, memory, 1032, 1)
    this.fpu_stack_ptr[0] = 0

    this.fpu_control_word = view(Uint16Array, memory, 1036, 1)
    this.fpu_control_word[0] = 0x37f
    this.fpu_status_word = view(Uint16Array, memory, 1040, 1)
    this.fpu_status_word[0] = 0
    this.fpu_ip = view(Int32Array, memory, 1048, 1)
    this.fpu_ip[0] = 0
    this.fpu_ip_selector = view(Int32Array, memory, 1052, 1)
    this.fpu_ip_selector[0] = 0
    this.fpu_opcode = view(Int32Array, memory, 1044, 1)
    this.fpu_opcode[0] = 0
    this.fpu_dp = view(Int32Array, memory, 1056, 1)
    this.fpu_dp[0] = 0
    this.fpu_dp_selector = view(Int32Array, memory, 1060, 1)
    this.fpu_dp_selector[0] = 0

    this.reg_xmm32s = view(Int32Array, memory, 832, 8 * 4)

    this.mxcsr = view(Int32Array, memory, 824, 1)

    // segment registers, tr and ldtr
    this.sreg = view(Uint16Array, memory, 668, 8)

    // debug registers
    this.dreg = view(Int32Array, memory, 684, 8)

    this.fw_value = []
    this.fw_pointer = 0
    this.option_roms = []

    this.io = undefined

    this.bus = bus

    this.set_tsc(0, 0)

    this.debug_init()

    if (DEBUG) {
      this.do_many_cycles_count = 0
      this.do_many_cycles_total = 0

      this.seen_code = {}
      this.seen_code_uncompiled = {}
    }

    //Object.seal(this);
  }

  clear_opstats() {
    new Uint8Array(this.wasm_memory.buffer, 0x8000, 0x20000).fill(0)
    this.wm.exports['profiler_init']()
  }

  create_jit_imports() {
    // Set this.jit_imports as generated WASM modules will expect

    const jit_imports = Object.create(null)

    jit_imports['m'] = this.wm.exports['memory']

    for (let name of Object.keys(this.wm.exports)) {
      if (
        name.startsWith('_') ||
        name.startsWith('ZSTD') ||
        name.startsWith('zstd') ||
        name.endsWith('_js')
      ) {
        continue
      }

      jit_imports[name] = this.wm.exports[name]
    }

    this.jit_imports = jit_imports
  }

  wasm_patch() {
    const get_optional_import = (name) => {
      return this.wm.exports[name]
    }

    const get_import = (name) => {
      const f = get_optional_import(name)
      console.assert(f, 'Missing import: ' + name)
      return f
    }

    this.reset_cpu = get_import('reset_cpu')

    this.getiopl = get_import('getiopl')
    this.get_eflags = get_import('get_eflags')
    this.get_eflags_no_arith = get_import('get_eflags_no_arith')

    this.pic_call_irq = get_import('pic_call_irq')

    this.do_many_cycles_native = get_import('do_many_cycles_native')
    this.cycle_internal = get_import('cycle_internal')

    this.read8 = get_import('read8')
    this.read16 = get_import('read16')
    this.read32s = get_import('read32s')
    this.write16 = get_import('write16')
    this.write32 = get_import('write32')
    this.in_mapped_range = get_import('in_mapped_range')

    // used by nasmtests
    this.fpu_load_tag_word = get_import('fpu_load_tag_word')
    this.fpu_load_status_word = get_import('fpu_load_status_word')
    this.fpu_get_sti_f64 = get_import('fpu_get_sti_f64')

    this.translate_address_system_read = get_import(
      'translate_address_system_read_js'
    )

    this.get_seg_cs = get_import('get_seg_cs')
    this.get_real_eip = get_import('get_real_eip')

    this.clear_tlb = get_import('clear_tlb')
    this.full_clear_tlb = get_import('full_clear_tlb')

    this.set_tsc = get_import('set_tsc')
    this.store_current_tsc = get_import('store_current_tsc')

    if (DEBUG) {
      this.jit_force_generate_unsafe = get_optional_import(
        'jit_force_generate_unsafe'
      )
    }

    this.jit_clear_cache = get_import('jit_clear_cache_js')
    this.jit_dirty_cache = get_import('jit_dirty_cache')
    this.codegen_finalize_finished = get_import('codegen_finalize_finished')

    this.allocate_memory = get_import('allocate_memory')
    this.zero_memory = get_import('zero_memory')

    this.zstd_create_ctx = get_import('zstd_create_ctx')
    this.zstd_get_src_ptr = get_import('zstd_get_src_ptr')
    this.zstd_free_ctx = get_import('zstd_free_ctx')
    this.zstd_read = get_import('zstd_read')
    this.zstd_read_free = get_import('zstd_read_free')
  }

  jit_force_generate(addr) {
    if (!this.jit_force_generate_unsafe) {
      dbg_assert(
        false,
        'Not supported in this wasm build: jit_force_generate_unsafe'
      )
      return
    }

    this.jit_force_generate_unsafe(addr)
  }

  jit_clear_func(index) {
    dbg_assert(index >= 0 && index < WASM_TABLE_SIZE)
    this.wm.wasm_table.set(index + WASM_TABLE_OFFSET, null)
  }

  jit_clear_all_funcs() {
    const table = this.wm.wasm_table

    for (let i = 0; i < WASM_TABLE_SIZE; i++) {
      table.set(WASM_TABLE_OFFSET + i, null)
    }
  }

  get_state() {
    let state = []

    state[0] = this.memory_size[0]
    state[1] = this.segment_is_null
    state[2] = this.segment_offsets
    state[3] = this.segment_limits
    state[4] = this.protected_mode[0]
    state[5] = this.idtr_offset[0]
    state[6] = this.idtr_size[0]
    state[7] = this.gdtr_offset[0]
    state[8] = this.gdtr_size[0]
    state[9] = this.page_fault[0]
    state[10] = this.cr
    state[11] = this.cpl[0]

    state[13] = this.is_32[0]

    state[16] = this.stack_size_32[0]
    state[17] = this.in_hlt[0]
    state[18] = this.last_virt_eip[0]
    state[19] = this.eip_phys[0]

    state[22] = this.sysenter_cs[0]
    state[23] = this.sysenter_eip[0]
    state[24] = this.sysenter_esp[0]
    state[25] = this.prefixes[0]
    state[26] = this.flags[0]
    state[27] = this.flags_changed[0]
    state[28] = this.last_op1[0]

    state[30] = this.last_op_size[0]

    state[37] = this.instruction_pointer[0]
    state[38] = this.previous_ip[0]
    state[39] = this.reg32
    state[40] = this.sreg
    state[41] = this.dreg

    this.store_current_tsc()
    state[43] = this.current_tsc

    state[45] = this.devices.virtio_9p
    state[46] = this.devices.apic
    state[47] = this.devices.rtc
    state[48] = this.devices.pci
    state[49] = this.devices.dma
    state[50] = this.devices.acpi
    state[51] = this.devices.hpet
    state[52] = this.devices.vga
    state[53] = this.devices.ps2
    state[54] = this.devices.uart0
    state[55] = this.devices.fdc
    state[56] = this.devices.cdrom
    state[57] = this.devices.hda
    state[58] = this.devices.pit
    state[59] = this.devices.net
    state[60] = this.devices.pic
    state[61] = this.devices.sb16

    state[62] = this.fw_value

    state[63] = this.devices.ioapic

    state[64] = this.tss_size_32[0]

    state[66] = this.reg_xmm32s

    state[67] = this.fpu_st
    state[68] = this.fpu_stack_empty[0]
    state[69] = this.fpu_stack_ptr[0]
    state[70] = this.fpu_control_word[0]
    state[71] = this.fpu_ip[0]
    state[72] = this.fpu_ip_selector[0]
    state[73] = this.fpu_dp[0]
    state[74] = this.fpu_dp_selector[0]
    state[75] = this.fpu_opcode[0]

    const { packed_memory, bitmap } = this.pack_memory()
    state[77] = packed_memory
    state[78] = new Uint8Array(bitmap.get_buffer())

    state[79] = this.devices.uart1
    state[80] = this.devices.uart2
    state[81] = this.devices.uart3

    return state
  }

  set_state(state) {
    this.memory_size[0] = state[0]

    if (this.mem8.length !== this.memory_size[0]) {
      console.warn(
        'Note: Memory size mismatch. we=' +
          this.mem8.length +
          ' state=' +
          this.memory_size[0]
      )
    }

    this.segment_is_null.set(state[1])
    this.segment_offsets.set(state[2])
    this.segment_limits.set(state[3])
    this.protected_mode[0] = state[4]
    this.idtr_offset[0] = state[5]
    this.idtr_size[0] = state[6]
    this.gdtr_offset[0] = state[7]
    this.gdtr_size[0] = state[8]
    this.page_fault[0] = state[9]
    this.cr.set(state[10])
    this.cpl[0] = state[11]

    this.is_32[0] = state[13]

    this.stack_size_32[0] = state[16]

    this.in_hlt[0] = state[17]
    this.last_virt_eip[0] = state[18]
    this.eip_phys[0] = state[19]

    this.sysenter_cs[0] = state[22]
    this.sysenter_eip[0] = state[23]
    this.sysenter_esp[0] = state[24]
    this.prefixes[0] = state[25]

    this.flags[0] = state[26]
    this.flags_changed[0] = state[27]
    this.last_op1[0] = state[28]

    this.last_op_size[0] = state[30]

    this.instruction_pointer[0] = state[37]
    this.previous_ip[0] = state[38]
    this.reg32.set(state[39])
    this.sreg.set(state[40])
    this.dreg.set(state[41])

    this.set_tsc(state[43][0], state[43][1])

    if (this.devices.virtio_9p) this.devices.virtio_9p.set_state(state[45])
    if (this.devices.apic) this.devices.apic.set_state(state[46])
    if (this.devices.rtc) this.devices.rtc.set_state(state[47])
    if (this.devices.pci) this.devices.pci.set_state(state[48])
    if (this.devices.dma) this.devices.dma.set_state(state[49])
    if (this.devices.acpi) this.devices.acpi.set_state(state[50])
    if (this.devices.hpet) this.devices.hpet.set_state(state[51])
    if (this.devices.vga) this.devices.vga.set_state(state[52])
    if (this.devices.ps2) this.devices.ps2.set_state(state[53])
    if (this.devices.uart0) this.devices.uart0.set_state(state[54])
    if (this.devices.fdc) this.devices.fdc.set_state(state[55])
    if (this.devices.cdrom) this.devices.cdrom.set_state(state[56])
    if (this.devices.hda) this.devices.hda.set_state(state[57])
    if (this.devices.pit) this.devices.pit.set_state(state[58])
    if (this.devices.net) this.devices.net.set_state(state[59])
    if (this.devices.pic) this.devices.pic.set_state(state[60])
    if (this.devices.sb16) this.devices.sb16.set_state(state[61])

    if (this.devices.uart1) this.devices.uart1.set_state(state[79])
    if (this.devices.uart2) this.devices.uart2.set_state(state[80])
    if (this.devices.uart3) this.devices.uart3.set_state(state[81])

    this.fw_value = state[62]

    if (this.devices.ioapic) this.devices.ioapic.set_state(state[63])

    this.tss_size_32[0] = state[64]

    this.reg_xmm32s.set(state[66])

    this.fpu_st.set(state[67])
    this.fpu_stack_empty[0] = state[68]
    this.fpu_stack_ptr[0] = state[69]
    this.fpu_control_word[0] = state[70]
    this.fpu_ip[0] = state[71]
    this.fpu_ip_selector[0] = state[72]
    this.fpu_dp[0] = state[73]
    this.fpu_dp_selector[0] = state[74]
    this.fpu_opcode[0] = state[75]

    const bitmap = new Bitmap(state[78].buffer)
    const packed_memory = state[77]
    this.unpack_memory(bitmap, packed_memory)

    this.full_clear_tlb()

    this.jit_clear_cache()
  }

  pack_memory() {
    dbg_assert((this.mem8.length & 0xfff) === 0)

    const page_count = this.mem8.length >> 12
    const nonzero_pages = []

    for (let page = 0; page < page_count; page++) {
      const offset = page << 12
      const view = this.mem32s.subarray(offset >> 2, (offset + 0x1000) >> 2)
      let is_zero = true

      for (let i = 0; i < view.length; i++) {
        if (view[i] !== 0) {
          is_zero = false
          break
        }
      }

      if (!is_zero) {
        nonzero_pages.push(page)
      }
    }

    const bitmap = new Bitmap(page_count)
    const packed_memory = new Uint8Array(nonzero_pages.length << 12)

    for (let [i, page] of nonzero_pages.entries()) {
      bitmap.set(page, 1)

      const offset = page << 12
      const page_contents = this.mem8.subarray(offset, offset + 0x1000)
      packed_memory.set(page_contents, i << 12)
    }

    return { bitmap, packed_memory }
  }

  unpack_memory(bitmap, packed_memory) {
    this.zero_memory(this.memory_size[0])

    const page_count = this.memory_size[0] >> 12
    let packed_page = 0

    for (let page = 0; page < page_count; page++) {
      if (bitmap.get(page)) {
        let offset = packed_page << 12
        let view = packed_memory.subarray(offset, offset + 0x1000)
        this.mem8.set(view, page << 12)
        packed_page++
      }
    }
  }

  /**
   * @return {number} time in ms until this method should becalled again
   */
  main_run() {
    if (this.in_hlt[0]) {
      //if(false)
      //{
      //    let _t = this.hlt_loop();
      //    let t = 0;
      //}
      //else
      //{
      let t = this.hlt_loop()
      //}

      if (this.in_hlt[0]) {
        return t
      }
    }

    this.do_run()

    return 0
  }

  reboot_internal() {
    this.reset_cpu()

    this.fw_value = []

    if (this.devices.virtio) {
      this.devices.virtio.reset()
    }

    this.load_bios()
  }

  reset_memory() {
    this.mem8.fill(0)
  }

  /** @export */
  create_memory(size) {
    if (size < 1024 * 1024) {
      size = 1024 * 1024
    } else if ((size | 0) < 0) {
      size = Math.pow(2, 31) - MMAP_BLOCK_SIZE
    }

    size = (((size - 1) | (MMAP_BLOCK_SIZE - 1)) + 1) | 0
    dbg_assert((size | 0) > 0)
    dbg_assert((size & (MMAP_BLOCK_SIZE - 1)) === 0)

    console.assert(this.memory_size[0] === 0, 'Expected uninitialised memory')

    this.memory_size[0] = size

    const memory_offset = this.allocate_memory(size)

    this.mem8 = view(Uint8Array, this.wasm_memory, memory_offset, size)
    this.mem32s = view(Uint32Array, this.wasm_memory, memory_offset, size >> 2)
  }

  init(settings, device_bus) {
    // if (typeof settings.log_level === 'number') {
    //   // XXX: Shared between all emulator instances
    //   LOG_LEVEL = settings.log_level
    // }

    this.create_memory(
      typeof settings.memory_size === 'number'
        ? settings.memory_size
        : 1024 * 1024 * 64
    )

    this.acpi_enabled[0] = +settings.acpi

    this.reset_cpu()

    let io = new IO(this)
    this.io = io

    this.bios.main = settings.bios
    this.bios.vga = settings.vga_bios

    this.load_bios()

    if (settings.bzimage) {
      const { option_rom } = load_kernel(
        this.mem8,
        settings.bzimage,
        settings.initrd,
        settings.cmdline || ''
      )

      if (option_rom) {
        this.option_roms.push(option_rom)
      }
    }

    io.register_read(0xb3, this, function () {
      // seabios smm_relocate_and_restore
      dbg_log('port 0xB3 read')
      return 0
    })

    let a20_byte = 0

    io.register_read(0x92, this, function () {
      return a20_byte
    })

    io.register_write(0x92, this, function (out_byte) {
      a20_byte = out_byte
    })

    io.register_read(0x511, this, function () {
      // bios config port (used by seabios and kvm-unit-test)
      if (this.fw_pointer < this.fw_value.length) {
        return this.fw_value[this.fw_pointer++]
      } else {
        dbg_assert(false, 'config port: Read past value')
        return 0
      }
    })
    io.register_write(0x510, this, undefined, function (value) {
      // https://wiki.osdev.org/QEMU_fw_cfg
      // https://github.com/qemu/qemu/blob/master/docs/specs/fw_cfg.txt

      dbg_log('bios config port, index=' + h(value))

      function i32(x) {
        return new Uint8Array(new Int32Array([x]).buffer)
      }

      function to_be16(x) {
        return (x >> 8) | ((x << 8) & 0xff00)
      }

      function to_be32(x) {
        return (
          (x << 24) | ((x << 8) & 0xff0000) | ((x >> 8) & 0xff00) | (x >>> 24)
        )
      }

      this.fw_pointer = 0

      if (value === FW_CFG_SIGNATURE) {
        // Pretend to be qemu (for seabios)
        this.fw_value = i32(FW_CFG_SIGNATURE_QEMU)
      } else if (value === FW_CFG_ID) {
        this.fw_value = i32(0)
      } else if (value === FW_CFG_RAM_SIZE) {
        this.fw_value = i32(this.memory_size[0])
      } else if (value === FW_CFG_NB_CPUS) {
        this.fw_value = i32(1)
      } else if (value === FW_CFG_MAX_CPUS) {
        this.fw_value = i32(1)
      } else if (value === FW_CFG_NUMA) {
        this.fw_value = new Uint8Array(16)
      } else if (value === FW_CFG_FILE_DIR) {
        const buffer_size = 4 + 64 * this.option_roms.length
        const buffer32 = new Int32Array(buffer_size)
        const buffer8 = new Uint8Array(buffer32.buffer)

        buffer32[0] = to_be32(this.option_roms.length)

        for (let i = 0; i < this.option_roms.length; i++) {
          const { name, data } = this.option_roms[i]
          const file_struct_ptr = 4 + 64 * i

          dbg_assert(FW_CFG_FILE_START + i < 0x10000)
          buffer32[(file_struct_ptr + 0) >> 2] = to_be32(data.length)
          buffer32[(file_struct_ptr + 4) >> 2] = to_be16(FW_CFG_FILE_START + i)

          dbg_assert(name.length < 64 - 8)

          for (let j = 0; j < name.length; j++) {
            buffer8[file_struct_ptr + 8 + j] = name.charCodeAt(j)
          }
        }

        this.fw_value = buffer8
      } else if (value >= FW_CFG_CUSTOM_START && value < FW_CFG_FILE_START) {
        this.fw_value = i32(0)
      } else if (
        value >= FW_CFG_FILE_START &&
        value - FW_CFG_FILE_START < this.option_roms.length
      ) {
        const i = value - FW_CFG_FILE_START
        this.fw_value = this.option_roms[i].data
      } else {
        dbg_log('Warning: Unimplemented fw index: ' + h(value))
        this.fw_value = i32(0)
      }
    })

    if (DEBUG) {
      // Use by linux for port-IO delay
      // Avoid generating tons of debug messages
      // eslint-disable-next-line no-unused-vars
      io.register_write(0x80, this, function (out_byte) {})
    }

    this.devices = {}

    // TODO: Make this more configurable
    if (settings.load_devices) {
      this.devices.pic = new PIC(this)
      this.devices.pci = new PCI(this)

      if (this.acpi_enabled[0]) {
        this.devices.ioapic = new IOAPIC(this)
        this.devices.apic = new APIC(this)
        this.devices.acpi = new ACPI(this)
      }

      this.devices.rtc = new RTC(this)
      this.fill_cmos(this.devices.rtc, settings)

      this.devices.dma = new DMA(this)

      if (ENABLE_HPET) {
        this.devices.hpet = new HPET(this)
      }

      this.devices.vga = new VGAScreen(
        this,
        device_bus,
        settings.vga_memory_size || 8 * 1024 * 1024
      )

      this.devices.ps2 = new PS2(this, device_bus)

      this.devices.uart0 = new UART(this, 0x3f8, device_bus)

      if (settings.uart1) {
        this.devices.uart1 = new UART(this, 0x2f8, device_bus)
      }
      if (settings.uart2) {
        this.devices.uart2 = new UART(this, 0x3e8, device_bus)
      }
      if (settings.uart3) {
        this.devices.uart3 = new UART(this, 0x2e8, device_bus)
      }

      this.devices.fdc = new FloppyController(this, settings.fda, settings.fdb)

      let ide_device_count = 0

      if (settings.hda) {
        this.devices.hda = new IDEDevice(
          this,
          settings.hda,
          settings.hdb,
          false,
          ide_device_count++,
          device_bus
        )
      }

      if (settings.cdrom) {
        this.devices.cdrom = new IDEDevice(
          this,
          settings.cdrom,
          undefined,
          true,
          ide_device_count++,
          device_bus
        )
      }

      this.devices.pit = new PIT(this, device_bus)

      if (settings.enable_ne2k) {
        this.devices.net = new Ne2k(
          this,
          device_bus,
          settings.preserve_mac_from_state_image
        )
      }

      if (settings.fs9p) {
        this.devices.virtio_9p = new Virtio9p(settings.fs9p, this, device_bus)
      }

      if (settings.sound_card) {
        this.devices.sb16 = new SB16(this, device_bus)
      }
    }

    if (settings.multiboot) {
      this.load_multiboot(settings.multiboot)
    }

    if (DEBUG) {
      this.debug.init()
    }
  }

  load_multiboot(buffer) {
    // https://www.gnu.org/software/grub/manual/multiboot/multiboot.html

    dbg_log(
      'Trying multiboot from buffer of size ' + buffer.byteLength,
      LOG_CPU
    )

    const MAGIC = 0x1badb002
    const ELF_MAGIC = 0x464c457f
    const MULTIBOOT_HEADER_ADDRESS = 0x10000
    const MULTIBOOT_SEARCH_BYTES = 8192

    const buf32 =
      buffer.byteLength < MULTIBOOT_SEARCH_BYTES
        ? new Int32Array(MULTIBOOT_SEARCH_BYTES / 4)
        : new Int32Array(buffer, 0, MULTIBOOT_SEARCH_BYTES / 4)

    if (buffer.byteLength < MULTIBOOT_SEARCH_BYTES) {
      new Uint8Array(buf32.buffer).set(new Uint8Array(buffer))
    }

    for (let offset = 0; offset < MULTIBOOT_SEARCH_BYTES; offset += 4) {
      let flags, checksum, total

      if (buf32[offset >> 2] === MAGIC) {
        flags = buf32[(offset + 4) >> 2]
        checksum = buf32[(offset + 8) >> 2]
        total = (MAGIC + flags + checksum) | 0

        if (total) {
          dbg_log('Multiboot checksum check failed', LOG_CPU)
          continue
        }
      } else {
        continue
      }

      dbg_log('Multiboot magic found, flags: ' + h(flags >>> 0, 8), LOG_CPU)
      dbg_assert((flags & ~MULTIBOOT_HEADER_ADDRESS) === 0, 'TODO')

      this.reg32[REG_EAX] = 0x2badb002

      let multiboot_info_addr = 0x7c00
      this.reg32[REG_EBX] = multiboot_info_addr
      this.write32(multiboot_info_addr, 0)

      this.cr[0] = 1
      this.protected_mode[0] = +true
      this.flags[0] = FLAGS_DEFAULT
      this.is_32[0] = +true
      this.stack_size_32[0] = +true

      for (let i = 0; i < 6; i++) {
        this.segment_is_null[i] = 0
        this.segment_offsets[i] = 0
        this.segment_limits[i] = 0xffffffff

        // Value doesn't matter, OS isn't allowed to reload without setting
        // up a proper GDT
        this.sreg[i] = 0xb002
      }

      if (flags & MULTIBOOT_HEADER_ADDRESS) {
        dbg_log('Multiboot specifies its own address table', LOG_CPU)

        let header_addr = buf32[(offset + 12) >> 2]
        let load_addr = buf32[(offset + 16) >> 2]
        let load_end_addr = buf32[(offset + 20) >> 2]
        let bss_end_addr = buf32[(offset + 24) >> 2]
        let entry_addr = buf32[(offset + 28) >> 2]

        dbg_log(
          'header=' +
            h(header_addr, 8) +
            ' load=' +
            h(load_addr, 8) +
            ' load_end=' +
            h(load_end_addr, 8) +
            ' bss_end=' +
            h(bss_end_addr, 8) +
            ' entry=' +
            h(entry_addr, 8)
        )

        dbg_assert(load_addr <= header_addr)

        let file_start = offset - (header_addr - load_addr)
        let length

        if (load_end_addr === 0) {
          length = undefined
        } else {
          dbg_assert(load_end_addr >= load_addr)
          length = load_end_addr - load_addr
        }

        let blob = new Uint8Array(buffer, file_start, length)
        this.write_blob(blob, load_addr)

        this.instruction_pointer[0] = (this.get_seg_cs() + entry_addr) | 0
      } else if (buf32[0] === ELF_MAGIC) {
        dbg_log('Multiboot image is in elf format', LOG_CPU)

        let elf = read_elf(buffer)

        this.instruction_pointer[0] = (this.get_seg_cs() + elf.header.entry) | 0

        for (let program of elf.program_headers) {
          if (program.type === 0) {
            // null
          } else if (program.type === 1) {
            // load

            // Since multiboot specifies that paging is disabled,
            // virtual and physical address must be equal
            dbg_assert(program.paddr === program.vaddr)
            dbg_assert(program.filesz <= program.memsz)

            if (program.paddr + program.memsz < this.memory_size[0]) {
              if (program.filesz) {
                // offset might be outside of buffer if filesz is 0
                let blob = new Uint8Array(
                  buffer,
                  program.offset,
                  program.filesz
                )
                this.write_blob(blob, program.paddr)
              }
            } else {
              dbg_log(
                'Warning: Skipped loading section, paddr=' +
                  h(program.paddr) +
                  ' memsz=' +
                  program.memsz,
                LOG_CPU
              )
            }
          } else if (
            program.type === 2 ||
            program.type === 3 ||
            program.type === 4 ||
            program.type === 6 ||
            program.type === 0x6474e550 ||
            program.type === 0x6474e551 ||
            program.type === 0x6474e553
          ) {
            // ignore for now
          } else {
            dbg_assert(
              false,
              'unimplemented elf section type: ' + h(program.type)
            )
          }
        }
      } else {
        dbg_assert(false, 'Not a bootable multiboot format')
      }

      // only for kvm-unit-test
      this.io.register_write_consecutive(
        0xf4,
        this,
        function (value) {
          console.log('Test exited with code ' + h(value, 2))
          throw 'HALT'
        },
        function () {},
        function () {},
        function () {}
      )

      // only for kvm-unit-test
      for (let i = 0xe; i <= 0xf; i++) {
        this.io.register_write(0x2000 + i, this, function (value) {
          dbg_log('kvm-unit-test: Set irq ' + h(i) + ' to ' + h(value, 2))
          if (value) {
            this.device_raise_irq(i)
          } else {
            this.device_lower_irq(i)
          }
        })
      }

      dbg_log('Starting multiboot kernel at:', LOG_CPU)
      this.debug.dump_state()
      this.debug.dump_regs()

      break
    }
  }

  fill_cmos(rtc, settings) {
    let boot_order = settings.boot_order || 0x213

    // Used by seabios to determine the boot order
    //   Nibble
    //   1: FloppyPrio
    //   2: HDPrio
    //   3: CDPrio
    //   4: BEVPrio
    // bootflag 1, high nibble, lowest priority
    // Low nibble: Disable floppy signature check (1)
    rtc.cmos_write(CMOS_BIOS_BOOTFLAG1, 1 | ((boot_order >> 4) & 0xf0))

    // bootflag 2, both nibbles, high and middle priority
    rtc.cmos_write(CMOS_BIOS_BOOTFLAG2, boot_order & 0xff)

    // 640k or less if less memory is used
    rtc.cmos_write(CMOS_MEM_BASE_LOW, 640 & 0xff)
    rtc.cmos_write(CMOS_MEM_BASE_HIGH, 640 >> 8)

    let memory_above_1m = 0 // in k
    if (this.memory_size[0] >= 1024 * 1024) {
      memory_above_1m = (this.memory_size[0] - 1024 * 1024) >> 10
      memory_above_1m = Math.min(memory_above_1m, 0xffff)
    }

    rtc.cmos_write(CMOS_MEM_OLD_EXT_LOW, memory_above_1m & 0xff)
    rtc.cmos_write(CMOS_MEM_OLD_EXT_HIGH, (memory_above_1m >> 8) & 0xff)
    rtc.cmos_write(CMOS_MEM_EXTMEM_LOW, memory_above_1m & 0xff)
    rtc.cmos_write(CMOS_MEM_EXTMEM_HIGH, (memory_above_1m >> 8) & 0xff)

    let memory_above_16m = 0 // in 64k blocks
    if (this.memory_size[0] >= 16 * 1024 * 1024) {
      memory_above_16m = (this.memory_size[0] - 16 * 1024 * 1024) >> 16
      memory_above_16m = Math.min(memory_above_16m, 0xffff)
    }
    rtc.cmos_write(CMOS_MEM_EXTMEM2_LOW, memory_above_16m & 0xff)
    rtc.cmos_write(CMOS_MEM_EXTMEM2_HIGH, (memory_above_16m >> 8) & 0xff)

    // memory above 4G (not supported by this emulator)
    rtc.cmos_write(CMOS_MEM_HIGHMEM_LOW, 0)
    rtc.cmos_write(CMOS_MEM_HIGHMEM_MID, 0)
    rtc.cmos_write(CMOS_MEM_HIGHMEM_HIGH, 0)

    rtc.cmos_write(CMOS_EQUIPMENT_INFO, 0x2f)

    rtc.cmos_write(CMOS_BIOS_SMP_COUNT, 0)

    // Used by bochs BIOS to skip the boot menu delay.
    if (settings.fastboot) rtc.cmos_write(0x3f, 0x01)
  }

  load_bios() {
    let bios = this.bios.main
    let vga_bios = this.bios.vga

    if (!bios) {
      dbg_log('Warning: No BIOS')
      return
    }

    // load bios
    let data = new Uint8Array(bios),
      start = 0x100000 - bios.byteLength

    this.write_blob(data, start)

    if (vga_bios) {
      // load vga bios
      let vga_bios8 = new Uint8Array(vga_bios)

      // older versions of seabios
      this.write_blob(vga_bios8, 0xc0000)

      // newer versions of seabios (needs to match pci rom address, see vga.js)
      this.io.mmap_register(
        0xfeb00000,
        0x100000,
        function (addr) {
          addr = (addr - 0xfeb00000) | 0
          if (addr < vga_bios8.length) {
            return vga_bios8[addr]
          } else {
            return 0
          }
        },
        // eslint-disable-next-line no-unused-vars
        function (addr, value) {
          dbg_assert(false, 'Unexpected write to VGA rom')
        }
      )
    } else {
      dbg_log('Warning: No VGA BIOS')
    }

    // seabios expects the bios to be mapped to 0xFFF00000 also
    this.io.mmap_register(
      0xfff00000,
      0x100000,
      function (addr) {
        addr &= 0xfffff
        return this.mem8[addr]
      }.bind(this),
      function (addr, value) {
        addr &= 0xfffff
        this.mem8[addr] = value
      }.bind(this)
    )
  }

  do_run() {
    /** @type {number} */
    let start = microtick()

    /** @type {number} */
    let now = start

    // outer loop:
    // runs cycles + timers
    for (; now - start < TIME_PER_FRAME; ) {
      this.run_hardware_timers(now)
      this.handle_irqs()

      this.do_many_cycles()

      if (this.in_hlt[0]) {
        return
      }

      now = microtick()
    }
  }

  do_many_cycles() {
    let start_time
    if (DEBUG) {
      start_time = microtick()
    }

    this.do_many_cycles_native()

    if (DEBUG) {
      this.do_many_cycles_total += microtick() - start_time
      this.do_many_cycles_count++
    }
  }

  /** @export */
  cycle() {
    // XXX: May do several cycles
    this.cycle_internal()
  }

  codegen_finalize(wasm_table_index, start, state_flags, ptr, len) {
    ptr >>>= 0
    len >>>= 0

    dbg_assert(wasm_table_index >= 0 && wasm_table_index < WASM_TABLE_SIZE)

    const code = new Uint8Array(this.wasm_memory.buffer, ptr, len)

    if (DEBUG) {
      if (DUMP_GENERATED_WASM && !this.seen_code[start]) {
        this.debug.dump_wasm(code)

        const DUMP_ASSEMBLY = false

        if (DUMP_ASSEMBLY) {
          let end = 0

          if ((start ^ end) & ~0xfff) {
            dbg_log(
              'truncated disassembly start=' +
                h(start >>> 0) +
                ' end=' +
                h(end >>> 0)
            )
            end = (start | 0xfff) + 1 // until the end of the page
          }

          dbg_assert(end >= start)

          const buffer = new Uint8Array(end - start)

          for (let i = start; i < end; i++) {
            buffer[i - start] = this.read8(i)
          }

          this.debug.dump_code(this.is_32[0] ? 1 : 0, buffer, start)
        }
      }

      this.seen_code[start] = (this.seen_code[start] || 0) + 1

      if (this.test_hook_did_generate_wasm) {
        this.test_hook_did_generate_wasm(code)
      }
    }

    const SYNC_COMPILATION = false

    if (SYNC_COMPILATION) {
      const module = new WebAssembly.Module(code)
      const result = new WebAssembly.Instance(module, { e: this.jit_imports })
      const f = result.exports['f']

      this.codegen_finalize_finished(wasm_table_index, start, state_flags)

      this.wm.wasm_table.set(wasm_table_index + WASM_TABLE_OFFSET, f)

      if (this.test_hook_did_finalize_wasm) {
        this.test_hook_did_finalize_wasm(code)
      }

      return
    }

    const result = WebAssembly.instantiate(code, { e: this.jit_imports }).then(
      (result) => {
        const f = result.instance.exports['f']

        this.codegen_finalize_finished(wasm_table_index, start, state_flags)

        this.wm.wasm_table.set(wasm_table_index + WASM_TABLE_OFFSET, f)

        if (this.test_hook_did_finalize_wasm) {
          this.test_hook_did_finalize_wasm(code)
        }
      }
    )

    if (DEBUG) {
      result.catch((e) => {
        console.log(e)

        // eslint-disable-next-line no-debugger
        debugger
        throw e
      })
    }
  }

  log_uncompiled_code(start, end) {
    if (!DEBUG || !DUMP_UNCOMPILED_ASSEMBLY) {
      return
    }

    if ((this.seen_code_uncompiled[start] || 0) < 100) {
      this.seen_code_uncompiled[start] =
        (this.seen_code_uncompiled[start] || 0) + 1

      end += 8 // final jump is not included

      if ((start ^ end) & ~0xfff) {
        dbg_log(
          'truncated disassembly start=' +
            h(start >>> 0) +
            ' end=' +
            h(end >>> 0)
        )
        end = (start | 0xfff) + 1 // until the end of the page
      }

      if (end < start) end = start

      dbg_assert(end >= start)

      const buffer = new Uint8Array(end - start)

      for (let i = start; i < end; i++) {
        buffer[i - start] = this.read8(i)
      }

      dbg_log('Uncompiled code:')
      this.debug.dump_code(this.is_32[0] ? 1 : 0, buffer, start)
    }
  }

  dump_function_code(block_ptr, count) {
    if (!DEBUG || !DUMP_GENERATED_WASM) {
      return
    }

    const SIZEOF_BASIC_BLOCK_IN_DWORDS = 7

    const mem32 = new Int32Array(this.wasm_memory.buffer)

    dbg_assert((block_ptr & 3) === 0)

    const is_32 = this.is_32[0]

    for (let i = 0; i < count; i++) {
      const struct_start = (block_ptr >> 2) + i * SIZEOF_BASIC_BLOCK_IN_DWORDS
      const start = mem32[struct_start + 0]
      const end = mem32[struct_start + 1]
      const is_entry_block = mem32[struct_start + 6] & 0xff00

      const buffer = new Uint8Array(end - start)

      for (let i = start; i < end; i++) {
        buffer[i - start] = this.read8(this.translate_address_system_read(i))
      }

      dbg_log('---' + (is_entry_block ? ' entry' : ''))
      this.debug.dump_code(is_32 ? 1 : 0, buffer, start)
    }
  }

  hlt_loop() {
    if (this.get_eflags_no_arith() & FLAG_INTERRUPT) {
      //dbg_log("In HLT loop", LOG_CPU);

      this.run_hardware_timers(microtick())
      this.handle_irqs()

      return 0
    } else {
      return 100
    }
  }

  run_hardware_timers(now) {
    if (ENABLE_HPET) {
      this.devices.pit.timer(now, this.devices.hpet.legacy_mode)
      this.devices.rtc.timer(now, this.devices.hpet.legacy_mode)
      this.devices.hpet.timer(now)
    } else {
      this.devices.pit.timer(now, false)
      this.devices.rtc.timer(now, false)
    }

    if (this.acpi_enabled[0]) {
      this.devices.acpi.timer(now)
      this.devices.apic.timer(now)
    }
  }

  hlt_op() {
    if ((this.get_eflags_no_arith() & FLAG_INTERRUPT) === 0) {
      // execution can never resume (until NMIs are supported)
      this.bus.send('cpu-event-halt')
    }

    // get out of here and into hlt_loop
    this.in_hlt[0] = +true

    // Try an hlt loop right now: This will run timer interrupts, and if one is
    // due it will immediately call call_interrupt_vector and continue
    // execution without an unnecessary cycle through do_run
    this.hlt_loop()
  }

  handle_irqs() {
    //dbg_assert(this.prefixes[0] === 0);

    if (this.get_eflags_no_arith() & FLAG_INTERRUPT) {
      this.pic_acknowledge()
    }
  }

  pic_acknowledge() {
    dbg_assert(this.get_eflags_no_arith() & FLAG_INTERRUPT)

    if (this.devices.pic) {
      this.devices.pic.acknowledge_irq()
    }

    if (this.devices.apic) {
      this.devices.apic.acknowledge_irq()
    }
  }

  device_raise_irq(i) {
    dbg_assert(arguments.length === 1)
    if (this.devices.pic) {
      this.devices.pic.set_irq(i)
    }

    if (this.devices.ioapic) {
      this.devices.ioapic.set_irq(i)
    }
  }

  device_lower_irq(i) {
    if (this.devices.pic) {
      this.devices.pic.clear_irq(i)
    }

    if (this.devices.ioapic) {
      this.devices.ioapic.clear_irq(i)
    }
  }

  /////////////////////////////////////////////////////////////////////////////
  // STATE

  save_state() {
    let saved_buffers = []
    let state = save_object(this, saved_buffers)

    let buffer_infos = []
    let total_buffer_size = 0

    for (let i = 0; i < saved_buffers.length; i++) {
      let len = saved_buffers[i].byteLength

      buffer_infos[i] = {
        offset: total_buffer_size,
        length: len,
      }

      total_buffer_size += len

      // align
      total_buffer_size = (total_buffer_size + 3) & ~3
    }

    let info_object = JSON.stringify({
      buffer_infos: buffer_infos,
      state: state,
    })
    let info_block = new TextEncoder().encode(info_object)

    let buffer_block_start = STATE_INFO_BLOCK_START + info_block.length
    buffer_block_start = (buffer_block_start + 3) & ~3
    let total_size = buffer_block_start + total_buffer_size

    //console.log("State: json_size=" + Math.ceil(buffer_block_start / 1024 / 1024) + "MB " +
    //               "buffer_size=" + Math.ceil(total_buffer_size / 1024 / 1024) + "MB");

    let result = new ArrayBuffer(total_size)

    let header_block = new Int32Array(result, 0, STATE_INFO_BLOCK_START / 4)
    new Uint8Array(result, STATE_INFO_BLOCK_START, info_block.length).set(
      info_block
    )
    let buffer_block = new Uint8Array(result, buffer_block_start)

    header_block[STATE_INDEX_MAGIC] = STATE_MAGIC
    header_block[STATE_INDEX_VERSION] = STATE_VERSION
    header_block[STATE_INDEX_TOTAL_LEN] = total_size
    header_block[STATE_INDEX_INFO_LEN] = info_block.length

    for (let i = 0; i < saved_buffers.length; i++) {
      let buffer = saved_buffers[i]
      dbg_assert(buffer.constructor === Uint8Array)
      buffer_block.set(buffer, buffer_infos[i].offset)
    }

    dbg_log('State: json size ' + (info_block.byteLength >> 10) + 'k')
    dbg_log(
      'State: Total buffers size ' + (buffer_block.byteLength >> 10) + 'k'
    )

    return result
  }

  restore_state(state) {
    state = new Uint8Array(state)

    function read_state_header(state, check_length) {
      const len = state.length

      if (len < STATE_INFO_BLOCK_START) {
        throw new StateLoadError('Invalid length: ' + len)
      }

      const header_block = new Int32Array(state.buffer, state.byteOffset, 4)

      if (header_block[STATE_INDEX_MAGIC] !== STATE_MAGIC) {
        throw new StateLoadError(
          'Invalid header: ' + h(header_block[STATE_INDEX_MAGIC] >>> 0)
        )
      }

      if (header_block[STATE_INDEX_VERSION] !== STATE_VERSION) {
        throw new StateLoadError(
          'Version mismatch: dump=' +
            header_block[STATE_INDEX_VERSION] +
            ' we=' +
            STATE_VERSION
        )
      }

      if (check_length && header_block[STATE_INDEX_TOTAL_LEN] !== len) {
        throw new StateLoadError(
          "Length doesn't match header: " +
            'real=' +
            len +
            ' header=' +
            header_block[STATE_INDEX_TOTAL_LEN]
        )
      }

      return header_block[STATE_INDEX_INFO_LEN]
    }

    function read_info_block(info_block_buffer) {
      const info_block = new TextDecoder().decode(info_block_buffer)
      return JSON.parse(info_block)
    }

    if (new Uint32Array(state.buffer, 0, 1)[0] === ZSTD_MAGIC) {
      const ctx = this.zstd_create_ctx(state.length)

      new Uint8Array(
        this.wasm_memory.buffer,
        this.zstd_get_src_ptr(ctx),
        state.length
      ).set(state)

      let ptr = this.zstd_read(ctx, 16)
      const header_block = new Uint8Array(this.wasm_memory.buffer, ptr, 16)
      const info_block_len = read_state_header(header_block, false)
      this.zstd_read_free(ptr, 16)

      ptr = this.zstd_read(ctx, info_block_len)
      const info_block_buffer = new Uint8Array(
        this.wasm_memory.buffer,
        ptr,
        info_block_len
      )
      const info_block_obj = read_info_block(info_block_buffer)
      this.zstd_read_free(ptr, info_block_len)

      let state_object = info_block_obj['state']
      const buffer_infos = info_block_obj['buffer_infos']
      const buffers = []

      let position = STATE_INFO_BLOCK_START + info_block_len

      for (const buffer_info of buffer_infos) {
        const front_padding = ((position + 3) & ~3) - position
        const CHUNK_SIZE = 1 * 1024 * 1024

        if (buffer_info.length > CHUNK_SIZE) {
          const ptr = this.zstd_read(ctx, front_padding)
          this.zstd_read_free(ptr, front_padding)

          const buffer = new Uint8Array(buffer_info.length)
          buffers.push(buffer.buffer)

          let have = 0
          while (have < buffer_info.length) {
            const remaining = buffer_info.length - have
            dbg_assert(remaining >= 0)
            const to_read = Math.min(remaining, CHUNK_SIZE)

            const ptr = this.zstd_read(ctx, to_read)
            buffer.set(
              new Uint8Array(this.wasm_memory.buffer, ptr, to_read),
              have
            )
            this.zstd_read_free(ptr, to_read)

            have += to_read
          }
        } else {
          const ptr = this.zstd_read(ctx, front_padding + buffer_info.length)
          const offset = ptr + front_padding
          buffers.push(
            this.wasm_memory.buffer.slice(offset, offset + buffer_info.length)
          )
          this.zstd_read_free(ptr, front_padding + buffer_info.length)
        }

        position += front_padding + buffer_info.length
      }

      state_object = restore_buffers(state_object, buffers)
      this.set_state(state_object)

      this.zstd_free_ctx(ctx)
    } else {
      const info_block_len = read_state_header(state, true)

      if (info_block_len < 0 || info_block_len + 12 >= state.length) {
        throw new StateLoadError('Invalid info block length: ' + info_block_len)
      }

      const info_block_buffer = state.subarray(
        STATE_INFO_BLOCK_START,
        STATE_INFO_BLOCK_START + info_block_len
      )
      const info_block_obj = read_info_block(info_block_buffer)
      let state_object = info_block_obj['state']
      const buffer_infos = info_block_obj['buffer_infos']
      let buffer_block_start = STATE_INFO_BLOCK_START + info_block_len
      buffer_block_start = (buffer_block_start + 3) & ~3

      const buffers = buffer_infos.map((buffer_info) => {
        const offset = buffer_block_start + buffer_info.offset
        return state.buffer.slice(offset, offset + buffer_info.length)
      })

      state_object = restore_buffers(state_object, buffers)
      this.set_state(state_object)
    }
  }

  /////////////////////////////////////////////////////////////////////////////
  // MEMORY

  mmap_read8(addr) {
    return this.memory_map_read8[addr >>> MMAP_BLOCK_BITS](addr)
  }

  mmap_write8(addr, value) {
    dbg_assert(value >= 0 && value <= 0xff)
    this.memory_map_write8[addr >>> MMAP_BLOCK_BITS](addr, value)
  }

  mmap_read16(addr) {
    let fn = this.memory_map_read8[addr >>> MMAP_BLOCK_BITS]

    return fn(addr) | (fn((addr + 1) | 0) << 8)
  }

  mmap_write16(addr, value) {
    let fn = this.memory_map_write8[addr >>> MMAP_BLOCK_BITS]

    dbg_assert(value >= 0 && value <= 0xffff)
    fn(addr, value & 0xff)
    fn((addr + 1) | 0, value >> 8)
  }

  mmap_read32(addr) {
    let aligned_addr = addr >>> MMAP_BLOCK_BITS

    return this.memory_map_read32[aligned_addr](addr)
  }

  mmap_write32(addr, value) {
    let aligned_addr = addr >>> MMAP_BLOCK_BITS

    this.memory_map_write32[aligned_addr](addr, value)
  }

  mmap_write64(addr, value0, value1) {
    let aligned_addr = addr >>> MMAP_BLOCK_BITS
    // This should hold since writes across pages are split up
    dbg_assert(aligned_addr === (addr + 7) >>> MMAP_BLOCK_BITS)

    let write_func32 = this.memory_map_write32[aligned_addr]
    write_func32(addr, value0)
    write_func32(addr + 4, value1)
  }

  mmap_write128(addr, value0, value1, value2, value3) {
    let aligned_addr = addr >>> MMAP_BLOCK_BITS
    // This should hold since writes across pages are split up
    dbg_assert(aligned_addr === (addr + 12) >>> MMAP_BLOCK_BITS)

    let write_func32 = this.memory_map_write32[aligned_addr]
    write_func32(addr, value0)
    write_func32(addr + 4, value1)
    write_func32(addr + 8, value2)
    write_func32(addr + 12, value3)
  }

  /**
   * @param {Array.<number>|Uint8Array} blob
   * @param {number} offset
   */
  write_blob(blob, offset) {
    dbg_assert(blob && blob.length >= 0)

    if (blob.length) {
      dbg_assert(!this.in_mapped_range(offset))
      dbg_assert(!this.in_mapped_range(offset + blob.length - 1))

      this.jit_dirty_cache(offset, offset + blob.length)
      this.mem8.set(blob, offset)
    }
  }

  read_blob(offset, length) {
    if (length) {
      dbg_assert(!this.in_mapped_range(offset))
      dbg_assert(!this.in_mapped_range(offset + length - 1))
    }
    return this.mem8.subarray(offset, offset + length)
  }

  /////////////////////////////////////////////////////////////////////////////
  // DEBUG
  debug_init() {
    let cpu = this
    let debug = {}
    this.debug = debug

    /**
     * wheter or not in step mode
     * used for debugging
     * @type {boolean}
     */
    debug.step_mode = false
    debug.ops = undefined
    debug.all_ops = []

    debug.trace_all = false

    // "log" some information visually to the user.
    // Also in non-DEBUG modes
    debug.show = function (x) {
      if (typeof document !== 'undefined') {
        let el = document.getElementById('log')

        if (el) {
          el.textContent += x + '\n'
          el.style.display = 'block'
          el.scrollTop = 1e9
          return
        }
      }

      console.log(x)
    }

    debug.init = function () {
      if (!DEBUG) return

      // used for debugging
      debug.ops = new CircularQueue(200000)
      let seabios_debug

      if (cpu.io) {
        // write seabios debug output to console
        seabios_debug = ''

        cpu.io.register_write(0x402, this, handle) // seabios
        cpu.io.register_write(0x500, this, handle) // vgabios
      }

      function handle(out_byte) {
        if (out_byte === 10) {
          dbg_log(seabios_debug, LOG_BIOS)
          seabios_debug = ''
        } else {
          seabios_debug += String.fromCharCode(out_byte)
        }
      }
    }

    debug.get_regs_short = get_regs_short
    debug.dump_regs = dump_regs_short
    debug.dump_instructions = dump_instructions
    debug.get_instructions = get_instructions
    debug.get_state = get_state
    debug.dump_state = dump_state
    debug.dump_stack = dump_stack

    debug.dump_page_directory = dump_page_directory
    debug.dump_gdt_ldt = dump_gdt_ldt
    debug.dump_idt = dump_idt

    debug.get_memory_dump = get_memory_dump
    debug.memory_hex_dump = memory_hex_dump
    debug.used_memory_dump = used_memory_dump

    debug.step = step
    debug.run_until = run_until

    function step() {
      if (!DEBUG) return

      if (!cpu.running) {
        cpu.cycle()
      }

      dump_regs_short()
      //   let now = Date.now()

      cpu.running = false
      dump_instructions()
    }

    function run_until() {
      if (!DEBUG) return

      cpu.running = false
      let a = parseInt(prompt('input hex', ''), 16)
      if (a) while (cpu.instruction_pointer[0] != a) step()
    }

    // http://ref.x86asm.net/x86reference.xml
    // for debugging purposes
    let opcode_map = [
      'ADD',
      'ADD',
      'ADD',
      'ADD',
      'ADD',
      'ADD',
      'PUSH',
      'POP',
      'OR',
      'OR',
      'OR',
      'OR',
      'OR',
      'OR',
      'PUSH',
      '0F:',
      'ADC',
      'ADC',
      'ADC',
      'ADC',
      'ADC',
      'ADC',
      'PUSH',
      'POP',
      'SBB',
      'SBB',
      'SBB',
      'SBB',
      'SBB',
      'SBB',
      'PUSH',
      'POP',
      'AND',
      'AND',
      'AND',
      'AND',
      'AND',
      'AND',
      'ES',
      'DAA',
      'SUB',
      'SUB',
      'SUB',
      'SUB',
      'SUB',
      'SUB',
      'CS',
      'DAS',
      'XOR',
      'XOR',
      'XOR',
      'XOR',
      'XOR',
      'XOR',
      'SS',
      'AAA',
      'CMP',
      'CMP',
      'CMP',
      'CMP',
      'CMP',
      'CMP',
      'DS',
      'AAS',
      'INC',
      'INC',
      'INC',
      'INC',
      'INC',
      'INC',
      'INC',
      'INC',
      'DEC',
      'DEC',
      'DEC',
      'DEC',
      'DEC',
      'DEC',
      'DEC',
      'DEC',
      'PUSH',
      'PUSH',
      'PUSH',
      'PUSH',
      'PUSH',
      'PUSH',
      'PUSH',
      'PUSH',
      'POP',
      'POP',
      'POP',
      'POP',
      'POP',
      'POP',
      'POP',
      'POP',
      'PUSHA',
      'POPA',
      'BOUND',
      'ARPL',
      'FS',
      'GS',
      'none',
      'none',
      'PUSH',
      'IMUL',
      'PUSH',
      'IMUL',
      'INS',
      'INS',
      'OUTS',
      'OUTS',
      'JO',
      'JNO',
      'JB',
      'JNB',
      'JZ',
      'JNZ',
      'JBE',
      'JNBE',
      'JS',
      'JNS',
      'JP',
      'JNP',
      'JL',
      'JNL',
      'JLE',
      'JNLE',
      'ADD',
      'ADD',
      'ADD',
      'ADD',
      'TEST',
      'TEST',
      'XCHG',
      'XCHG',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'LEA',
      'MOV',
      'POP',
      'NOP',
      'XCHG',
      'XCHG',
      'XCHG',
      'XCHG',
      'XCHG',
      'XCHG',
      'XCHG',
      'CBW',
      'CWD',
      'CALLF',
      'FWAIT',
      'PUSHF',
      'POPF',
      'SAHF',
      'LAHF',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOVS',
      'MOVS',
      'CMPS',
      'CMPS',
      'TEST',
      'TEST',
      'STOS',
      'STOS',
      'LODS',
      'LODS',
      'SCAS',
      'SCAS',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'MOV',
      'ROL',
      'ROL',
      'RETN',
      'RETN',
      'LES',
      'LDS',
      'MOV',
      'MOV',
      'ENTER',
      'LEAVE',
      'RETF',
      'RETF',
      'INT',
      'INT',
      'INTO',
      'IRET',
      'ROL',
      'ROL',
      'ROL',
      'ROL',
      'AAM',
      'AAD',
      'none',
      'XLAT',
      'FADD',
      'FLD',
      'FIADD',
      'FILD',
      'FADD',
      'FLD',
      'FIADD',
      'FILD',
      'LOOPNZ',
      'LOOPZ',
      'LOOP',
      'JCXZ',
      'IN',
      'IN',
      'OUT',
      'OUT',
      'CALL',
      'JMP',
      'JMPF',
      'JMP',
      'IN',
      'IN',
      'OUT',
      'OUT',
      'LOCK',
      'none',
      'REPNZ',
      'REPZ',
      'HLT',
      'CMC',
      'TEST',
      'TEST',
      'CLC',
      'STC',
      'CLI',
      'STI',
      'CLD',
      'STD',
      'INC',
      'INC',
    ]

    debug.logop = function (_ip, op) {
      if (!DEBUG || !debug.step_mode) {
        return
      }

      _ip = _ip >>> 0

      if (debug.trace_all && debug.all_ops) {
        debug.all_ops.push(_ip, op)
      } else if (debug.ops) {
        debug.ops.add(_ip)
        debug.ops.add(op)
      }
    }

    function dump_stack(start, end) {
      if (!DEBUG) return

      let esp = cpu.reg32[REG_ESP]
      dbg_log('========= STACK ==========')

      if (end >= start || end === undefined) {
        start = 5
        end = -5
      }

      for (let i = start; i > end; i--) {
        let line = '    '

        if (!i) line = '=>  '

        line += h(i, 2) + ' | '

        dbg_log(
          line + h(esp + 4 * i, 8) + ' | ' + h(cpu.read32s(esp + 4 * i) >>> 0)
        )
      }
    }

    function get_state(where) {
      if (!DEBUG) return

      let mode = cpu.protected_mode[0] ? 'prot' : 'real'
      // eslint-disable-next-line no-unused-vars
      let vm = cpu.flags[0] & FLAG_VM ? 1 : 0
      let flags = cpu.get_eflags()
      let iopl = cpu.getiopl()
      let cpl = cpu.cpl[0]
      let cs_eip = h(cpu.sreg[REG_CS], 4) + ':' + h(cpu.get_real_eip() >>> 0, 8)
      let ss_esp = h(cpu.sreg[REG_SS], 4) + ':' + h(cpu.reg32[REG_ES] >>> 0, 8)
      let op_size = cpu.is_32[0] ? '32' : '16'
      let if_ = cpu.flags[0] & FLAG_INTERRUPT ? 1 : 0

      let flag_names = {
        [FLAG_CARRY]: 'c',
        [FLAG_PARITY]: 'p',
        [FLAG_ADJUST]: 'a',
        [FLAG_ZERO]: 'z',
        [FLAG_SIGN]: 's',
        [FLAG_TRAP]: 't',
        [FLAG_INTERRUPT]: 'i',
        [FLAG_DIRECTION]: 'd',
        [FLAG_OVERFLOW]: 'o',
      }
      let flag_string = ''

      for (let i = 0; i < 16; i++) {
        if (flag_names[1 << i]) {
          if (flags & (1 << i)) {
            flag_string += flag_names[1 << i]
          } else {
            flag_string += ' '
          }
        }
      }

      return (
        'mode=' +
        mode +
        '/' +
        op_size +
        ' paging=' +
        +((cpu.cr[0] & CR0_PG) !== 0) +
        ' iopl=' +
        iopl +
        ' cpl=' +
        cpl +
        ' if=' +
        if_ +
        ' cs:eip=' +
        cs_eip +
        ' cs_off=' +
        h(cpu.get_seg_cs() >>> 0, 8) +
        ' flgs=' +
        h(cpu.get_eflags() >>> 0, 6) +
        ' (' +
        flag_string +
        ')' +
        ' ss:esp=' +
        ss_esp +
        ' ssize=' +
        +cpu.stack_size_32[0] +
        (where ? ' in ' + where : '')
      )
    }

    function dump_state(where) {
      if (!DEBUG) return

      dbg_log(get_state(where), LOG_CPU)
    }

    function get_regs_short() {
      let r32 = {
          eax: REG_EAX,
          ecx: REG_ECX,
          edx: REG_EDX,
          ebx: REG_EBX,
          esp: REG_ESP,
          ebp: REG_EBP,
          esi: REG_ESI,
          edi: REG_EDI,
        },
        r32_names = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'],
        // eslint-disable-next-line no-unused-vars
        s = {
          cs: REG_CS,
          ds: REG_DS,
          es: REG_ES,
          fs: REG_FS,
          gs: REG_GS,
          ss: REG_SS,
        },
        line1 = '',
        line2 = ''

      for (let i = 0; i < 4; i++) {
        line1 +=
          r32_names[i] + '=' + h(cpu.reg32[r32[r32_names[i]]] >>> 0, 8) + ' '
        line2 +=
          r32_names[i + 4] +
          '=' +
          h(cpu.reg32[r32[r32_names[i + 4]]] >>> 0, 8) +
          ' '
      }

      //line1 += " eip=" + h(cpu.get_real_eip() >>> 0, 8);
      //line2 += " flg=" + h(cpu.get_eflags(), 8);

      line1 +=
        '  ds=' +
        h(cpu.sreg[REG_DS], 4) +
        ' es=' +
        h(cpu.sreg[REG_ES], 4) +
        ' fs=' +
        h(cpu.sreg[REG_FS], 4)
      line2 +=
        '  gs=' +
        h(cpu.sreg[REG_GS], 4) +
        ' cs=' +
        h(cpu.sreg[REG_CS], 4) +
        ' ss=' +
        h(cpu.sreg[REG_SS], 4)

      return [line1, line2]
    }

    function dump_regs_short() {
      if (!DEBUG) return

      let lines = get_regs_short()

      dbg_log(lines[0], LOG_CPU)
      dbg_log(lines[1], LOG_CPU)
    }

    function get_instructions() {
      if (!DEBUG) return

      debug.step_mode = true

      function add(ip, op) {
        out +=
          h(ip, 8) +
          ':        ' +
          pads(opcode_map[op] || 'unkown', 20) +
          h(op, 2) +
          '\n'
      }

      let opcodes
      let out = ''

      if (debug.trace_all && debug.all_ops) {
        opcodes = debug.all_ops
      } else if (debug.ops) {
        opcodes = debug.ops.toArray()
      }

      if (!opcodes) {
        return ''
      }

      for (let i = 0; i < opcodes.length; i += 2) {
        add(opcodes[i], opcodes[i + 1])
      }

      debug.ops.clear()
      debug.all_ops = []

      return out
    }

    function dump_instructions() {
      if (!DEBUG) return

      debug.show(get_instructions())
    }

    function dump_gdt_ldt() {
      if (!DEBUG) return

      dbg_log('gdt: (len = ' + h(cpu.gdtr_size[0]) + ')')
      dump_table(
        cpu.translate_address_system_read(cpu.gdtr_offset[0]),
        cpu.gdtr_size[0]
      )

      dbg_log('\nldt: (len = ' + h(cpu.segment_limits[REG_LDTR]) + ')')
      dump_table(
        cpu.translate_address_system_read(cpu.segment_offsets[REG_LDTR]),
        cpu.segment_limits[REG_LDTR]
      )

      function dump_table(addr, size) {
        for (let i = 0; i < size; i += 8, addr += 8) {
          let base =
              cpu.read16(addr + 2) |
              (cpu.read8(addr + 4) << 16) |
              (cpu.read8(addr + 7) << 24),
            limit = cpu.read16(addr) | ((cpu.read8(addr + 6) & 0xf) << 16),
            access = cpu.read8(addr + 5),
            flags = cpu.read8(addr + 6) >> 4,
            flags_str = '',
            dpl = (access >> 5) & 3

          if (!(access & 128)) {
            // present bit not set
            //continue;
            flags_str += 'NP '
          } else {
            flags_str += ' P '
          }

          if (access & 16) {
            if (flags & 4) {
              flags_str += '32b '
            } else {
              flags_str += '16b '
            }

            if (access & 8) {
              // executable
              flags_str += 'X '

              if (access & 4) {
                flags_str += 'C '
              }
            } else {
              // data
              flags_str += 'R '
            }

            flags_str += 'RW '
          } else {
            // system
            flags_str += 'sys: ' + h(access & 15)
          }

          if (flags & 8) {
            limit = (limit << 12) | 0xfff
          }

          dbg_log(
            h(i & ~7, 4) +
              ' ' +
              h(base >>> 0, 8) +
              ' (' +
              h(limit >>> 0, 8) +
              ' bytes) ' +
              flags_str +
              ';  dpl = ' +
              dpl +
              ', a = ' +
              access.toString(2) +
              ', f = ' +
              flags.toString(2)
          )
        }
      }
    }

    function dump_idt() {
      if (!DEBUG) return

      for (let i = 0; i < cpu.idtr_size[0]; i += 8) {
        let addr = cpu.translate_address_system_read(cpu.idtr_offset[0] + i),
          base = cpu.read16(addr) | (cpu.read16(addr + 6) << 16),
          selector = cpu.read16(addr + 2),
          type = cpu.read8(addr + 5),
          line,
          dpl = (type >> 5) & 3

        if ((type & 31) === 5) {
          line = 'task gate '
        } else if ((type & 31) === 14) {
          line = 'intr gate '
        } else if ((type & 31) === 15) {
          line = 'trap gate '
        } else {
          line = 'invalid   '
        }

        if (type & 128) {
          line += ' P'
        } else {
          // present bit not set
          //continue;
          line += 'NP'
        }

        dbg_log(
          h(i >> 3, 4) +
            ' ' +
            h(base >>> 0, 8) +
            ', ' +
            h(selector, 4) +
            '; ' +
            line +
            ';  dpl = ' +
            dpl +
            ', t = ' +
            type.toString(2)
        )
      }
    }

    function load_page_entry(dword_entry, is_directory) {
      if (!DEBUG) return

      if (!(dword_entry & 1)) {
        // present bit not set
        return false
      }

      let size = (dword_entry & 128) === 128,
        address

      if (size && !is_directory) {
        address = dword_entry & 0xffc00000
      } else {
        address = dword_entry & 0xfffff000
      }

      return {
        size: size,
        global: (dword_entry & 256) === 256,
        accessed: (dword_entry & 0x20) === 0x20,
        dirty: (dword_entry & 0x40) === 0x40,
        cache_disable: (dword_entry & 16) === 16,
        user: (dword_entry & 4) === 4,
        read_write: (dword_entry & 2) === 2,
        address: address >>> 0,
      }
    }

    function dump_page_directory() {
      if (!DEBUG) return

      for (let i = 0; i < 1024; i++) {
        let addr = cpu.cr[3] + 4 * i
        let dword = cpu.read32s(addr),
          entry = load_page_entry(dword, true)

        if (!entry) {
          dbg_log('Not present: ' + h((i << 22) >>> 0, 8))
          continue
        }

        let flags = ''

        flags += entry.size ? 'S ' : '  '
        flags += entry.accessed ? 'A ' : '  '
        flags += entry.cache_disable ? 'Cd ' : '  '
        flags += entry.user ? 'U ' : '  '
        flags += entry.read_write ? 'Rw ' : '   '

        if (entry.size) {
          dbg_log(
            '=== ' +
              h((i << 22) >>> 0, 8) +
              ' -> ' +
              h(entry.address >>> 0, 8) +
              ' | ' +
              flags
          )
          continue
        } else {
          dbg_log('=== ' + h((i << 22) >>> 0, 8) + ' | ' + flags)
        }

        for (let j = 0; j < 1024; j++) {
          let sub_addr = entry.address + 4 * j
          dword = cpu.read32s(sub_addr)

          let subentry = load_page_entry(dword, false)

          if (subentry) {
            flags = ''

            flags += subentry.cache_disable ? 'Cd ' : '   '
            flags += subentry.user ? 'U ' : '  '
            flags += subentry.read_write ? 'Rw ' : '   '
            flags += subentry.global ? 'G ' : '  '
            flags += subentry.accessed ? 'A ' : '  '
            flags += subentry.dirty ? 'Di ' : '   '

            dbg_log(
              '# ' +
                h(((i << 22) | (j << 12)) >>> 0, 8) +
                ' -> ' +
                h(subentry.address, 8) +
                ' | ' +
                flags +
                '        (at ' +
                h(sub_addr, 8) +
                ')'
            )
          }
        }
      }
    }

    function get_memory_dump(start, count) {
      if (!DEBUG) return

      if (start === undefined) {
        start = 0
        count = cpu.memory_size[0]
      } else if (count === undefined) {
        count = start
        start = 0
      }

      return cpu.mem8.slice(start, start + count).buffer
    }

    function memory_hex_dump(addr, length) {
      if (!DEBUG) return

      length = length || 4 * 0x10
      let line, byt

      for (let i = 0; i < length >> 4; i++) {
        line = h(addr + (i << 4), 5) + '   '

        for (let j = 0; j < 0x10; j++) {
          byt = cpu.read8(addr + (i << 4) + j)
          line += h(byt, 2) + ' '
        }

        line += '  '

        for (let j = 0; j < 0x10; j++) {
          byt = cpu.read8(addr + (i << 4) + j)
          line += byt < 33 || byt > 126 ? '.' : String.fromCharCode(byt)
        }

        dbg_log(line)
      }
    }

    function used_memory_dump() {
      if (!DEBUG) return

      let width = 0x80,
        height = 0x10,
        block_size = (cpu.memory_size[0] / width / height) | 0,
        row

      for (let i = 0; i < height; i++) {
        row = h(i * width * block_size, 8) + ' | '

        for (let j = 0; j < width; j++) {
          let used = cpu.mem32s[(i * width + j) * block_size] > 0

          row += used ? 'X' : ' '
        }

        dbg_log(row)
      }
    }

    // eslint-disable-next-line no-unused-vars
    debug.debug_interrupt = function (interrupt_nr) {
      //if(interrupt_nr === 0x20)
      //{
      //    //let vxd_device = cpu.safe_read16(cpu.instruction_pointer + 2);
      //    //let vxd_sub = cpu.safe_read16(cpu.instruction_pointer + 0);
      //    //let service = "";
      //    //if(vxd_device === 1)
      //    //{
      //    //    service = vxd_table1[vxd_sub];
      //    //}
      //    //dbg_log("vxd: " + h(vxd_device, 4) + " " + h(vxd_sub, 4) + " " + service);
      //}
      //if(interrupt_nr >= 0x21 && interrupt_nr < 0x30)
      //{
      //    dbg_log("dos: " + h(interrupt_nr, 2) + " ah=" + h(this.reg8[reg_ah], 2) + " ax=" + h(this.reg16[reg_ax], 4));
      //}
      //if(interrupt_nr === 0x13 && (this.reg8[reg_ah] | 1) === 0x43)
      //{
      //    this.debug.memory_hex_dump(this.get_seg(reg_ds) + this.reg16[reg_si], 0x18);
      //}
      //if(interrupt_nr == 0x10)
      //{
      //    dbg_log("int10 ax=" + h(this.reg16[reg_ax], 4) + " '" + String.fromCharCode(this.reg8[reg_al]) + "'");
      //    this.debug.dump_regs_short();
      //    if(this.reg8[reg_ah] == 0xe) vga.tt_write(this.reg8[reg_al]);
      //}
      //if(interrupt_nr === 0x13)
      //{
      //    this.debug.dump_regs_short();
      //}
      //if(interrupt_nr === 6)
      //{
      //    this.instruction_pointer += 2;
      //    dbg_log("BUG()", LOG_CPU);
      //    dbg_log("line=" + this.read_imm16() + " " +
      //            "file=" + this.read_string(this.translate_address_read(this.read_imm32s())), LOG_CPU);
      //    this.instruction_pointer -= 8;
      //    this.debug.dump_regs_short();
      //}
      //if(interrupt_nr === 0x80)
      //{
      //    dbg_log("linux syscall");
      //    this.debug.dump_regs_short();
      //}
      //if(interrupt_nr === 0x40)
      //{
      //    dbg_log("kolibri syscall");
      //    this.debug.dump_regs_short();
      //}
    }

    let cs
    let capstone_decoder

    debug.dump_code = function (is_32, buffer, start) {
      if (!capstone_decoder) {
        if (cs === undefined) {
          if (typeof require === 'function') {
            cs = require('./capstone-x86.min.js')
          } else {
            cs = window.cs
          }

          if (cs === undefined) {
            dbg_log(
              'Warning: Missing capstone library, disassembly not available'
            )
            return
          }
        }

        capstone_decoder = [
          new cs.Capstone(cs.ARCH_X86, cs.MODE_16),
          new cs.Capstone(cs.ARCH_X86, cs.MODE_32),
        ]
      }

      try {
        const instructions = capstone_decoder[is_32].disasm(buffer, start)

        instructions.forEach(function (instr) {
          dbg_log(
            h(instr.address >>> 0) +
              ': ' +
              pads(instr.bytes.map((x) => h(x, 2).slice(-2)).join(' '), 20) +
              ' ' +
              instr.mnemonic +
              ' ' +
              instr.op_str
          )
        })
        dbg_log('')
      } catch (e) {
        dbg_log(
          'Could not disassemble: ' +
            Array.from(buffer)
              .map((x) => h(x, 2))
              .join(' ')
        )
      }
    }

    function dump_file(ab, name) {
      let blob = new Blob([ab])

      let a = document.createElement('a')
      a['download'] = name
      a.href = window.URL.createObjectURL(blob)
      a.dataset['downloadurl'] = [
        'application/octet-stream',
        a['download'],
        a.href,
      ].join(':')

      a.click()
      window.URL.revokeObjectURL(a.src)
    }

    let wabt

    debug.dump_wasm = function (buffer) {
      if (wabt === undefined) {
        if (typeof require === 'function') {
          wabt = require('./libwabt.js')
        } else {
          wabt = new window.WabtModule()
        }

        if (wabt === undefined) {
          dbg_log('Warning: Missing libwabt, wasm dump not available')
          return
        }
      }

      // Need to make a small copy otherwise libwabt goes nuts trying to copy
      // the whole underlying buffer
      buffer = buffer.slice()

      try {
        let module = wabt.readWasm(buffer, { readDebugNames: false })
        module.generateNames()
        module.applyNames()
        const result = module.toText({ foldExprs: true, inlineExport: true })
        dbg_log(result)
      } catch (e) {
        dump_file(buffer, 'failed.wasm')
        console.log(e.toString())
      } finally {
        if (module) {
          module.destroy()
        }
      }
    }
  }
}
