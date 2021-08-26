import { download } from './download'
export function dump_file(ab, name) {
  if (!(ab instanceof Array)) {
    ab = [ab]
  }

  let blob = new Blob(ab)
  download(blob, name)
}
