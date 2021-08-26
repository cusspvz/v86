// http://download.intel.com/design/chipsets/datashts/29056601.pdf

import { APIC_LOG_VERBOSE, DELIVERY_MODES, DESTINATION_MODES } from './apic'
import { LOG_APIC, MMAP_BLOCK_SIZE } from './const'
import { dbg_assert, dbg_log } from './log'
import { h } from './utils/h'

/** @const */
export const IOAPIC_ADDRESS = 0xfec00000

/** @const */
export const IOREGSEL = 0

/** @const */
export const IOWIN = 0x10

/** @const */
export const IOAPIC_IRQ_COUNT = 24

/** @const */
export const IOAPIC_ID = 0 // must match value in seabios

/** @const */
export const IOAPIC_CONFIG_TRIGGER_MODE_LEVEL = 1 << 15

/** @const */
export const IOAPIC_CONFIG_MASKED = 1 << 16

/** @const */
export const IOAPIC_CONFIG_DELIVS = 1 << 12

/** @const */
export const IOAPIC_CONFIG_REMOTE_IRR = 1 << 14

/** @const */
export const IOAPIC_CONFIG_READONLY_MASK =
  IOAPIC_CONFIG_REMOTE_IRR | IOAPIC_CONFIG_DELIVS | 0xfffe0000

/** @const */
export const IOAPIC_DELIVERY_FIXED = 0

/** @const */
export const IOAPIC_DELIVERY_LOWEST_PRIORITY = 1

/** @const */
export const IOAPIC_DELIVERY_NMI = 4

/** @const */
export const IOAPIC_DELIVERY_INIT = 5

/**
 * @constructor
 * @param {CPU} cpu
 */
export class IOAPIC {
  constructor(cpu) {
    /** @type {CPU} */
    this.cpu = cpu

    this.ioredtbl_config = new Int32Array(IOAPIC_IRQ_COUNT)
    this.ioredtbl_destination = new Int32Array(IOAPIC_IRQ_COUNT)

    for (let i = 0; i < this.ioredtbl_config.length; i++) {
      // disable interrupts
      this.ioredtbl_config[i] = IOAPIC_CONFIG_MASKED
    }

    // IOAPIC register selection
    this.ioregsel = 0

    this.ioapic_id = IOAPIC_ID

    this.irr = 0
    this.irq_value = 0

    dbg_assert(MMAP_BLOCK_SIZE >= 0x20)
    cpu.io.mmap_register(
      IOAPIC_ADDRESS,
      MMAP_BLOCK_SIZE,
      (addr) => {
        addr = (addr - IOAPIC_ADDRESS) | 0

        if (addr >= IOWIN && addr < IOWIN + 4) {
          const byte = addr - IOWIN
          dbg_log(
            'ioapic read8 byte ' + byte + ' ' + h(this.ioregsel),
            LOG_APIC
          )
          return (this.read(this.ioregsel) >> (8 * byte)) & 0xff
        } else {
          dbg_log('Unexpected IOAPIC register read: ' + h(addr >>> 0), LOG_APIC)
          dbg_assert(false)
          return 0
        }
      },
      // eslint-disable-next-line no-unused-vars
      (addr, _value) => {
        dbg_assert(false, 'unsupported write8 from ioapic: ' + h(addr >>> 0))
      },
      (addr) => {
        addr = (addr - IOAPIC_ADDRESS) | 0

        if (addr === IOREGSEL) {
          return this.ioregsel
        } else if (addr === IOWIN) {
          return this.read(this.ioregsel)
        } else {
          dbg_log('Unexpected IOAPIC register read: ' + h(addr >>> 0), LOG_APIC)
          dbg_assert(false)
          return 0
        }
      },
      (addr, value) => {
        addr = (addr - IOAPIC_ADDRESS) | 0

        if (addr === IOREGSEL) {
          this.ioregsel = value
        } else if (addr === IOWIN) {
          this.write(this.ioregsel, value)
        } else {
          dbg_log(
            'Unexpected IOAPIC register write: ' +
              h(addr >>> 0) +
              ' <- ' +
              h(value >>> 0, 8),
            LOG_APIC
          )
          dbg_assert(false)
        }
      }
    )
  }

  remote_eoi(vector) {
    for (let i = 0; i < IOAPIC_IRQ_COUNT; i++) {
      let config = this.ioredtbl_config[i]

      if ((config & 0xff) === vector && config & IOAPIC_CONFIG_REMOTE_IRR) {
        dbg_log('Clear remote IRR for irq=' + h(i), LOG_APIC)
        this.ioredtbl_config[i] &= ~IOAPIC_CONFIG_REMOTE_IRR
        this.check_irq(i)
      }
    }
  }

  check_irq(irq) {
    let mask = 1 << irq

    if ((this.irr & mask) === 0) {
      return
    }

    let config = this.ioredtbl_config[irq]

    if ((config & IOAPIC_CONFIG_MASKED) === 0) {
      let delivery_mode = (config >> 8) & 7
      let destination_mode = (config >> 11) & 1
      let vector = config & 0xff
      let destination = this.ioredtbl_destination[irq] >>> 24
      let is_level =
        (config & IOAPIC_CONFIG_TRIGGER_MODE_LEVEL) ===
        IOAPIC_CONFIG_TRIGGER_MODE_LEVEL

      if ((config & IOAPIC_CONFIG_TRIGGER_MODE_LEVEL) === 0) {
        this.irr &= ~mask
      } else {
        this.ioredtbl_config[irq] |= IOAPIC_CONFIG_REMOTE_IRR

        if (config & IOAPIC_CONFIG_REMOTE_IRR) {
          dbg_log(
            'No route: level interrupt and remote IRR still set',
            LOG_APIC
          )
          return
        }
      }

      if (
        delivery_mode === IOAPIC_DELIVERY_FIXED ||
        delivery_mode === IOAPIC_DELIVERY_LOWEST_PRIORITY
      ) {
        this.cpu.devices.apic.route(
          vector,
          delivery_mode,
          is_level,
          destination,
          destination_mode
        )
      } else {
        dbg_assert(false, 'TODO')
      }

      this.ioredtbl_config[irq] &= ~IOAPIC_CONFIG_DELIVS
    }
  }

