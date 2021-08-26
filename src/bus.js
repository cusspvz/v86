import { dbg_assert } from './log'

/** @constructor */
export class BusConnector {
  constructor() {
    this.listeners = {}
    this.pair = undefined
  }

  /**
   * @param {string} name
   * @param {function(?)} fn
   * @param {Object} this_value
   */
  register(name, fn, this_value) {
    let listeners = this.listeners[name]

    if (listeners === undefined) {
      listeners = this.listeners[name] = []
    }

    listeners.push({
      fn: fn,
      this_value: this_value,
    })
  }

  /**
   * Unregister one message with the given name and callback
   *
   * @param {string} name
   * @param {function()} fn
   */
  unregister(name, fn) {
    let listeners = this.listeners[name]

    if (listeners === undefined) {
      return
    }

    this.listeners[name] = listeners.filter(function (l) {
      return l.fn !== fn
    })
  }

  /**
   * Send ("emit") a message
   *
   * @param {string} name
   * @param {*=} value
   * @param {*=} unused_transfer
   */
  // eslint-disable-next-line no-unused-vars
  send(name, value, unused_transfer) {
    if (!this.pair) {
      return
    }

    let listeners = this.pair.listeners[name]

    if (listeners === undefined) {
      return
    }

    for (let i = 0; i < listeners.length; i++) {
      let listener = listeners[i]
      listener.fn.call(listener.this_value, value)
    }
  }

  /**
   * Send a message, guaranteeing that it is received asynchronously
   *
   * @param {string} name
   * @param {Object=} value
   */
  send_async(name, value) {
    dbg_assert(arguments.length === 1 || arguments.length === 2)

    setTimeout(this.send.bind(this, name, value), 0)
  }
}

export function createBus() {
  let c0 = new BusConnector()
  let c1 = new BusConnector()

  c0.pair = c1
  c1.pair = c0

  return [c0, c1]
}
