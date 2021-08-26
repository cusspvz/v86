import { DEBUG, LOG_LEVEL } from './config'
import { LOG_NAMES, LOG_TO_FILE } from './const'
import { pads, pad0 } from './utils'

let log_data = []

export function do_the_log(message) {
  if (LOG_TO_FILE) {
    log_data.push(message, '\n')
  } else {
    console.log(message)
  }
}

/** @const @type {Object.<number, string>} */
let dbg_names = LOG_NAMES.reduce(function (a, x) {
  a[x[0]] = x[1]
  return a
}, {})

let log_last_message = ''
let log_message_repetitions = 0

/**
 * @type {function((string|number), number=)}
 * @const
 */
export const dbg_log = DEBUG
  ? /**
     * @param {number=} level
     */
    function dbg_log_(stuff, level) {
      if (!DEBUG) return

      level = level || 1

      if (level & LOG_LEVEL) {
        let level_name = dbg_names[level] || '',
          message = '[' + pads(level_name, 4) + '] ' + stuff

        if (message === log_last_message) {
          log_message_repetitions++

          if (log_message_repetitions < 2048) {
            return
          }
        }

        let now = new Date()
        let time_str =
          pad0(now.getHours(), 2) +
          ':' +
          pad0(now.getMinutes(), 2) +
          ':' +
          pad0(now.getSeconds(), 2) +
          '+' +
          pad0(now.getMilliseconds(), 3) +
          ' '

        if (log_message_repetitions) {
          if (log_message_repetitions === 1) {
            do_the_log(time_str + log_last_message)
          } else {
            do_the_log(
              'Previous message repeated ' + log_message_repetitions + ' times'
            )
          }

          log_message_repetitions = 0
        }

        do_the_log(time_str + message)
        log_last_message = message
      }
    }
  : function () {}

/**
 * @param {number=} level
 */
export function dbg_trace(level) {
  if (!DEBUG) return

  dbg_log(Error().stack, level)
}

/**
 * console.assert is fucking slow
 * @param {string=} msg
 * @param {number=} level
 */
// eslint-disable-next-line no-unused-vars
export function dbg_assert(cond, msg, _level) {
  if (!DEBUG) return

  if (!cond) {
    dbg_assert_failed(msg)
  }
}

export function dbg_assert_failed(msg) {
  // eslint-disable-next-line no-debugger
  debugger
  console.trace()

  if (msg) {
    throw 'Assert failed: ' + msg
  } else {
    throw 'Assert failed'
  }
}