  set_irq(i) {
    if (i >= IOAPIC_IRQ_COUNT) {
      dbg_assert(false, 'Bad irq: ' + i, LOG_APIC)
      return
    }

    let mask = 1 << i

    if ((this.irq_value & mask) === 0) {
      if (APIC_LOG_VERBOSE) dbg_log('apic set irq ' + i, LOG_APIC)

      this.irq_value |= mask

      let config = this.ioredtbl_config[i]
      if (
        (config & (IOAPIC_CONFIG_TRIGGER_MODE_LEVEL | IOAPIC_CONFIG_MASKED)) ===
        IOAPIC_CONFIG_MASKED
      ) {
        // edge triggered and masked
        return
      }

      this.irr |= mask

      this.check_irq(i)
    }
  }

  clear_irq(i) {
    if (i >= IOAPIC_IRQ_COUNT) {
      dbg_assert(false, 'Bad irq: ' + i, LOG_APIC)
      return
    }

    let mask = 1 << i

    if ((this.irq_value & mask) === mask) {
      this.irq_value &= ~mask

      let config = this.ioredtbl_config[i]
      if (config & IOAPIC_CONFIG_TRIGGER_MODE_LEVEL) {
        this.irr &= ~mask
      }
    }
  }

  read(reg) {
    if (reg === 0) {
      dbg_log('IOAPIC Read id', LOG_APIC)
      return this.ioapic_id << 24
    } else if (reg === 1) {
      dbg_log('IOAPIC Read version', LOG_APIC)
      return 0x11 | ((IOAPIC_IRQ_COUNT - 1) << 16)
    } else if (reg === 2) {
      dbg_log('IOAPIC Read arbitration id', LOG_APIC)
      return this.ioapic_id << 24
    } else if (reg >= 0x10 && reg < 0x10 + 2 * IOAPIC_IRQ_COUNT) {
      let irq = (reg - 0x10) >> 1
      let index = reg & 1

      let value
      if (index) {
        value = this.ioredtbl_destination[irq]
        dbg_log(
          'IOAPIC Read destination irq=' + h(irq) + ' -> ' + h(value, 8),
          LOG_APIC
        )
      } else {
        value = this.ioredtbl_config[irq]
        dbg_log(
          'IOAPIC Read config irq=' + h(irq) + ' -> ' + h(value, 8),
          LOG_APIC
        )
      }
      return value
    } else {
      dbg_log('IOAPIC register read outside of range ' + h(reg), LOG_APIC)
      dbg_assert(false)
      return 0
    }
  }

  write(reg, value) {
    //dbg_log("IOAPIC write " + h(reg) + " <- " + h(value, 8), LOG_APIC);

    if (reg === 0) {
      this.ioapic_id = (value >>> 24) & 0x0f
    } else if (reg === 1 || reg === 2) {
      dbg_log('Invalid write: ' + reg, LOG_APIC)
    } else if (reg >= 0x10 && reg < 0x10 + 2 * IOAPIC_IRQ_COUNT) {
      let irq = (reg - 0x10) >> 1
      let index = reg & 1

      if (index) {
        this.ioredtbl_destination[irq] = value & 0xff000000
        dbg_log(
          'Write destination ' +
            h(value >>> 0, 8) +
            ' irq=' +
            h(irq) +
            ' dest=' +
            h(value >>> 24, 2),
          LOG_APIC
        )
      } else {
        let old_value = this.ioredtbl_config[irq]
        this.ioredtbl_config[irq] =
          (value & ~IOAPIC_CONFIG_READONLY_MASK) |
          (old_value & IOAPIC_CONFIG_READONLY_MASK)

        let vector = value & 0xff
        let delivery_mode = (value >> 8) & 7
        let destination_mode = (value >> 11) & 1
        let is_level = (value >> 15) & 1
        let disabled = (value >> 16) & 1

        dbg_log(
          'Write config ' +
            h(value >>> 0, 8) +
            ' irq=' +
            h(irq) +
            ' vector=' +
            h(vector, 2) +
            ' deliverymode=' +
            DELIVERY_MODES[delivery_mode] +
            ' destmode=' +
            DESTINATION_MODES[destination_mode] +
            ' is_level=' +
            is_level +
            ' disabled=' +
            disabled,
          LOG_APIC
        )

        this.check_irq(irq)
      }
    } else {
      dbg_log(
        'IOAPIC register write outside of range ' +
          h(reg) +
          ': ' +
          h(value >>> 0, 8),
        LOG_APIC
      )
      dbg_assert(false)
    }
  }

  get_state() {
    let state = []
    state[0] = this.ioredtbl_config
    state[1] = this.ioredtbl_destination
    state[2] = this.ioregsel
    state[3] = this.ioapic_id
    state[4] = this.irr
    state[5] = this.irq_value
    return state
  }

  set_state(state) {
    this.ioredtbl_config = state[0]
    this.ioredtbl_destination = state[1]
    this.ioregsel = state[2]
    this.ioapic_id = state[3]
    this.irr = state[4]
    this.irq_value = state[5]
  }
}
