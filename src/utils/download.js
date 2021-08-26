// TODO: transform this function later
export function download(file_or_blob, name) {
  let a = document.createElement('a')
  a['download'] = name
  a.href = window.URL.createObjectURL(file_or_blob)
  a.dataset['downloadurl'] = [
    'application/octet-stream',
    a['download'],
    a.href,
  ].join(':')

  if (document.createEvent) {
    let ev = document.createEvent('MouseEvent')
    ev.initMouseEvent(
      'click',
      true,
      true,
      window,
      0,
      0,
      0,
      0,
      0,
      false,
      false,
      false,
      false,
      0,
      null
    )
    a.dispatchEvent(ev)
  } else {
    a.click()
  }

  window.URL.revokeObjectURL(a.href)
}
