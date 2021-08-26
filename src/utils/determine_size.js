import { load_file_xhr } from './load_file'

export function determine_size(path, cb) {
  if (typeof XMLHttpRequest === 'undefined') {
    return determine_size_xhr(path, cb)
  }

  return determine_size_nodejs(path, cb)
}

export function determine_size_xhr(url, cb) {
  load_file_xhr(url, {
    done: (buffer, http) => {
      let header = http.getResponseHeader('Content-Range') || ''
      let match = header.match(/\/(\d+)\s*$/)

      if (match) {
        cb(null, +match[1])
      } else {
        const error =
          '`Range: bytes=...` header not supported (Got `' + header + '`)'
        cb(error)
      }
    },
    headers: {
      Range: 'bytes=0-0',
    },
  })
}

export function determine_size_nodejs(path, cb) {
  require('fs')['stat'](path, (err, stats) => {
    if (err) {
      cb(err)
    } else {
      cb(null, stats.size)
    }
  })
}
