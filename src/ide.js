import { DEBUG } from './config'
import { LOG_DISK } from './const'
import {
  CMOS_BIOS_DISKTRANSFLAG,
  CMOS_DISK_DATA,
  CMOS_DISK_DRIVE1_CYL,
} from './rtc'
import { dbg_assert, dbg_log } from './log'
import { h } from './utils/h'

/** @const */
export const CDROM_SECTOR_SIZE = 2048
/** @const */
export const HD_SECTOR_SIZE = 512

/**
 * @constructor
 * @param {CPU} cpu
 * @param {boolean} is_cd
 * @param {number} nr
 * @param {BusConnector} bus
 * */
export class IDEDevice {
  constructor(cpu, master_buffer, slave_buffer, is_cd, nr, bus) {
    this.master = new IDEInterface(this, cpu, master_buffer, is_cd, nr, 0, bus)
    this.slave = new IDEInterface(this, cpu, slave_buffer, false, nr, 1, bus)

    this.current_interface = this.master

    this.cpu = cpu

    // gets set via PCI in seabios, likely doesn't matter
    if (nr === 0) {
      this.ata_port = 0x1f0
      this.irq = 14

      this.pci_id = 0x1e << 3
    } else if (nr === 1) {
      this.ata_port = 0x170
      this.irq = 15

      this.pci_id = 0x1f << 3
    } else {
      dbg_assert(false, 'IDE device with nr ' + nr + ' ignored', LOG_DISK)
    }

    // alternate status, starting at 3f4/374
    /** @type {number} */
    this.ata_port_high = this.ata_port | 0x204

    /** @type {number} */
    this.master_port = 0xb400

    this.pci_space = [
      0x86,
      0x80,
      0x10,
      0x70,
      0x05,
      0x00,
      0xa0,
      0x02,
      0x00,
      0x80,
      0x01,
      0x01,
      0x00,
      0x00,
      0x00,
      0x00,
      0 | 1,
      0,
      0x00,
      0x00,
      0 | 1,
      0,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // second device
      0x00,
      0x00,
      0x00,
      0x00, // second device
      (this.master_port & 0xff) | 1,
      this.master_port >> 8,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x43,
      0x10,
      0xd4,
      0x82,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      this.irq,
      0x01,
      0x00,
      0x00,

      // 0x40
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      // 0x80
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]
    this.pci_bars = [
      {
        size: 8,
      },
      {
        size: 4,
      },
      undefined,
      undefined,
      {
        size: 0x10,
      },
    ]
    this.name = 'ide' + nr

    /** @type {number} */
    this.device_control = 2

    // status
    cpu.io.register_read(this.ata_port | 7, this, function () {
      dbg_log('lower irq', LOG_DISK)
      this.cpu.device_lower_irq(this.irq)
      return this.read_status()
    })
    cpu.io.register_read(this.ata_port_high | 2, this, this.read_status)

    cpu.io.register_write(this.ata_port_high | 2, this, this.write_control)
    cpu.io.register_read(
      this.ata_port | 0,
      this,
      function () {
        return this.current_interface.read_data(1)
      },
      function () {
        return this.current_interface.read_data(2)
      },
      function () {
        return this.current_interface.read_data(4)
      }
    )

    cpu.io.register_read(this.ata_port | 1, this, function () {
      dbg_log(
        'Read error: ' +
          h(this.current_interface.error & 0xff) +
          ' slave=' +
          (this.current_interface === this.slave),
        LOG_DISK
      )
      return this.current_interface.error & 0xff
    })
    cpu.io.register_read(this.ata_port | 2, this, function () {
      dbg_log(
        'Read bytecount: ' + h(this.current_interface.bytecount & 0xff),
        LOG_DISK
      )
      return this.current_interface.bytecount & 0xff
    })
    cpu.io.register_read(this.ata_port | 3, this, function () {
      dbg_log(
        'Read sector: ' + h(this.current_interface.sector & 0xff),
        LOG_DISK
      )
      return this.current_interface.sector & 0xff
    })

    cpu.io.register_read(this.ata_port | 4, this, function () {
      dbg_log(
        'Read 1F4: ' + h(this.current_interface.cylinder_low & 0xff),
        LOG_DISK
      )
      return this.current_interface.cylinder_low & 0xff
    })
    cpu.io.register_read(this.ata_port | 5, this, function () {
      dbg_log(
        'Read 1F5: ' + h(this.current_interface.cylinder_high & 0xff),
        LOG_DISK
      )
      return this.current_interface.cylinder_high & 0xff
    })
    cpu.io.register_read(this.ata_port | 6, this, function () {
      dbg_log('Read 1F6', LOG_DISK)
      return this.current_interface.drive_head & 0xff
    })

    cpu.io.register_write(
      this.ata_port | 0,
      this,
      function (data) {
        this.current_interface.write_data_port8(data)
      },
      function (data) {
        this.current_interface.write_data_port16(data)
      },
      function (data) {
        this.current_interface.write_data_port32(data)
      }
    )

    cpu.io.register_write(this.ata_port | 1, this, function (data) {
      dbg_log('1F1/lba_count: ' + h(data), LOG_DISK)
      this.master.lba_count = ((this.master.lba_count << 8) | data) & 0xffff
      this.slave.lba_count = ((this.slave.lba_count << 8) | data) & 0xffff
    })
    cpu.io.register_write(this.ata_port | 2, this, function (data) {
      dbg_log('1F2/bytecount: ' + h(data), LOG_DISK)
      this.master.bytecount = ((this.master.bytecount << 8) | data) & 0xffff
      this.slave.bytecount = ((this.slave.bytecount << 8) | data) & 0xffff
    })
    cpu.io.register_write(this.ata_port | 3, this, function (data) {
      dbg_log('1F3/sector: ' + h(data), LOG_DISK)
      this.master.sector = ((this.master.sector << 8) | data) & 0xffff
      this.slave.sector = ((this.slave.sector << 8) | data) & 0xffff
    })

    cpu.io.register_write(this.ata_port | 4, this, function (data) {
      dbg_log('1F4/sector low: ' + h(data), LOG_DISK)
      this.master.cylinder_low =
        ((this.master.cylinder_low << 8) | data) & 0xffff
      this.slave.cylinder_low = ((this.slave.cylinder_low << 8) | data) & 0xffff
    })
    cpu.io.register_write(this.ata_port | 5, this, function (data) {
      dbg_log('1F5/sector high: ' + h(data), LOG_DISK)
      this.master.cylinder_high =
        ((this.master.cylinder_high << 8) | data) & 0xffff
      this.slave.cylinder_high =
        ((this.slave.cylinder_high << 8) | data) & 0xffff
    })
    cpu.io.register_write(this.ata_port | 6, this, function (data) {
      let slave = data & 0x10
      // eslint-disable-next-line no-unused-vars
      let mode = data & 0xe0

      dbg_log('1F6/drive: ' + h(data, 2), LOG_DISK)

      if (slave) {
        dbg_log('Slave', LOG_DISK)
        this.current_interface = this.slave
      } else {
        this.current_interface = this.master
      }

      this.master.drive_head = data
      this.slave.drive_head = data
      this.master.is_lba = this.slave.is_lba = (data >> 6) & 1
      this.master.head = this.slave.head = data & 0xf
    })

    /** @type {number} */
    this.prdt_addr = 0

    /** @type {number} */
    this.dma_status = 0

    /** @type {number} */
    this.dma_command = 0

    cpu.io.register_write(this.ata_port | 7, this, function (data) {
      dbg_log('lower irq', LOG_DISK)
      this.cpu.device_lower_irq(this.irq)
      this.current_interface.ata_command(data)
    })

    cpu.io.register_read(
      this.master_port | 4,
      this,
      undefined,
      undefined,
      this.dma_read_addr
    )
    cpu.io.register_write(
      this.master_port | 4,
      this,
      undefined,
      undefined,
      this.dma_set_addr
    )

    cpu.io.register_read(
      this.master_port,
      this,
      this.dma_read_command8,
      undefined,
      this.dma_read_command
    )
    cpu.io.register_write(
      this.master_port,
      this,
      this.dma_write_command8,
      undefined,
      this.dma_write_command
    )

    cpu.io.register_read(this.master_port | 2, this, this.dma_read_status)
    cpu.io.register_write(this.master_port | 2, this, this.dma_write_status)

    cpu.io.register_read(this.master_port | 0x8, this, function () {
      dbg_log('DMA read 0x8', LOG_DISK)
      return 0
    })
    cpu.io.register_read(this.master_port | 0xa, this, function () {
      dbg_log('DMA read 0xA', LOG_DISK)
      return 0
    })

    cpu.devices.pci.register_device(this)

    if (DEBUG) Object.seal(this)
  }

