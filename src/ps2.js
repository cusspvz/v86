import { LOG_PS2 } from './const'
import { dbg_log } from './log'
import { h } from './utils/h'
import { ByteQueue } from './utils/ByteQueue'

/** @const */
let PS2_LOG_VERBOSE = false

/**
 * @constructor
 * @param {CPU} cpu
 * @param {BusConnector} bus
 */
export class PS2 {
  constructor(cpu, bus) {
    /** @const @type {CPU} */
    this.cpu = cpu

    /** @const @type {BusConnector} */
    this.bus = bus

    /** @type {boolean} */
    this.enable_mouse_stream = false

    /** @type {boolean} */
    this.use_mouse = false

    /** @type {boolean} */
    this.have_mouse = true

    /** @type {number} */
    this.mouse_delta_x = 0
    /** @type {number} */
    this.mouse_delta_y = 0
    /** @type {number} */
    this.mouse_clicks = 0

    /** @type {boolean} */
    this.have_keyboard = true

    /** @type {boolean} */
    this.enable_keyboard_stream = false

    /** @type {boolean} */
    this.next_is_mouse_command = false

    /** @type {boolean} */
    this.next_read_sample = false

    /** @type {boolean} */
    this.next_read_led = false

    /** @type {boolean} */
    this.next_handle_scan_code_set = false

    /** @type {boolean} */
    this.next_read_rate = false

    /** @type {boolean} */
    this.next_read_resolution = false

    /**
     * @type {ByteQueue}
     */
    this.kbd_buffer = new ByteQueue(1024)

    this.last_port60_byte = 0

    /** @type {number} */
    this.sample_rate = 100

    /** @type {number} */
    this.resolution = 4

    /** @type {boolean} */
    this.scaling2 = false

    /** @type {number} */
    this.last_mouse_packet = -1

    /**
     * @type {ByteQueue}
     */
    this.mouse_buffer = new ByteQueue(1024)

    /**
     * @type {boolean}
     * Also known as DBBOUT OBF - Output Buffer Full flag
     */
    this.next_byte_is_ready = false

    /** @type {boolean} */
    this.next_byte_is_aux = false

    this.bus.register(
      'keyboard-code',
      function (code) {
        this.kbd_send_code(code)
      },
      this
    )

    this.bus.register(
      'mouse-click',
      function (data) {
        this.mouse_send_click(data[0], data[1], data[2])
      },
      this
    )

    this.bus.register(
      'mouse-delta',
      function (data) {
        this.mouse_send_delta(data[0], data[1])
      },
      this
    )

    this.bus.register(
      'mouse-wheel',
      // eslint-disable-next-line no-unused-vars
      function (data) {
        // TODO: Mouse Wheel
        // http://www.computer-engineering.org/ps2mouse/
      },
      this
    )

    this.command_register = 1 | 4
    this.read_output_register = false
    this.read_command_register = false

    cpu.io.register_read(0x60, this, this.port60_read)
    cpu.io.register_read(0x64, this, this.port64_read)

    cpu.io.register_write(0x60, this, this.port60_write)
    cpu.io.register_write(0x64, this, this.port64_write)
  }

  get_state() {
    let state = []

    state[0] = this.enable_mouse_stream
    state[1] = this.use_mouse
    state[2] = this.have_mouse
    state[3] = this.mouse_delta_x
    state[4] = this.mouse_delta_y
    state[5] = this.mouse_clicks
    state[6] = this.have_keyboard
    state[7] = this.enable_keyboard_stream
    state[8] = this.next_is_mouse_command
    state[9] = this.next_read_sample
    state[10] = this.next_read_led
    state[11] = this.next_handle_scan_code_set
    state[12] = this.next_read_rate
    state[13] = this.next_read_resolution
    //state[14] = this.kbd_buffer;
    state[15] = this.last_port60_byte
    state[16] = this.sample_rate
    state[17] = this.resolution
    state[18] = this.scaling2
    //state[19] = this.mouse_buffer;
    state[20] = this.command_register
    state[21] = this.read_output_register
    state[22] = this.read_command_register

    return state
  }

