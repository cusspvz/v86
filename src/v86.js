import { CPU } from './cpu'

/** @const */
const MAGIC_POST_MESSAGE = 0xaa55

/**
 * @constructor
 * @param {Object=} wasm
 */
export class V86 {
  constructor(bus, wasm) {
    /** @type {boolean} */
    this.running = false

    /** @type {boolean} */
    this.stopped = false

    /** @type {CPU} */
    this.cpu = new CPU(bus, wasm)

    this.bus = bus
    bus.register('cpu-init', this.init, this)
    bus.register('cpu-run', this.run, this)
    bus.register('cpu-stop', this.stop, this)
    bus.register('cpu-restart', this.restart, this)

    this.tick = (e) => {
      if (e.source === window && e.data === MAGIC_POST_MESSAGE) {
        this.do_tick()
      }
    }

    this.register_tick()
  }

  run() {
    this.stopped = false

    if (!this.running) {
      this.bus.send('emulator-started')
      this.fast_next_tick()
    }
  }

  do_tick() {
    if (this.stopped) {
      this.stopped = this.running = false
      this.bus.send('emulator-stopped')
      return
    }

    this.running = true
    let dt = this.cpu.main_run()

    if (dt <= 0) {
      this.fast_next_tick()
    } else {
      this.next_tick(dt)
    }
  }

  stop() {
    if (this.running) {
      this.stopped = true
    }
  }

  destroy() {
    this.unregister_tick()
  }

  restart() {
    this.cpu.reset_cpu()
    this.cpu.load_bios()
  }

  init(settings) {
    this.cpu.init(settings, this.bus)
    this.bus.send('emulator-ready')
  }

  save_state() {
    // TODO: Should be implemented here, not on cpu
    return this.cpu.save_state()
  }

  restore_state(state) {
    // TODO: Should be implemented here, not on cpu
    return this.cpu.restore_state(state)
  }

  next_tick(t) {
    if (t < 4 || (typeof document !== 'undefined' && document.hidden)) {
      // Avoid sleeping for 1 second (happens if page is not
      // visible), it can break boot processes. Also don't try to
      // sleep for less than 4ms, since the value is clamped up
      this.fast_next_tick()
    } else {
      setTimeout(() => {
        this.do_tick()
      }, t)
    }
  }

  fast_next_tick() {
    if (typeof setImmediate == 'function') {
      setImmediate(() => {
        this.do_tick()
      })
      return
    }

    window.postMessage(MAGIC_POST_MESSAGE, '*')
  }

  /** @this {v86} */
  register_tick() {
    if (typeof setImmediate == 'function') {
      return
    }

    window.addEventListener('message', this.tick, false)
  }

  /** @this {v86} */
  unregister_tick() {
    if (typeof setImmediate == 'function') {
      return
    }

    window.removeEventListener('message', this.tick)
  }
}