  read_status() {
    if (this.current_interface.buffer) {
      let ret = this.current_interface.status
      dbg_log('ATA read status: ' + h(ret, 2), LOG_DISK)
      return ret
    } else {
      return 0
    }
  }

  write_control(data) {
    dbg_log(
      'set device control: ' +
        h(data, 2) +
        ' interrupts ' +
        (data & 2 ? 'disabled' : 'enabled'),
      LOG_DISK
    )

    if (data & 4) {
      dbg_log('Reset via control port', LOG_DISK)

      this.cpu.device_lower_irq(this.irq)

      this.master.device_reset()
      this.slave.device_reset()
    }

    this.device_control = data
  }

  dma_read_addr() {
    dbg_log('dma get address: ' + h(this.prdt_addr, 8), LOG_DISK)
    return this.prdt_addr
  }

  dma_set_addr(data) {
    dbg_log('dma set address: ' + h(data, 8), LOG_DISK)
    this.prdt_addr = data
  }

  dma_read_status() {
    dbg_log('DMA read status: ' + h(this.dma_status), LOG_DISK)
    return this.dma_status
  }

  dma_write_status(value) {
    dbg_log('DMA set status: ' + h(value), LOG_DISK)
    this.dma_status &= ~(value & 6)
  }

  dma_read_command() {
    return this.dma_read_command8() | (this.dma_read_status() << 16)
  }

  dma_read_command8() {
    dbg_log('DMA read command: ' + h(this.dma_command), LOG_DISK)
    return this.dma_command
  }

  dma_write_command(value) {
    dbg_log('DMA write command: ' + h(value), LOG_DISK)

    this.dma_write_command8(value & 0xff)
    this.dma_write_status((value >> 16) & 0xff)
  }

  dma_write_command8(value) {
    dbg_log('DMA write command8: ' + h(value), LOG_DISK)

    let old_command = this.dma_command
    this.dma_command = value & 0x9

    if ((old_command & 1) === (value & 1)) {
      return
    }

    if ((value & 1) === 0) {
      this.dma_status &= ~1
      return
    }

    this.dma_status |= 1

    switch (this.current_interface.current_command) {
      case 0x25:
      case 0xc8:
        this.current_interface.do_ata_read_sectors_dma()
        break

      case 0xca:
      case 0x35:
        this.current_interface.do_ata_write_sectors_dma()
        break

      case 0xa0:
        this.current_interface.do_atapi_dma()
        break

      default:
        dbg_log(
          'Spurious dma command write, current command: ' +
            h(this.current_interface.current_command),
          LOG_DISK
        )
        dbg_assert(false)
    }
  }

  push_irq() {
    if ((this.device_control & 2) === 0) {
      dbg_log('push irq', LOG_DISK)
      this.dma_status |= 4
      this.cpu.device_raise_irq(this.irq)
    }
  }

  get_state() {
    let state = []
    state[0] = this.master
    state[1] = this.slave
    state[2] = this.ata_port
    state[3] = this.irq
    state[4] = this.pci_id
    state[5] = this.ata_port_high
    state[6] = this.master_port
    state[7] = this.name
    state[8] = this.device_control
    state[9] = this.prdt_addr
    state[10] = this.dma_status
    state[11] = this.current_interface === this.master
    state[12] = this.dma_command
    return state
  }

  set_state(state) {
    this.master.set_state(state[0])
    this.slave.set_state(state[1])
    this.ata_port = state[2]
    this.irq = state[3]
    this.pci_id = state[4]
    this.ata_port_high = state[5]
    this.master_port = state[6]
    this.name = state[7]
    this.device_control = state[8]
    this.prdt_addr = state[9]
    this.dma_status = state[10]
    this.current_interface = state[11] ? this.master : this.slave
    this.dma_command = state[12]
  }
}

/**
 * @constructor
 */
