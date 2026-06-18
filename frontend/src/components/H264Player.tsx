import { useEffect, useRef } from 'react'
import JMuxer from 'jmuxer'

// Plays the backend's H.264 screenrecord stream: a WebSocket delivers raw H.264
// NAL units, jmuxer wraps them into fMP4 fed to a <video> via MSE.
//
// `onFail` fires ONLY when the backend explicitly closes with 4404 (no usable
// ADB) so the panel can fall back to screenshots. Every other close (React
// StrictMode teardown, a Vite-proxy drop, screenrecord's 3-min cycle) is
// transient and auto-reconnects — treating those as failure wrongly stuck the
// panel in screenshot mode.
export default function H264Player({ wsUrl, onFail }: { wsUrl: string; onFail?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail

  useEffect(() => {
    const node = videoRef.current
    if (!node) return

    let closedByUs = false
    let retry: number | undefined
    let ws: WebSocket | null = null

    // flushingTime must be a positive number: jmuxer does `flushingTime || 1500`,
    // so 0 silently becomes 1500ms → the video only updated every 1.5s (visible
    // "stutter every 1.5s"). 1ms ≈ flush on every fed chunk → smooth.
    // fps ≈ screenrecord's real capture rate (~32 on most devices). The raw H.264
    // stream carries no timestamps, so jmuxer times frames by this value.
    const muxer = new JMuxer({ node, mode: 'video', flushingTime: 1, fps: 32, clearBuffer: true, debug: false })

    // Live-edge sync: frames arrive slightly faster than they play, so MSE buffer
    // grows and the video drifts ever further behind the device ("much slower").
    // Keep playback pinned near the newest buffered frame.
    const sync = window.setInterval(() => {
      const b = node.buffered
      if (b.length === 0) return
      const end = b.end(b.length - 1)
      const lag = end - node.currentTime
      if (lag > 1.0) {
        node.currentTime = end - 0.05   // too far behind → jump to live edge
        node.playbackRate = 1.0
      } else if (lag > 0.35) {
        node.playbackRate = 1.4         // mildly behind → gently catch up
      } else {
        node.playbackRate = 1.0
      }
    }, 1000)

    const connect = () => {
      ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      ws.onmessage = e => muxer.feed({ video: new Uint8Array(e.data as ArrayBuffer) })
      ws.onclose = e => {
        if (closedByUs) return
        if (e.code === 4404) { onFailRef.current?.(); return }  // backend: no ADB → fall back
        retry = window.setTimeout(connect, 1000)       // transient → reconnect
      }
      // onerror is followed by onclose; let onclose decide. Closing a still-
      // connecting socket (StrictMode) fires onerror — must NOT be fatal.
      ws.onerror = () => {}
    }
    connect()

    return () => {
      closedByUs = true
      clearTimeout(retry)
      clearInterval(sync)
      ws?.close()
      muxer.destroy()
    }
  }, [wsUrl])

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className="absolute inset-0 w-full h-full object-contain"
    />
  )
}
