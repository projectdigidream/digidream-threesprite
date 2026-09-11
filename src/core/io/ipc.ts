/**
 * Binary invoke on every platform. Desktop webviews pass a Uint8Array as a
 * raw request body (zero-copy, ~3 ms per MB). Android's bridge delivers only
 * JSON, so there the bytes travel base64-encoded in `{ b64 }` and binary
 * responses come back the same way.
 */
import { isMobile } from '../platform'

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])
  return btoa(s)
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Invoke a command with a binary payload and a JSON result. */
export async function invokeWithBytes<T>(cmd: string, bytes: Uint8Array): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  if (isMobile()) return invoke<T>(cmd, { b64: bytesToBase64(bytes) })
  return invoke<T>(cmd, bytes)
}

/** Invoke a command with a binary payload and a binary result. */
export async function invokeBytes(cmd: string, bytes: Uint8Array): Promise<Uint8Array> {
  const { invoke } = await import('@tauri-apps/api/core')
  if (isMobile()) {
    const r = await invoke<{ b64: string } | string>(cmd, { b64: bytesToBase64(bytes) })
    const obj = typeof r === 'string' ? (JSON.parse(r) as { b64: string }) : r
    return base64ToBytes(obj.b64)
  }
  const raw = await invoke<ArrayBuffer | Uint8Array | number[]>(cmd, bytes)
  return raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw instanceof Uint8Array ? raw : Uint8Array.from(raw)
}