export class IDEInterface {
  constructor(device, cpu, buffer, is_cd, device_nr, interface_nr, bus) {
    this.device = device

    /** @const @type {BusConnector} */
    this.bus = bus

    /**
     * @const
     * @type {number}
     */
    this.nr = device_nr

    /** @const @type {CPU} */
    this.cpu = cpu

    this.buffer = buffer

    /** @type {number} */
    this.sector_size = is_cd ? CDROM_SECTOR_SIZE : HD_SECTOR_SIZE

    /** @type {boolean} */
    this.is_atapi = is_cd

    /** @type {number} */
    this.sector_count = 0

    /** @type {number} */
    this.head_count = 0

    /** @type {number} */
    this.sectors_per_track = 0

    /** @type {number} */
    this.cylinder_count = 0

    if (this.buffer) {
      this.sector_count = this.buffer.byteLength / this.sector_size

      if (this.sector_count !== (this.sector_count | 0)) {
        dbg_log('Warning: Disk size not aligned with sector size', LOG_DISK)
        this.sector_count = Math.ceil(this.sector_count)
      }

      if (is_cd) {
        this.head_count = 1
        this.sectors_per_track = 0
      } else {
        // "default" values: 16/63
        // common: 255, 63
        this.head_count = 16
        this.sectors_per_track = 63
      }

      this.cylinder_count =
        this.sector_count / this.head_count / this.sectors_per_track

      if (this.cylinder_count !== (this.cylinder_count | 0)) {
        dbg_log(
          'Warning: Rounding up cylinder count. Choose different head number',
          LOG_DISK
        )
        this.cylinder_count = Math.floor(this.cylinder_count)
        //this.sector_count = this.cylinder_count * this.head_count *
        //                        this.sectors_per_track * this.sector_size;
      }

      //if(this.cylinder_count > 16383)
      //{
      //    this.cylinder_count = 16383;
      //}

      // disk translation: lba
      let rtc = cpu.devices.rtc

      // master
      rtc.cmos_write(
        CMOS_BIOS_DISKTRANSFLAG,
        rtc.cmos_read(CMOS_BIOS_DISKTRANSFLAG) | (1 << (this.nr * 4))
      )
      rtc.cmos_write(
        CMOS_DISK_DATA,
        (rtc.cmos_read(CMOS_DISK_DATA) & 0x0f) | 0xf0
      )

      let reg = CMOS_DISK_DRIVE1_CYL
      rtc.cmos_write(reg + 0, this.cylinder_count & 0xff)
      rtc.cmos_write(reg + 1, (this.cylinder_count >> 8) & 0xff)
      rtc.cmos_write(reg + 2, this.head_count & 0xff)
      rtc.cmos_write(reg + 3, 0xff)
      rtc.cmos_write(reg + 4, 0xff)
      rtc.cmos_write(reg + 5, 0xc8)
      rtc.cmos_write(reg + 6, this.cylinder_count & 0xff)
      rtc.cmos_write(reg + 7, (this.cylinder_count >> 8) & 0xff)
      rtc.cmos_write(reg + 8, this.sectors_per_track & 0xff)

      //rtc.cmos_write(CMOS_BIOS_DISKTRANSFLAG,
      //    rtc.cmos_read(CMOS_BIOS_DISKTRANSFLAG) | 1 << (nr * 4 + 2)); // slave
    }

    /** @const */
    this.stats = {
      sectors_read: 0,
      sectors_written: 0,
      bytes_read: 0,
      bytes_written: 0,
      loading: false,
    }

    this.buffer = buffer

    /** @type {number} */
    this.is_lba = 0

    /** @type {number} */
    this.bytecount = 0

    /** @type {number} */
    this.sector = 0

    /** @type {number} */
    this.lba_count = 0

    /** @type {number} */
    this.cylinder_low = 0

    /** @type {number} */
    this.cylinder_high = 0

    /** @type {number} */
    this.head = 0

    /** @type {number} */
    this.drive_head = 0

    /** @type {number} */
    this.status = 0x50

    /** @type {number} */
    this.sectors_per_drq = 0x80

    /** @type {number} */
    this.error = 0

    /** @type {number} */
    this.data_pointer = 0

    this.data = new Uint8Array(64 * 1024)
    this.data16 = new Uint16Array(this.data.buffer)
    this.data32 = new Int32Array(this.data.buffer)

    /** @type {number} */
    this.data_length = 0

    /** @type {number} */
    this.data_end = 0

    /** @type {number} */
    this.current_command = -1

    /** @type {number} */
    this.current_atapi_command = -1

    /** @type {number} */
    this.write_dest = 0

    // cancellation support
    this.last_io_id = 0
    this.in_progress_io_ids = new Set()
    this.cancelled_io_ids = new Set()

    Object.seal(this)
  }

  device_reset() {
    if (this.is_atapi) {
      this.status = 0
      this.bytecount = 1
      this.error = 1
      this.sector = 1 // lba_low
      this.cylinder_low = 0x14 // lba_mid
      this.cylinder_high = 0xeb // lba_high
    } else {
      this.status = 0x50 | 1
      this.bytecount = 1
      this.error = 1
      this.sector = 1 // lba_low

      // 0, 0 needed by bochs bios
      this.cylinder_low = 0 // lba_mid
      this.cylinder_high = 0 // lba_high
    }

    this.cancel_io_operations()
  }

  push_irq() {
    this.device.push_irq()
  }

  ata_command(cmd) {
    dbg_log(
      'ATA Command: ' + h(cmd) + ' slave=' + ((this.drive_head >> 4) & 1),
      LOG_DISK
    )

    if (!this.buffer) {
      dbg_log('abort: No buffer', LOG_DISK)
      this.error = 4
      this.status = 0x41
      this.push_irq()
      return
    }

    this.current_command = cmd
    this.error = 0

    switch (cmd) {
      case 0x08:
        dbg_log('ATA device reset', LOG_DISK)
        this.data_pointer = 0
        this.data_end = 0
        this.data_length = 0
        this.device_reset()
        this.push_irq()
        break

      case 0x10:
        // calibrate drive
        this.status = 0x50
        this.cylinder_low = 0
        this.push_irq()
        break

      case 0xf8: {
        // read native max address
        this.status = 0x50
        let last_sector = this.sector_count - 1
        this.sector = last_sector & 0xff
        this.cylinder_low = (last_sector >> 8) & 0xff
        this.cylinder_high = (last_sector >> 16) & 0xff
        this.drive_head =
          (this.drive_head & 0xf0) | ((last_sector >> 24) & 0x0f)
        this.push_irq()
        break
      }

      case 0x27: {
        // read native max address ext
        this.status = 0x50
        let last_sector = this.sector_count - 1
        this.sector = last_sector & 0xff
        this.cylinder_low = (last_sector >> 8) & 0xff
        this.cylinder_high = (last_sector >> 16) & 0xff
        this.sector |= ((last_sector >> 24) << 8) & 0xff00
        this.push_irq()
        break
      }

      case 0x20:
      case 0x24:
      case 0x29:
      case 0xc4:
        // 0x20 read sectors
        // 0x24 read sectors ext
        // 0xC4 read multiple
        // 0x29 read multiple ext
        this.ata_read_sectors(cmd)
        break

      case 0x30:
      case 0x34:
      case 0x39:
      case 0xc5:
        // 0x30 write sectors
        // 0x34 write sectors ext
        // 0xC5 write multiple
        // 0x39 write multiple ext
        this.ata_write_sectors(cmd)
        break

      case 0x90:
        // execute device diagnostic
        this.push_irq()
        this.error = 0x101
        this.status = 0x50
        break

      case 0x91:
        // initialize device parameters
        this.status = 0x50
        this.push_irq()
        break

      case 0xa0:
        // ATA packet
        if (this.is_atapi) {
          this.status = 0x58
          this.data_allocate(12)
          this.data_end = 12
          this.bytecount = 1
          this.push_irq()
        }
        break

      case 0xa1:
        dbg_log('ATA identify packet device', LOG_DISK)

        if (this.is_atapi) {
          this.create_identify_packet()
          this.status = 0x58

          this.cylinder_low = 0x14
          this.cylinder_high = 0xeb

          this.push_irq()
        } else {
          this.status = 0x41
          this.push_irq()
        }
        break

      case 0xc6:
        // set multiple mode
        // Logical sectors per DRQ Block in word 1
        dbg_log(
          'Logical sectors per DRQ Block: ' + h(this.bytecount & 0xff),
          LOG_DISK
        )
        this.sectors_per_drq = this.bytecount & 0xff
        this.status = 0x50
        this.push_irq()
        break

      case 0x25: // read dma ext
      case 0xc8: // read dma
        this.ata_read_sectors_dma(cmd)
        break

      case 0x35: // write dma ext
      case 0xca: // write dma
        this.ata_write_sectors_dma(cmd)
        break

      case 0x40:
        dbg_log('read verify sectors', LOG_DISK)
        this.status = 0x50
        this.push_irq()
        break

      case 0xda:
        dbg_log('Unimplemented: get media status', LOG_DISK)
        this.status = 0x41
        this.error = 4
        this.push_irq()
        break

      case 0xe0:
        dbg_log('ATA standby immediate', LOG_DISK)
        this.status = 0x50
        this.push_irq()
        break

      case 0xe1:
        dbg_log('ATA idle immediate', LOG_DISK)
        this.status = 0x50
        this.push_irq()
        break

      case 0xe7:
        dbg_log('ATA flush cache', LOG_DISK)
        this.status = 0x50
        this.push_irq()
        break

      case 0xec:
        dbg_log('ATA identify device', LOG_DISK)

        if (this.is_atapi) {
          this.status = 0x41
          this.error = 4
          this.push_irq()
          return
        }

        this.create_identify_packet()
        this.status = 0x58

        this.push_irq()
        break

      case 0xea:
        dbg_log('flush cache ext', LOG_DISK)
        this.status = 0x50
        this.push_irq()
        break

      case 0xef:
        dbg_log('set features: ' + h(this.bytecount & 0xff), LOG_DISK)
        this.status = 0x50
        this.push_irq()
        break

      case 0xde:
        // obsolete
        this.status = 0x50
        this.push_irq()
        break

      case 0xf5:
        dbg_log('security freeze lock', LOG_DISK)
        this.status = 0x50
        this.push_irq()
        break

      case 0xf9:
        dbg_log('Unimplemented: set max address', LOG_DISK)
        this.status = 0x41
        this.error = 4
        break

      default:
        dbg_assert(false, 'New ATA cmd on 1F7: ' + h(cmd), LOG_DISK)

        this.status = 0x41
        // abort bit set
        this.error = 4
    }
  }

