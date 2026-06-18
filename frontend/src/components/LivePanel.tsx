import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDeviceCapabilities, Device } from '../lib/api'
import H264Canvas from './H264Canvas'
import H264Player from './H264Player'

// WebCodecs (the smooth canvas path) only exists in a secure context
// (HTTPS / localhost). On plain http://<lan-ip> we fall back to the MSE/jmuxer
// path, which works over http but drifts a little.
const CAN_WEBCODECS =
  typeof window !== 'undefined' && window.isSecureContext && 'VideoDecoder' in window

type Mode = 'auto' | 'screenshot' | 'off'

const MODES: { key: Mode; label: string }[] = [
  { key: 'auto', label: '自动' },
  { key: 'screenshot', label: '截图' },
  { key: 'off', label: '关' },
]

// H.264 screenrecord stream over WebSocket (under /v1 — already ws-proxied).
function h264WsUrl(id: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/v1/devices/${id}/live?source=auto`
}

// Screenshot mode: poll single JPEG frames (chained on load/error) instead of a
// long-lived MJPEG stream — short requests that complete cleanly, so they never
// hog the browser's per-origin connection pool (which froze the whole UI).
function ScreenshotView({ deviceId, source }: { deviceId: string; source: 'screenshot' | 'auto' }) {
  const imgRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    let alive = true
    let timer: number
    const img = imgRef.current
    if (!img) return
    const load = () => {
      if (alive) img.src = `/api/devices/${deviceId}/screenshot.jpg?source=${source}&t=${Date.now()}`
    }
    const next = () => { if (alive) timer = window.setTimeout(load, 700) }
    img.addEventListener('load', next)
    img.addEventListener('error', next)
    load()
    return () => {
      alive = false
      clearTimeout(timer)
      img.removeEventListener('load', next)
      img.removeEventListener('error', next)
    }
  }, [deviceId, source])
  return <img ref={imgRef} alt="device screen" className="absolute inset-0 w-full h-full object-contain" />
}

export default function LivePanel({ device }: { device: Device | null }) {
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem('live-mode') as Mode) || 'off',
  )
  const [reloadKey, setReloadKey] = useState(0)
  const [adbFailed, setAdbFailed] = useState(false)

  const { data: caps } = useQuery({
    queryKey: ['device-caps', device?.id],
    queryFn: () => fetchDeviceCapabilities(device!.id),
    enabled: !!device,
    refetchInterval: 5000,
  })

  // Reset the ADB-failed fallback whenever the device or mode changes.
  useEffect(() => { setAdbFailed(false) }, [device?.id, mode])

  const pick = (m: Mode) => {
    setMode(m)
    localStorage.setItem('live-mode', m)
    setReloadKey(k => k + 1) // force the stream to reconnect
  }

  const online = device?.status === 'online'
  // Backend auto-picks ADB only when exactly one adb device is attached.
  const usingAdb = mode === 'auto' && caps?.adb_serials?.length === 1 && !adbFailed
  const canStream = !!device && mode !== 'off' && (online || usingAdb)

  return (
    <div className="bg-white border rounded-lg p-3 lg:sticky lg:top-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">实时画面</span>
        <div className="flex rounded-md border overflow-hidden text-xs">
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => pick(m.key)}
              className={`px-2.5 py-1 transition-colors ${
                mode === m.key
                  ? 'bg-primary text-white'
                  : 'bg-white text-ink-mute hover:bg-gray-50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Portrait phone frame */}
      <div
        className="relative mx-auto rounded-xl bg-terminal overflow-hidden border border-hairline-strong"
        style={{ aspectRatio: '9 / 19.5', maxWidth: 300 }}
      >
        {!device ? (
          <Placeholder text="选择左侧一台设备" />
        ) : mode === 'off' ? (
          <Placeholder text="已关闭 — 选「自动」或「截图」开启" />
        ) : !canStream ? (
          <Placeholder text="设备离线，无法取流" />
        ) : usingAdb ? (
          CAN_WEBCODECS ? (
            <H264Canvas
              key={`${device.id}-h264-${reloadKey}`}
              wsUrl={h264WsUrl(device.id)}
              onFail={() => setAdbFailed(true)}
            />
          ) : (
            <H264Player
              key={`${device.id}-h264-${reloadKey}`}
              wsUrl={h264WsUrl(device.id)}
              onFail={() => setAdbFailed(true)}
            />
          )
        ) : (
          <ScreenshotView
            key={`${device.id}-shot-${reloadKey}`}
            deviceId={device.id}
            source="screenshot"
          />
        )}
      </div>

      {/* Status line */}
      <div className="mt-2 text-center text-xs text-gray-400 font-mono">
        {device && mode !== 'off' && canStream
          ? usingAdb
            ? 'ADB · 实时录屏 H.264'
            : '截图 · ~1 fps'
          : caps && !caps.adb_available && mode === 'auto'
            ? '无 ADB，自动回落截图'
            : ' '}
      </div>
    </div>
  )
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-terminal-mute font-mono">
      {text}
    </div>
  )
}
