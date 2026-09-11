const ALPHABET = 'useandom26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'

/** URL-safe random id, 12 chars by default (~72 bits). */
export function newId(size = 12): string {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i] & 63]
  return id
}