  atapi_handle() {
    dbg_log(
      'ATAPI Command: ' +
        h(this.data[0]) +
        ' slave=' +
        ((this.drive_head >> 4) & 1),
      LOG_DISK
    )

    this.data_pointer = 0
    this.current_atapi_command = this.data[0]

    switch (this.current_atapi_command) {
      case 0x00:
        dbg_log('test unit ready', LOG_DISK)
        // test unit ready
        this.data_allocate(0)
        this.data_end = this.data_length
        this.status = 0x50
        break

      case 0x03:
        // request sense
        this.data_allocate(this.data[4])
        this.data_end = this.data_length
        this.status = 0x58

        this.data[0] = 0x80 | 0x70
        this.data[2] = 5 // illegal request
        this.data[7] = 8
        break

      case 0x12: {
        // inquiry
        let length = this.data[4]
        this.status = 0x58

        dbg_log(
          'inquiry: ' + h(this.data[1], 2) + ' length=' + length,
          LOG_DISK
        )

        // http://www.t10.org/ftp/x3t9.2/document.87/87-106r0.txt
        //this.data_allocate(36);
        this.data.set([
          0x05, 0x80, 0x01, 0x31,
          // additional length
          31, 0, 0, 0,

          // 8
          0x53, 0x4f, 0x4e, 0x59, 0x20, 0x20, 0x20, 0x20,

          // 16
          0x43, 0x44, 0x2d, 0x52, 0x4f, 0x4d, 0x20, 0x43, 0x44, 0x55, 0x2d,
          0x31, 0x30, 0x30, 0x30, 0x20,

          // 32
          0x31, 0x2e, 0x31, 0x61,
        ])
        this.data_end = this.data_length = Math.min(36, length)
        break
      }

      case 0x1a:
        // mode sense (6)
        this.data_allocate(this.data[4])
        this.data_end = this.data_length
        this.status = 0x58
        break

      case 0x1e:
        // prevent/allow medium removal
        this.data_allocate(0)
        this.data_end = this.data_length
        this.status = 0x50
        break

      case 0x25: {
        // read capacity
        let count = this.sector_count - 1
        this.data_set(
          new Uint8Array([
            (count >> 24) & 0xff,
            (count >> 16) & 0xff,
            (count >> 8) & 0xff,
            count & 0xff,
            0,
            0,
            (this.sector_size >> 8) & 0xff,
            this.sector_size & 0xff,
          ])
        )
        this.data_end = this.data_length
        this.status = 0x58
        break
      }

      case 0x28:
        // read
        if (this.lba_count & 1) {
          this.atapi_read_dma(this.data)
        } else {
          this.atapi_read(this.data)
        }
        break

      case 0x42: {
        let length = this.data[8]
        this.data_allocate(Math.min(8, length))
        this.data_end = this.data_length
        dbg_log('read q subcode: length=' + length, LOG_DISK)
        this.status = 0x58
        break
      }

      case 0x43: {
        // read toc
        let length = this.data[8] | (this.data[7] << 8)
        let format = this.data[9] >> 6

        this.data_allocate(length)
        this.data_end = this.data_length
        dbg_log(
          'read toc: ' +
            h(format, 2) +
            ' length=' +
            length +
            ' ' +
            (this.data[1] & 2) +
            ' ' +
            h(this.data[6]),
          LOG_DISK
        )

        if (format === 0) {
          let sector_count = this.sector_count
          this.data.set(
            new Uint8Array([
              0,
              18, // length
              1,
              1, // first and last session

              0,
              0x14,
              1, // track number
              0,
              0,
              0,
              0,
              0,

              0,
              0x16,
              0xaa, // track number
              0,
              sector_count >> 24,
              (sector_count >> 16) & 0xff,
              (sector_count >> 8) & 0xff,
              sector_count & 0xff,
            ])
          )
        } else if (format === 1) {
          this.data.set(
            new Uint8Array([
              0,
              10, // length
              1,
              1, // first and last session
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
            ])
          )
        } else {
          dbg_assert(false, 'Unimplemented format: ' + format)
        }

        this.status = 0x58
        break
      }

      case 0x46: {
        // get configuration
        let length = this.data[8] | (this.data[7] << 8)
        length = Math.min(length, 32)
        this.data_allocate(length)
        this.data_end = this.data_length
        this.data[0] = ((length - 4) >> 24) & 0xff
        this.data[1] = ((length - 4) >> 16) & 0xff
        this.data[2] = ((length - 4) >> 8) & 0xff
        this.data[3] = (length - 4) & 0xff
        this.data[6] = 0x08
        this.data[10] = 3
        this.status = 0x58
        break
      }

      case 0x51:
        // read disk information
        this.data_allocate(0)
        this.data_end = this.data_length
        this.status = 0x50
        break

      case 0x52:
        dbg_log('Unimplemented ATAPI command: ' + h(this.data[0]), LOG_DISK)
        this.status = 0x51
        this.data_length = 0
        this.error = 5 << 4
        break

      case 0x5a: {
        // mode sense
        let length = this.data[8] | (this.data[7] << 8)
        let page_code = this.data[2]
        dbg_log('mode sense: ' + h(page_code) + ' length=' + length, LOG_DISK)
        if (page_code === 0x2a) {
          this.data_allocate(Math.min(30, length))
        }
        this.data_end = this.data_length
        this.status = 0x58
        break
      }

      case 0xbd:
        // mechanism status
        this.data_allocate(this.data[9] | (this.data[8] << 8))
        this.data_end = this.data_length
        this.data[5] = 1
        this.status = 0x58
        break

      case 0x4a:
        this.status = 0x51
        this.data_length = 0
        this.error = 5 << 4
        dbg_log('Unimplemented ATAPI command: ' + h(this.data[0]), LOG_DISK)
        break

      case 0xbe:
        // Hiren's boot CD
        dbg_log('Unimplemented ATAPI command: ' + h(this.data[0]), LOG_DISK)
        this.data_allocate(0)
        this.data_end = this.data_length
        this.status = 0x50
        break

      default:
        this.status = 0x51
        this.data_length = 0
        this.error = 5 << 4
        dbg_log('Unimplemented ATAPI command: ' + h(this.data[0]), LOG_DISK)
        dbg_assert(false)
    }

    this.bytecount = (this.bytecount & ~7) | 2

    if ((this.status & 0x80) === 0) {
      this.push_irq()
    }

    if ((this.status & 0x80) === 0 && this.data_length === 0) {
      this.bytecount |= 1
      this.status &= ~8
    }
  }

