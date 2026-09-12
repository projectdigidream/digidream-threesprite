// 64 symbols exactly, so a 6-bit random value always maps to one of them.
const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'

if (ALPHABET.length !== 64) throw new Error('id alphabet must have 64 symbols')

/** URL- and file-name-safe random id, 12 chars by default (~72 bits). */
export function newId(size = 12): string {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i] & 63]
  return id
}

export const ID_RE = /^[A-Za-z0-9_-]+$/
