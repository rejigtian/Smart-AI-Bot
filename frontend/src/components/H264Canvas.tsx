import { useEffect, useRef } from 'react'

// Low-latency live screen, scrcpy / Android-Studio style: decode each H.264
// access unit with WebCodecs and blit the VideoFrame straight to a <canvas>.
// No MSE, no media timeline, no playback buffer → "frame in, frame out", so it
// never drifts behind the device the way the <video>/jmuxer path did.
//
// onFail fires if WebCodecs is unavailable or the backend reports no ADB (4404),
// so the panel can fall back to screenshot polling.
export default function H264Canvas({ wsUrl, onFail }: { wsUrl: string; onFail?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (typeof (window as unknown as { VideoDecoder?: unknown }).VideoDecoder === 'undefined') {
      onFailRef.current?.()  // no WebCodecs → screenshot fallback
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let closedByUs = false
    let retry: number | undefined
    let ws: WebSocket | null = null
    let decoder: VideoDecoder | null = null
    let sps: Uint8Array | null = null
    let pps: Uint8Array | null = null
    let ts = 0
    let buf = new Uint8Array(0)

    const startLen = (a: Uint8Array, i: number) =>
      a[i] === 0 && a[i + 1] === 0 && a[i + 2] === 1 ? 3
        : a[i] === 0 && a[i + 1] === 0 && a[i + 2] === 0 && a[i + 3] === 1 ? 4 : 0

    const hex2 = (n: number) => n.toString(16).padStart(2, '0')

    const ensureDecoder = (spsNal: Uint8Array) => {
      if (decoder) return
      decoder = new VideoDecoder({
        output: frame => {
          if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth
          if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight
          ctx.drawImage(frame, 0, 0)
          frame.close()
        },
        error: () => {},
      })
      // codec string from SPS: avc1.<profile><constraints><level>
      decoder.configure({
        codec: `avc1.${hex2(spsNal[1])}${hex2(spsNal[2])}${hex2(spsNal[3])}`,
        optimizeForLatency: true,
      })
    }

    const annexb = (...nals: Uint8Array[]) => {
      let len = 0
      for (const n of nals) len += 4 + n.length
      const out = new Uint8Array(len)
      let o = 0
      for (const n of nals) { out.set([0, 0, 0, 1], o); out.set(n, o + 4); o += 4 + n.length }
      return out
    }

    const handleNal = (nal: Uint8Array) => {
      if (nal.length === 0) return
      const type = nal[0] & 0x1f
      if (type === 7) { sps = nal; ensureDecoder(nal); return }
      if (type === 8) { pps = nal; return }
      if ((type === 5 || type === 1) && decoder && decoder.state === 'configured') {
        const key = type === 5
        const data = key && sps && pps ? annexb(sps, pps, nal) : annexb(nal)
        try {
          decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: ts, data }))
          ts += Math.round(1e6 / 32)
        } catch { /* decoder not ready for a delta before a keyframe */ }
      }
    }

    const feed = (chunk: Uint8Array) => {
      const merged = new Uint8Array(buf.length + chunk.length)
      merged.set(buf); merged.set(chunk, buf.length); buf = merged

      const marks: { pos: number; len: number }[] = []
      let i = 0
      while (i + 3 < buf.length) {
        const l = startLen(buf, i)
        if (l) { marks.push({ pos: i, len: l }); i += l } else i++
      }
      if (marks.length < 2) return
      for (let k = 0; k < marks.length - 1; k++) {
        handleNal(buf.subarray(marks[k].pos + marks[k].len, marks[k + 1].pos))
      }
      buf = buf.slice(marks[marks.length - 1].pos)  // keep last (possibly partial) NAL
    }

    const connect = () => {
      ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      ws.onmessage = e => feed(new Uint8Array(e.data as ArrayBuffer))
      ws.onclose = ev => {
        if (closedByUs) return
        if (ev.code === 4404) { onFailRef.current?.(); return }
        retry = window.setTimeout(connect, 1000)
      }
      ws.onerror = () => {}
    }
    connect()

    return () => {
      closedByUs = true
      clearTimeout(retry)
      ws?.close()
      try { decoder?.close() } catch { /* already closed */ }
    }
  }, [wsUrl])

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain" />
}