  do_write() {
    this.status = 0x50

    dbg_assert(this.data_length <= this.data.length)
    let data = this.data.subarray(0, this.data_length)

    //dbg_log(hex_dump(data), LOG_DISK);
    dbg_assert(this.data_length % 512 === 0)
    this.ata_advance(this.current_command, this.data_length / 512)
    this.push_irq()

    this.buffer.set(this.write_dest, data, function () {})

    this.report_write(this.data_length)
  }

  atapi_read(cmd) {
    // Note: Big Endian
    let lba = (cmd[2] << 24) | (cmd[3] << 16) | (cmd[4] << 8) | cmd[5]
    let count = (cmd[7] << 8) | cmd[8]
    let flags = cmd[1]
    let byte_count = count * this.sector_size
    let start = lba * this.sector_size

    dbg_log(
      'CD read lba=' +
        h(lba) +
        ' lbacount=' +
        h(count) +
        ' bytecount=' +
        h(byte_count) +
        ' flags=' +
        h(flags),
      LOG_DISK
    )

    this.data_length = 0
    let req_length =
      ((this.cylinder_high << 8) & 0xff00) | (this.cylinder_low & 0xff)
    dbg_log(h(this.cylinder_high, 2) + ' ' + h(this.cylinder_low, 2), LOG_DISK)
    this.cylinder_low = this.cylinder_high = 0 // oak technology driver (windows 3.0)

    if (req_length === 0xffff) req_length--

    if (req_length > byte_count) {
      req_length = byte_count
    }

    if (start >= this.buffer.byteLength) {
      dbg_assert(
        false,
        'CD read: Outside of disk  end=' +
          h(start + byte_count) +
          ' size=' +
          h(this.buffer.byteLength),
        LOG_DISK
      )

      this.status = 0xff
      this.push_irq()
    } else if (byte_count === 0) {
      this.status = 0x50

      this.data_pointer = 0
      //this.push_irq();
    } else {
      byte_count = Math.min(byte_count, this.buffer.byteLength - start)
      this.status = 0x50 | 0x80
      this.report_read_start()

      this.read_buffer(start, byte_count, (data) => {
        //setTimeout(() => {
        dbg_log('cd read: data arrived', LOG_DISK)
        this.data_set(data)
        this.status = 0x58
        this.bytecount = (this.bytecount & ~7) | 2

        this.push_irq()

        req_length &= ~3

        this.data_end = req_length
        if (this.data_end > this.data_length) {
          this.data_end = this.data_length
        }
        this.cylinder_low = this.data_end & 0xff
        this.cylinder_high = (this.data_end >> 8) & 0xff

        this.report_read_end(byte_count)
        //}, 10);
      })
    }
  }

  atapi_read_dma(cmd) {
    // Note: Big Endian
    let lba = (cmd[2] << 24) | (cmd[3] << 16) | (cmd[4] << 8) | cmd[5]
    let count = (cmd[7] << 8) | cmd[8]
    let flags = cmd[1]
    let byte_count = count * this.sector_size
    let start = lba * this.sector_size

    dbg_log(
      'CD read DMA lba=' +
        h(lba) +
        ' lbacount=' +
        h(count) +
        ' bytecount=' +
        h(byte_count) +
        ' flags=' +
        h(flags),
      LOG_DISK
    )

    if (start >= this.buffer.byteLength) {
      dbg_assert(
        false,
        'CD read: Outside of disk  end=' +
          h(start + byte_count) +
          ' size=' +
          h(this.buffer.byteLength),
        LOG_DISK
      )

      this.status = 0xff
      this.push_irq()
    } else {
      this.status = 0x50 | 0x80
      this.report_read_start()

      this.read_buffer(start, byte_count, (data) => {
        dbg_log('atapi_read_dma: Data arrived')
        this.report_read_end(byte_count)
        this.status = 0x58
        this.bytecount = (this.bytecount & ~7) | 2
        this.data_set(data)

        this.do_atapi_dma()
      })
    }
  }

  do_atapi_dma() {
    if ((this.device.dma_status & 1) === 0) {
      dbg_log('do_atapi_dma: Status not set', LOG_DISK)
      return
    }

    if ((this.status & 0x8) === 0) {
      dbg_log('do_atapi_dma: DRQ not set', LOG_DISK)
      return
    }

    dbg_log('atapi dma transfer len=' + this.data_length, LOG_DISK)

    let prdt_start = this.device.prdt_addr
    let offset = 0

    let data = this.data

    let end

    do {
      let addr = this.cpu.read32s(prdt_start)
      let count = this.cpu.read16(prdt_start + 4)
      end = this.cpu.read8(prdt_start + 7) & 0x80

      if (!count) {
        count = 0x10000
      }

      dbg_log(
        'dma read dest=' +
          h(addr) +
          ' count=' +
          h(count) +
          ' datalen=' +
          h(this.data_length),
        LOG_DISK
      )
      this.cpu.write_blob(
        data.subarray(offset, Math.min(offset + count, this.data_length)),
        addr
      )

      offset += count
      prdt_start += 8

      if (offset >= this.data_length && !end) {
        dbg_log(
          'leave early end=' +
            +end +
            ' offset=' +
            h(offset) +
            ' data_length=' +
            h(this.data_length) +
            ' cmd=' +
            h(this.current_command),
          LOG_DISK
        )
        break
      }
    } while (!end)

    dbg_log('end offset=' + offset, LOG_DISK)

    this.status = 0x50
    this.device.dma_status &= ~1
    this.bytecount = (this.bytecount & ~7) | 3
    this.push_irq()
  }

  read_data(length) {
    if (this.data_pointer < this.data_end) {
      dbg_assert(this.data_pointer + length - 1 < this.data_end)
      dbg_assert(
        this.data_pointer % length === 0,
        h(this.data_pointer) + ' ' + length
      )

      let result

      if (length === 1) {
        result = this.data[this.data_pointer]
      } else if (length === 2) {
        result = this.data16[this.data_pointer >>> 1]
      } else {
        result = this.data32[this.data_pointer >>> 2]
      }

      this.data_pointer += length

      let align = (this.data_end & 0xfff) === 0 ? 0xfff : 0xff
      if ((this.data_pointer & align) === 0) {
        dbg_log(
          'Read 1F0: ' +
            h(this.data[this.data_pointer], 2) +
            ' cur=' +
            h(this.data_pointer) +
            ' cnt=' +
            h(this.data_length),
          LOG_DISK
        )
      }

      if (this.data_pointer >= this.data_end) {
        this.read_end()
      }

      return result
    } else {
      dbg_log('Read 1F0: empty', LOG_DISK)

      this.data_pointer += length
      return 0
    }
  }