  set_state(state) {
    this.enable_mouse_stream = state[0]
    this.use_mouse = state[1]
    this.have_mouse = state[2]
    this.mouse_delta_x = state[3]
    this.mouse_delta_y = state[4]
    this.mouse_clicks = state[5]
    this.have_keyboard = state[6]
    this.enable_keyboard_stream = state[7]
    this.next_is_mouse_command = state[8]
    this.next_read_sample = state[9]
    this.next_read_led = state[10]
    this.next_handle_scan_code_set = state[11]
    this.next_read_rate = state[12]
    this.next_read_resolution = state[13]
    //this.kbd_buffer = state[14];
    this.last_port60_byte = state[15]
    this.sample_rate = state[16]
    this.resolution = state[17]
    this.scaling2 = state[18]
    //this.mouse_buffer = state[19];
    this.command_register = state[20]
    this.read_output_register = state[21]
    this.read_command_register = state[22]

    this.next_byte_is_ready = false
    this.next_byte_is_aux = false
    this.kbd_buffer.clear()
    this.mouse_buffer.clear()

    this.bus.send('mouse-enable', this.use_mouse)
  }

  raise_irq() {
    if (this.next_byte_is_ready) {
      // Wait until previous byte is read
      // http://halicery.com/Hardware/8042/8042_1503033_TXT.htm
      return
    }

    // Kbd has priority over aux
    if (this.kbd_buffer.length) {
      this.kbd_irq()
    } else if (this.mouse_buffer.length) {
      this.mouse_irq()
    }
  }

  mouse_irq() {
    this.next_byte_is_ready = true
    this.next_byte_is_aux = true

    if (this.command_register & 2) {
      dbg_log('Mouse irq', LOG_PS2)

      // Pulse the irq line
      // Note: can't lower immediately after rising, so lower before rising
      // http://www.os2museum.com/wp/ibm-ps2-model-50-keyboard-controller/
      this.cpu.device_lower_irq(12)
      this.cpu.device_raise_irq(12)
    }
  }

  kbd_irq() {
    this.next_byte_is_ready = true
    this.next_byte_is_aux = false

    if (this.command_register & 1) {
      dbg_log('Keyboard irq', LOG_PS2)

      // Pulse the irq line
      // Note: can't lower immediately after rising, so lower before rising
      // http://www.os2museum.com/wp/ibm-ps2-model-50-keyboard-controller/
      this.cpu.device_lower_irq(1)
      this.cpu.device_raise_irq(1)
    }
  }

  kbd_send_code(code) {
    if (this.enable_keyboard_stream) {
      dbg_log('adding kbd code: ' + h(code), LOG_PS2)
      this.kbd_buffer.push(code)
      this.raise_irq()
    }
  }

  mouse_send_delta(delta_x, delta_y) {
    if (!this.have_mouse || !this.use_mouse) {
      return
    }

    // note: delta_x or delta_y can be floating point numbers

    let factor = (this.resolution * this.sample_rate) / 80

    this.mouse_delta_x += delta_x * factor
    this.mouse_delta_y += delta_y * factor

    if (this.enable_mouse_stream) {
      let change_x = this.mouse_delta_x | 0,
        change_y = this.mouse_delta_y | 0

      if (change_x || change_y) {
        // let now = Date.now()

        //if(now - this.last_mouse_packet < 1000 / this.sample_rate)
        //{
        //    // TODO: set timeout
        //    return;
        //}

        this.mouse_delta_x -= change_x
        this.mouse_delta_y -= change_y

        this.send_mouse_packet(change_x, change_y)
      }
    }
  }

  mouse_send_click(left, middle, right) {
    if (!this.have_mouse || !this.use_mouse) {
      return
    }

    this.mouse_clicks = left | (right << 1) | (middle << 2)

    if (this.enable_mouse_stream) {
      this.send_mouse_packet(0, 0)
    }
  }

  send_mouse_packet(dx, dy) {
    let info_byte =
        ((dy < 0) << 5) | ((dx < 0) << 4) | (1 << 3) | this.mouse_clicks,
      delta_x = dx,
      delta_y = dy

    this.last_mouse_packet = Date.now()

    //if(this.scaling2)
    //{
    //    // only in automatic packets, not 0xEB requests
    //    delta_x = this.apply_scaling2(delta_x);
    //    delta_y = this.apply_scaling2(delta_y);
    //}

    this.mouse_buffer.push(info_byte)
    this.mouse_buffer.push(delta_x)
    this.mouse_buffer.push(delta_y)

    if (PS2_LOG_VERBOSE) {
      dbg_log('adding mouse packets: ' + [info_byte, dx, dy], LOG_PS2)
    }

    this.raise_irq()
  }

  apply_scaling2(n) {
    // http://www.computer-engineering.org/ps2mouse/#Inputs.2C_Resolution.2C_and_Scaling
    let abs = Math.abs(n),
      sign = n >> 31

    switch (abs) {
      case 0:
      case 1:
      case 3:
        return n
      case 2:
        return sign
      case 4:
        return 6 * sign
      case 5:
        return 9 * sign
      default:
        return n << 1
    }
  }

