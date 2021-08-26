import { dbg_assert } from '../log'

export function load_file(filename, options) {
  if (typeof XMLHttpRequest === 'undefined') {
    return load_file_xhr(filename, options)
  }

  return load_file_nodejs(filename, options)
}

/**
 * @param {string} filename
 * @param {Object} options
 */
export function load_file_xhr(filename, options) {
  let http = new XMLHttpRequest()

  http.open(options.method || 'get', filename, true)

  if (options.as_json) {
    http.responseType = 'json'
  } else {
    http.responseType = 'arraybuffer'
  }

  if (options.headers) {
    let header_names = Object.keys(options.headers)

    for (let i = 0; i < header_names.length; i++) {
      let name = header_names[i]
      http.setRequestHeader(name, options.headers[name])
    }
  }

  if (options.range) {
    let start = options.range.start
    let end = start + options.range.length - 1
    http.setRequestHeader('Range', 'bytes=' + start + '-' + end)

    // Abort if server responds with complete file in response to range
    // request, to prevent downloading large files from broken http servers
    http.onreadystatechange = function () {
      if (http.status === 200) {
        http.abort()
      }
    }
  }

  http.onload = function () {
    if (http.readyState === 4) {
      if (http.status !== 200 && http.status !== 206) {
        console.error(
          'Loading the image `' + filename + '` failed (status %d)',
          http.status
        )
      } else if (http.response) {
        if (options.done) options.done(http.response, http)
      }
    }
  }

  if (options.progress) {
    http.onprogress = function (e) {
      options.progress(e)
    }
  }

  http.send(null)
}

export function load_file_nodejs(filename, options) {
  let fs = require('fs')

  if (options.range) {
    dbg_assert(!options.as_json)

    fs['open'](filename, 'r', (err, fd) => {
      if (err) throw err

      let length = options.range.length
      let buffer = Buffer.allocUnsafe(length)

      fs['read'](
        fd,
        buffer,
        0,
        length,
        options.range.start,
        (err, bytes_read) => {
          if (err) throw err

          dbg_assert(bytes_read === length)
          if (options.done) options.done(new Uint8Array(buffer))

          fs['close'](fd, (err) => {
            if (err) throw err
          })
        }
      )
    })
  } else {
    let o = {
      encoding: options.as_json ? 'utf-8' : null,
    }

    fs['readFile'](filename, o, function (err, data) {
      if (err) {
        console.log('Could not read file:', filename, err)
      } else {
        let result = data

        if (options.as_json) {
          result = JSON.parse(result)
        } else {
          result = new Uint8Array(result).buffer
        }

        options.done(result)
      }
    })
  }
}