  read_end() {
    dbg_log(
      'read_end cmd=' +
        h(this.current_command) +
        ' data_pointer=' +
        h(this.data_pointer) +
        ' end=' +
        h(this.data_end) +
        ' length=' +
        h(this.data_length),
      LOG_DISK
    )

    if (this.current_command === 0xa0) {
      if (this.data_end === this.data_length) {
        this.status = 0x50
        this.bytecount = (this.bytecount & ~7) | 3
        this.push_irq()
      } else {
        this.status = 0x58
        this.bytecount = (this.bytecount & ~7) | 2
        this.push_irq()
        let byte_count =
          ((this.cylinder_high << 8) & 0xff00) | (this.cylinder_low & 0xff)

        if (this.data_end + byte_count > this.data_length) {
          this.cylinder_low = (this.data_length - this.data_end) & 0xff
          this.cylinder_high = ((this.data_length - this.data_end) >> 8) & 0xff
          this.data_end = this.data_length
        } else {
          this.data_end += byte_count
        }
        dbg_log('data_end=' + h(this.data_end), LOG_DISK)
      }
    } else {
      this.error = 0
      if (this.data_pointer >= this.data_length) {
        this.status = 0x50
        this.push_irq()
      } else {
        let sector_count
        if (this.current_command === 0xc4 || this.current_command === 0x29) {
          let sector_count = Math.min(
            this.sectors_per_drq,
            (this.data_length - this.data_end) / 512
          )
          dbg_assert(sector_count % 1 === 0)
        } else {
          dbg_assert(
            this.current_command === 0x20 || this.current_command === 0x24
          )
          sector_count = 1
        }
        this.ata_advance(this.current_command, sector_count)
        this.data_end += 512 * sector_count
        this.status = 0x58
        this.push_irq()
      }
    }
  }

  write_data_port(data, length) {
    dbg_assert(this.data_pointer % length === 0)

    if (this.data_pointer >= this.data_end) {
      dbg_log(
        'Redundant write to data port: ' +
          h(data) +
          ' count=' +
          h(this.data_end) +
          ' cur=' +
          h(this.data_pointer),
        LOG_DISK
      )
    } else {
      let align = (this.data_end & 0xfff) === 0 ? 0xfff : 0xff
      if (((this.data_pointer + length) & align) === 0 || this.data_end < 20) {
        dbg_log(
          'Data port: ' +
            h(data >>> 0) +
            ' count=' +
            h(this.data_end) +
            ' cur=' +
            h(this.data_pointer),
          LOG_DISK
        )
      }

      if (length === 1) {
        this.data[this.data_pointer++] = data
      } else if (length === 2) {
        this.data16[this.data_pointer >>> 1] = data
        this.data_pointer += 2
      } else {
        this.data32[this.data_pointer >>> 2] = data
        this.data_pointer += 4
      }

      dbg_assert(this.data_pointer <= this.data_end)
      if (this.data_pointer === this.data_end) {
        this.write_end()
      }
    }
  }

  write_data_port8(data) {
    this.write_data_port(data, 1)
  }

  write_data_port16(data) {
    this.write_data_port(data, 2)
  }

  write_data_port32(data) {
    this.write_data_port(data, 4)
  }

  write_end() {
    if (this.current_command === 0xa0) {
      this.atapi_handle()
    } else {
      dbg_log(
        'write_end data_pointer=' +
          h(this.data_pointer) +
          ' data_length=' +
          h(this.data_length),
        LOG_DISK
      )

      if (this.data_pointer >= this.data_length) {
        this.do_write()
      } else {
        dbg_assert(
          this.current_command === 0x30 ||
            this.current_command === 0x34 ||
            this.current_command === 0xc5,
          'Unexpected command: ' + h(this.current_command)
        )

        // XXX: Should advance here, but do_write does all the advancing
        //this.ata_advance(this.current_command, 1);
        this.status = 0x58
        this.data_end += 512
        this.push_irq()
      }
    }
  }

  ata_advance(cmd, sectors) {
    dbg_log(
      'Advance sectors=' + sectors + ' old_bytecount=' + this.bytecount,
      LOG_DISK
    )
    this.bytecount -= sectors

    if (
      cmd === 0x24 ||
      cmd === 0x29 ||
      cmd === 0x34 ||
      cmd === 0x39 ||
      cmd === 0x25 ||
      cmd === 0x35
    ) {
      let new_sector = sectors + this.get_lba48()
      this.sector = (new_sector & 0xff) | ((new_sector >> 16) & 0xff00)
      this.cylinder_low = (new_sector >> 8) & 0xff
      this.cylinder_high = (new_sector >> 16) & 0xff
    } else if (this.is_lba) {
      let new_sector = sectors + this.get_lba28()
      this.sector = new_sector & 0xff
      this.cylinder_low = (new_sector >> 8) & 0xff
      this.cylinder_high = (new_sector >> 16) & 0xff
      this.head = (this.head & ~0xf) | (new_sector & 0xf)
    } // chs
    else {
      let new_sector = sectors + this.get_chs()

      let c = (new_sector / (this.head_count * this.sectors_per_track)) | 0
      this.cylinder_low = c & 0xff
      this.cylinder_high = (c >> 8) & 0xff
      this.head =
        ((new_sector / this.sectors_per_track) | 0) % this.head_count & 0xf
      this.sector = ((new_sector % this.sectors_per_track) + 1) & 0xff

      dbg_assert(new_sector === this.get_chs())
    }
  }

  ata_read_sectors(cmd) {
    let is_lba48 = cmd === 0x24 || cmd === 0x29
    let count = this.get_count(is_lba48)
    let lba = this.get_lba(is_lba48)

    let is_single = cmd === 0x20 || cmd === 0x24

    let byte_count = count * this.sector_size
    let start = lba * this.sector_size

    dbg_log(
      'ATA read cmd=' +
        h(cmd) +
        ' mode=' +
        (this.is_lba ? 'lba' : 'chs') +
        ' lba=' +
        h(lba) +
        ' lbacount=' +
        h(count) +
        ' bytecount=' +
        h(byte_count),
      LOG_DISK
    )

    if (start + byte_count > this.buffer.byteLength) {
      dbg_assert(false, 'ATA read: Outside of disk', LOG_DISK)

      this.status = 0xff
      this.push_irq()
    } else {
      this.status = 0x80 | 0x40
      this.report_read_start()

      this.read_buffer(start, byte_count, (data) => {
        //setTimeout(() => {
        dbg_log('ata_read: Data arrived', LOG_DISK)

        this.data_set(data)
        this.status = 0x58
        this.data_end = is_single
          ? 512
          : Math.min(byte_count, this.sectors_per_drq * 512)
        this.ata_advance(
          cmd,
          is_single ? 1 : Math.min(count, this.sectors_per_track)
        )

        this.push_irq()
        this.report_read_end(byte_count)
        //}, 10);
      })
    }
  }