  port60_read() {
    //dbg_log("port 60 read: " + (buffer[0] || "(none)"));

    this.next_byte_is_ready = false

    if (!this.kbd_buffer.length && !this.mouse_buffer.length) {
      // should not happen
      dbg_log('Port 60 read: Empty', LOG_PS2)
      return this.last_port60_byte
    }

    if (this.next_byte_is_aux) {
      this.cpu.device_lower_irq(12)
      this.last_port60_byte = this.mouse_buffer.shift()
      dbg_log('Port 60 read (mouse): ' + h(this.last_port60_byte), LOG_PS2)
    } else {
      this.cpu.device_lower_irq(1)
      this.last_port60_byte = this.kbd_buffer.shift()
      dbg_log('Port 60 read (kbd)  : ' + h(this.last_port60_byte), LOG_PS2)
    }

    if (this.kbd_buffer.length || this.mouse_buffer.length) {
      this.raise_irq()
    }

    return this.last_port60_byte
  }

  port64_read() {
    // status port

    let status_byte = 0x10

    if (this.next_byte_is_ready) {
      status_byte |= 0x1
    }
    if (this.next_byte_is_aux) {
      status_byte |= 0x20
    }

    dbg_log('port 64 read: ' + h(status_byte), LOG_PS2)

    return status_byte
  }

  port60_write(write_byte) {
    dbg_log('port 60 write: ' + h(write_byte), LOG_PS2)

    if (this.read_command_register) {
      this.command_register = write_byte
      this.read_command_register = false

      // not sure, causes "spurious ack" in Linux
      //this.kbd_buffer.push(0xFA);
      //this.kbd_irq();

      dbg_log(
        'Keyboard command register = ' + h(this.command_register),
        LOG_PS2
      )
    } else if (this.read_output_register) {
      this.read_output_register = false

      this.mouse_buffer.clear()
      this.mouse_buffer.push(write_byte)
      this.mouse_irq()
    } else if (this.next_read_sample) {
      this.next_read_sample = false
      this.mouse_buffer.clear()
      this.mouse_buffer.push(0xfa)

      this.sample_rate = write_byte
      dbg_log('mouse sample rate: ' + h(write_byte), LOG_PS2)
      if (!this.sample_rate) {
        dbg_log('invalid sample rate, reset to 100', LOG_PS2)
        this.sample_rate = 100
      }
      this.mouse_irq()
    } else if (this.next_read_resolution) {
      this.next_read_resolution = false
      this.mouse_buffer.clear()
      this.mouse_buffer.push(0xfa)

      if (write_byte > 3) {
        this.resolution = 4
        dbg_log('invalid resolution, resetting to 4', LOG_PS2)
      } else {
        this.resolution = 1 << write_byte
        dbg_log('resolution: ' + this.resolution, LOG_PS2)
      }
      this.mouse_irq()
    } else if (this.next_read_led) {
      // nope
      this.next_read_led = false
      this.kbd_buffer.push(0xfa)
      this.kbd_irq()
    } else if (this.next_handle_scan_code_set) {
      this.next_handle_scan_code_set = false

      this.kbd_buffer.push(0xfa)
      this.kbd_irq()

      if (write_byte) {
        // set scan code set
      } else {
        this.kbd_buffer.push(2)
      }
    } else if (this.next_read_rate) {
      // nope
      this.next_read_rate = false
      this.kbd_buffer.push(0xfa)
      this.kbd_irq()
    } else if (this.next_is_mouse_command) {
      this.next_is_mouse_command = false
      dbg_log('Port 60 data register write: ' + h(write_byte), LOG_PS2)

      if (!this.have_mouse) {
        return
      }

      // send ack
      this.kbd_buffer.clear()
      this.mouse_buffer.clear()
      this.mouse_buffer.push(0xfa)

      switch (write_byte) {
        case 0xe6:
          // set scaling to 1:1
          dbg_log('Scaling 1:1', LOG_PS2)
          this.scaling2 = false
          break
        case 0xe7:
          // set scaling to 2:1
          dbg_log('Scaling 2:1', LOG_PS2)
          this.scaling2 = true
          break
        case 0xe8:
          // set mouse resolution
          this.next_read_resolution = true
          break
        case 0xe9:
          // status request - send one packet
          this.send_mouse_packet(0, 0)
          break
        case 0xeb:
          // request single packet
          dbg_log('unimplemented request single packet', LOG_PS2)
          this.send_mouse_packet(0, 0)
          break
        case 0xf2:
          //  MouseID Byte
          this.mouse_buffer.push(0)
          this.mouse_buffer.push(0)

          this.mouse_clicks = this.mouse_delta_x = this.mouse_delta_y = 0
          break
        case 0xf3:
          // sample rate
          this.next_read_sample = true
          break
        case 0xf4:
          // enable streaming
          this.enable_mouse_stream = true
          this.use_mouse = true
          this.bus.send('mouse-enable', true)

          this.mouse_clicks = this.mouse_delta_x = this.mouse_delta_y = 0
          break
        case 0xf5:
          // disable streaming
          this.enable_mouse_stream = false
          break
        case 0xf6:
          // set defaults
          this.enable_mouse_stream = false
          this.sample_rate = 100
          this.scaling2 = false
          this.resolution = 4
          break
        case 0xff:
          // reset, send completion code
          dbg_log('Mouse reset', LOG_PS2)
          this.mouse_buffer.push(0xaa)
          this.mouse_buffer.push(0)

          this.use_mouse = true
          this.bus.send('mouse-enable', true)

          this.enable_mouse_stream = false
          this.sample_rate = 100
          this.scaling2 = false
          this.resolution = 4

          this.mouse_clicks = this.mouse_delta_x = this.mouse_delta_y = 0
          break

        default:
          dbg_log('Unimplemented mouse command: ' + h(write_byte), LOG_PS2)
      }

      this.mouse_irq()
    } else {
      dbg_log('Port 60 data register write: ' + h(write_byte), LOG_PS2)

      // send ack
      this.mouse_buffer.clear()
      this.kbd_buffer.clear()
      this.kbd_buffer.push(0xfa)

      switch (write_byte) {
        case 0xed:
          this.next_read_led = true
          break
        case 0xf0:
          // get/set scan code set
          this.next_handle_scan_code_set = true
          break
        case 0xf2:
          // identify
          this.kbd_buffer.push(0xab)
          this.kbd_buffer.push(83)
          break
        case 0xf3:
          //  Set typematic rate and delay
          this.next_read_rate = true
          break
        case 0xf4:
          // enable scanning
          dbg_log('kbd enable scanning', LOG_PS2)
          this.enable_keyboard_stream = true
          break
        case 0xf5:
          // disable scanning
          dbg_log('kbd disable scanning', LOG_PS2)
          this.enable_keyboard_stream = false
          break
        case 0xf6:
          // reset defaults
          //this.enable_keyboard_stream = false;
          break
        case 0xff:
          this.kbd_buffer.clear()
          this.kbd_buffer.push(0xfa)
          this.kbd_buffer.push(0xaa)
          this.kbd_buffer.push(0)
          break
        default:
          dbg_log('Unimplemented keyboard command: ' + h(write_byte), LOG_PS2)
      }

      this.kbd_irq()
    }
  }

