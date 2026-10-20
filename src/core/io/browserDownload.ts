import { hostFiles } from './sink'

/** Hand the browser a file to save (web build only), or the embedding host when there is one. */
export function downloadBytes(name: string, bytes: Uint8Array, mime = 'application/octet-stream'): void {
  const host = hostFiles()
  if (host) { void host.save(name, bytes); return }
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