  ata_read_sectors_dma(cmd) {
    let is_lba48 = cmd === 0x25
    let count = this.get_count(is_lba48)
    let lba = this.get_lba(is_lba48)

    let byte_count = count * this.sector_size
    let start = lba * this.sector_size

    dbg_log(
      'ATA DMA read lba=' +
        h(lba) +
        ' lbacount=' +
        h(count) +
        ' bytecount=' +
        h(byte_count),
      LOG_DISK
    )

    if (start + byte_count > this.buffer.byteLength) {
      dbg_assert(false, 'ATA read: Outside of disk', LOG_DISK)

      this.status = 0xff
      this.push_irq()
      return
    }

    this.status = 0x58
    this.device.dma_status |= 1
  }

  do_ata_read_sectors_dma() {
    let cmd = this.current_command

    let is_lba48 = cmd === 0x25
    let count = this.get_count(is_lba48)
    let lba = this.get_lba(is_lba48)

    let byte_count = count * this.sector_size
    let start = lba * this.sector_size

    dbg_assert(lba < this.buffer.byteLength)

    this.report_read_start()

    let orig_prdt_start = this.device.prdt_addr

    this.read_buffer(start, byte_count, (data) => {
      //setTimeout(function() {
      dbg_log('do_ata_read_sectors_dma: Data arrived', LOG_DISK)
      let prdt_start = this.device.prdt_addr
      let offset = 0

      dbg_assert(orig_prdt_start === prdt_start)

      let end
      do {
        let prd_addr = this.cpu.read32s(prdt_start)
        let prd_count = this.cpu.read16(prdt_start + 4)
        end = this.cpu.read8(prdt_start + 7) & 0x80

        if (!prd_count) {
          prd_count = 0x10000
          dbg_log('dma: prd count was 0', LOG_DISK)
        }

        dbg_log(
          'dma read transfer dest=' +
            h(prd_addr) +
            ' prd_count=' +
            h(prd_count),
          LOG_DISK
        )
        this.cpu.write_blob(data.subarray(offset, offset + prd_count), prd_addr)

        offset += prd_count
        prdt_start += 8
      } while (!end)

      dbg_assert(offset === byte_count)

      this.ata_advance(this.current_command, count)
      this.status = 0x50
      this.device.dma_status &= ~1
      this.current_command = -1

      this.push_irq()

      this.report_read_end(byte_count)
      //}.bind(this), 10);
    })
  }

  ata_write_sectors(cmd) {
    let is_lba48 = cmd === 0x34 || cmd === 0x39
    let count = this.get_count(is_lba48)
    let lba = this.get_lba(is_lba48)

    let is_single = cmd === 0x30 || cmd === 0x34

    let byte_count = count * this.sector_size
    let start = lba * this.sector_size

    dbg_log(
      'ATA write lba=' +
        h(lba) +
        ' mode=' +
        (this.is_lba ? 'lba' : 'chs') +
        ' lbacount=' +
        h(count) +
        ' bytecount=' +
        h(byte_count),
      LOG_DISK
    )

    if (start + byte_count > this.buffer.byteLength) {
      dbg_assert(false, 'ATA write: Outside of disk', LOG_DISK)

      this.status = 0xff
      this.push_irq()
    } else {
      this.status = 0x58
      this.data_allocate_noclear(byte_count)
      this.data_end = is_single
        ? 512
        : Math.min(byte_count, this.sectors_per_drq * 512)
      this.write_dest = start
    }
  }

  ata_write_sectors_dma(cmd) {
    let is_lba48 = cmd === 0x35
    let count = this.get_count(is_lba48)
    let lba = this.get_lba(is_lba48)

    let byte_count = count * this.sector_size
    let start = lba * this.sector_size

    dbg_log(
      'ATA DMA write lba=' +
        h(lba) +
        ' lbacount=' +
        h(count) +
        ' bytecount=' +
        h(byte_count),
      LOG_DISK
    )

    if (start + byte_count > this.buffer.byteLength) {
      dbg_assert(false, 'ATA DMA write: Outside of disk', LOG_DISK)

      this.status = 0xff
      this.push_irq()
      return
    }

    this.status = 0x58
    this.device.dma_status |= 1
  }

  do_ata_write_sectors_dma() {
    let cmd = this.current_command

    let is_lba48 = cmd === 0x35
    let count = this.get_count(is_lba48)
    let lba = this.get_lba(is_lba48)

    let byte_count = count * this.sector_size
    let start = lba * this.sector_size

    let prdt_start = this.device.prdt_addr
    let offset = 0

    dbg_log('prdt addr: ' + h(prdt_start, 8), LOG_DISK)

    const buffer = new Uint8Array(byte_count)

    let end
    do {
      let prd_addr = this.cpu.read32s(prdt_start)
      let prd_count = this.cpu.read16(prdt_start + 4)
      end = this.cpu.read8(prdt_start + 7) & 0x80

      if (!prd_count) {
        prd_count = 0x10000
        dbg_log('dma: prd count was 0', LOG_DISK)
      }

      dbg_log(
        'dma write transfer dest=' + h(prd_addr) + ' prd_count=' + h(prd_count),
        LOG_DISK
      )

      let slice = this.cpu.mem8.subarray(prd_addr, prd_addr + prd_count)
      dbg_assert(slice.length === prd_count)

      buffer.set(slice, offset)

      //if(DEBUG)
      //{
      //    dbg_log(hex_dump(slice), LOG_DISK);
      //}

      offset += prd_count
      prdt_start += 8
    } while (!end)

    dbg_assert(offset === buffer.length)

    this.buffer.set(start, buffer, () => {
      dbg_log('dma write completed', LOG_DISK)
      this.ata_advance(this.current_command, count)
      this.status = 0x50
      this.push_irq()
      this.device.dma_status &= ~1
      this.current_command = -1
    })

    this.report_write(byte_count)
  }

  get_chs() {
    let c = (this.cylinder_low & 0xff) | ((this.cylinder_high << 8) & 0xff00)
    let h = this.head
    let s = this.sector & 0xff

    dbg_log('get_chs: c=' + c + ' h=' + h + ' s=' + s, LOG_DISK)

    return (c * this.head_count + h) * this.sectors_per_track + s - 1
  }

  get_lba28() {
    return (
      (this.sector & 0xff) |
      ((this.cylinder_low << 8) & 0xff00) |
      ((this.cylinder_high << 16) & 0xff0000) |
      ((this.head & 0xf) << 24)
    )
  }

  get_lba48() {
    // Note: Bits over 32 missing
    return (
      ((this.sector & 0xff) |
        ((this.cylinder_low << 8) & 0xff00) |
        ((this.cylinder_high << 16) & 0xff0000) |
        (((this.sector >> 8) << 24) & 0xff000000)) >>>
      0
    )
  }

  get_lba(is_lba48) {
    if (is_lba48) {
      return this.get_lba48()
    } else if (this.is_lba) {
      return this.get_lba28()
    } else {
      return this.get_chs()
    }
  }