  port64_write(write_byte) {
    dbg_log('port 64 write: ' + h(write_byte), LOG_PS2)

    switch (write_byte) {
      case 0x20:
        this.kbd_buffer.clear()
        this.mouse_buffer.clear()
        this.kbd_buffer.push(this.command_register)
        this.kbd_irq()
        break
      case 0x60:
        this.read_command_register = true
        break
      case 0xd3:
        this.read_output_register = true
        break
      case 0xd4:
        this.next_is_mouse_command = true
        break
      case 0xa7:
        // Disable second port
        dbg_log('Disable second port', LOG_PS2)
        this.command_register |= 0x20
        break
      case 0xa8:
        // Enable second port
        dbg_log('Enable second port', LOG_PS2)
        this.command_register &= ~0x20
        break
      case 0xa9:
        // test second ps/2 port
        this.kbd_buffer.clear()
        this.mouse_buffer.clear()
        this.kbd_buffer.push(0)
        this.kbd_irq()
        break
      case 0xaa:
        this.kbd_buffer.clear()
        this.mouse_buffer.clear()
        this.kbd_buffer.push(0x55)
        this.kbd_irq()
        break
      case 0xab:
        // Test first PS/2 port
        this.kbd_buffer.clear()
        this.mouse_buffer.clear()
        this.kbd_buffer.push(0)
        this.kbd_irq()
        break
      case 0xad:
        // Disable Keyboard
        dbg_log('Disable Keyboard', LOG_PS2)
        this.command_register |= 0x10
        break
      case 0xae:
        // Enable Keyboard
        dbg_log('Enable Keyboard', LOG_PS2)
        this.command_register &= ~0x10
        break
      case 0xfe:
        dbg_log('CPU reboot via PS2')
        this.cpu.reboot_internal()
        break
      default:
        dbg_log(
          'port 64: Unimplemented command byte: ' + h(write_byte),
          LOG_PS2
        )
    }
  }
}