  get_count(is_lba48) {
    if (is_lba48) {
      let count = this.bytecount
      if (count === 0) count = 0x10000
      return count
    } else {
      let count = this.bytecount & 0xff
      if (count === 0) count = 0x100
      return count
    }
  }

  create_identify_packet() {
    // http://bochs.sourceforge.net/cgi-bin/lxr/source/iodev/harddrv.cc#L2821

    if (this.drive_head & 0x10) {
      // slave
      this.data_allocate(0)
      return
    }

    for (let i = 0; i < 512; i++) {
      this.data[i] = 0
    }

    let cylinder_count = Math.min(16383, this.cylinder_count)

    this.data_set([
      0x40,
      this.is_atapi ? 0x85 : 0,
      // 1 cylinders
      cylinder_count,
      cylinder_count >> 8,
      0,
      0,

      // 3 heads
      this.head_count,
      this.head_count >> 8,
      this.sectors_per_track / 512,
      (this.sectors_per_track / 512) >> 8,
      // 5
      0,
      512 >> 8,
      // sectors per track
      this.sectors_per_track,
      this.sectors_per_track >> 8,
      0,
      0,
      0,
      0,
      0,
      0,
      // 10-19 serial number
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 20
      3,
      0,
      0,
      2,
      4,
      0,
      // 23-26 firmware revision
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,

      // 27 model number
      56,
      118,
      32,
      54,
      68,
      72,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,
      32,

      // 47 max value for set multiple mode
      0x80,
      0,
      1,
      0,
      //0, 3,  // capabilities, 2: Only LBA / 3: LBA and DMA
      0,
      2, // capabilities, 2: Only LBA / 3: LBA and DMA
      // 50
      0,
      0,
      0,
      2,
      0,
      2,
      7,
      0,

      // 54 cylinders
      cylinder_count,
      cylinder_count >> 8,
      // 55 heads
      this.head_count,
      this.head_count >> 8,
      // 56 sectors per track
      this.sectors_per_track,
      0,
      // capacity in sectors
      this.sector_count & 0xff,
      (this.sector_count >> 8) & 0xff,
      (this.sector_count >> 16) & 0xff,
      (this.sector_count >> 24) & 0xff,

      0,
      0,
      // 60
      this.sector_count & 0xff,
      (this.sector_count >> 8) & 0xff,
      (this.sector_count >> 16) & 0xff,
      (this.sector_count >> 24) & 0xff,

      0,
      0,
      // 63, dma supported mode, dma selected mode
      this.current_command === 0xa0 ? 0 : 7,
      this.current_command === 0xa0 ? 0 : 4,
      //0, 0, // no DMA

      0,
      0,
      // 65
      30,
      0,
      30,
      0,
      30,
      0,
      30,
      0,
      0,
      0,
      // 70
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 75
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 80
      0x7e,
      0,
      0,
      0,
      0,
      0,
      0,
      0x74,
      0,
      0x40,
      // 85
      0,
      0x40,
      0,
      0x74,
      0,
      0x40,
      0,
      0,
      0,
      0,
      // 90
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      0x60,
      0,
      0,
      // 95
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 100
      this.sector_count & 0xff,
      (this.sector_count >> 8) & 0xff,
      (this.sector_count >> 16) & 0xff,
      (this.sector_count >> 24) & 0xff,
    ])

    this.data_length = 512
    this.data_end = 512
  }

  data_allocate(len) {
    this.data_allocate_noclear(len)

    for (let i = 0; i < (len + 3) >> 2; i++) {
      this.data32[i] = 0
    }
  }

  data_allocate_noclear(len) {
    if (this.data.length < len) {
      this.data = new Uint8Array((len + 3) & ~3)
      this.data16 = new Uint16Array(this.data.buffer)
      this.data32 = new Int32Array(this.data.buffer)
    }

    this.data_length = len
    this.data_pointer = 0
  }

  data_set(data) {
    this.data_allocate_noclear(data.length)
    this.data.set(data)
  }

  report_read_start() {
    this.stats.loading = true
    this.bus.send('ide-read-start')
  }

  report_read_end(byte_count) {
    this.stats.loading = false

    let sector_count = (byte_count / this.sector_size) | 0
    this.stats.sectors_read += sector_count
    this.stats.bytes_read += byte_count

    this.bus.send('ide-read-end', [this.nr, byte_count, sector_count])
  }

  report_write(byte_count) {
    let sector_count = (byte_count / this.sector_size) | 0
    this.stats.sectors_written += sector_count
    this.stats.bytes_written += byte_count

    this.bus.send('ide-write-end', [this.nr, byte_count, sector_count])
  }

  read_buffer(start, length, callback) {
    const id = this.last_io_id++
    this.in_progress_io_ids.add(id)

    this.buffer.get(start, length, (data) => {
      if (this.cancelled_io_ids.delete(id)) {
        dbg_assert(!this.in_progress_io_ids.has(id))
        return
      }

      const removed = this.in_progress_io_ids.delete(id)
      dbg_assert(removed)

      callback(data)
    })
  }

  cancel_io_operations() {
    for (const id of this.in_progress_io_ids) {
      this.cancelled_io_ids.add(id)
    }
    this.in_progress_io_ids.clear()
  }

  get_state() {
    let state = []
    state[0] = this.bytecount
    state[1] = this.cylinder_count
    state[2] = this.cylinder_high
    state[3] = this.cylinder_low
    state[4] = this.data_pointer
    state[5] = 0
    state[6] = 0
    state[7] = 0
    state[8] = 0
    state[9] = this.drive_head
    state[10] = this.error
    state[11] = this.head
    state[12] = this.head_count
    state[13] = this.is_atapi
    state[14] = this.is_lba
    state[15] = this.lba_count
    state[16] = this.data
    state[17] = this.data_length
    state[18] = this.sector
    state[19] = this.sector_count
    state[20] = this.sector_size
    state[21] = this.sectors_per_drq
    state[22] = this.sectors_per_track
    state[23] = this.status
    state[24] = this.write_dest
    state[25] = this.current_command
    state[26] = this.data_end
    state[27] = this.current_atapi_command
    state[28] = this.buffer
    return state
  }

  set_state(state) {
    this.bytecount = state[0]
    this.cylinder_count = state[1]
    this.cylinder_high = state[2]
    this.cylinder_low = state[3]
    this.data_pointer = state[4]

    this.drive_head = state[9]
    this.error = state[10]
    this.head = state[11]
    this.head_count = state[12]
    this.is_atapi = state[13]
    this.is_lba = state[14]
    this.lba_count = state[15]
    this.data = state[16]
    this.data_length = state[17]
    this.sector = state[18]
    this.sector_count = state[19]
    this.sector_size = state[20]
    this.sectors_per_drq = state[21]
    this.sectors_per_track = state[22]
    this.status = state[23]
    this.write_dest = state[24]
    this.current_command = state[25]

    this.data_end = state[26]
    this.current_atapi_command = state[27]

    this.data16 = new Uint16Array(this.data.buffer)
    this.data32 = new Int32Array(this.data.buffer)

    if (this.buffer) this.buffer.set_state(state[28])
  }
}
