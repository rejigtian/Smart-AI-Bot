import { useState, useEffect, useMemo } from 'react'
import { StepLog } from '../lib/api'
import { useT } from '../lib/i18n'

interface Frame { b64: string; label: string; fn: string }

// Plays back a finished run's per-step screenshots as a timeline (works for any
// device, including remote — the frames already exist). The real-video replay
// (ADB recording) is layered on top of this where available.
export default function ScreenshotReplay({
  steps, finalShot, hasSelection, videoUrl,
}: { steps: StepLog[]; finalShot?: string; hasSelection: boolean; videoUrl?: string }) {
  const t = useT()
  const [tab, setTab] = useState<'video' | 'shots'>(videoUrl ? 'video' : 'shots')
  // Fall back to screenshots if there's no recording.
  const showVideo = tab === 'video' && !!videoUrl
  const frames = useMemo<Frame[]>(() => {
    const f: Frame[] = steps
      .filter(s => s.screenshot_b64)
      .map(s => ({ b64: s.screenshot_b64, label: `Step ${s.step}`, fn: s.action.match(/^\w+/)?.[0] ?? '' }))
    if (finalShot) f.push({ b64: finalShot, label: 'Final', fn: '' })
    return f
  }, [steps, finalShot])

  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  // Reset when the selected case (its steps) changes.
  useEffect(() => { setIdx(0); setPlaying(false) }, [steps])

  useEffect(() => {
    if (!playing || frames.length === 0) return
    const t = setTimeout(() => {
      setIdx(i => {
        if (i + 1 >= frames.length) { setPlaying(false); return i }
        return i + 1
      })
    }, 900)
    return () => clearTimeout(t)
  }, [playing, idx, frames.length])

  const cur = frames[idx]
  const btn = 'px-2.5 py-1.5 border rounded text-sm text-ink-mute hover:bg-gray-50 disabled:opacity-40'

  return (
    <div className="bg-white border rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">{t('录屏回放', 'Recording replay')}</span>
        {videoUrl ? (
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(['video', 'shots'] as const).map(tabKey => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className={`px-2.5 py-1 ${tab === tabKey ? 'bg-primary text-white' : 'bg-white text-ink-mute hover:bg-gray-50'}`}
              >
                {tabKey === 'video' ? t('视频', 'Video') : t('截图', 'Screenshot')}
              </button>
            ))}
          </div>
        ) : frames.length > 0 ? (
          <span className="text-xs text-gray-400 font-mono">{idx + 1}/{frames.length}</span>
        ) : null}
      </div>

      <div
        className="relative mx-auto rounded-xl bg-terminal overflow-hidden border border-hairline-strong"
        style={{ aspectRatio: '9 / 19.5', maxWidth: 300 }}
      >
        {showVideo ? (
          <video
            src={videoUrl}
            controls
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-contain bg-black"
          />
        ) : !hasSelection ? (
          <Center text={t('选择左侧一个用例查看回放', 'Select a case on the left to view its replay')} />
        ) : frames.length === 0 ? (
          <Center text={t('该用例无截图帧', 'This case has no screenshot frames')} />
        ) : (
          <img
            src={`data:image/png;base64,${cur.b64}`}
            alt={cur.label}
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}
      </div>

      {!showVideo && frames.length > 0 && (
        <>
          <div className="flex items-center gap-2 mt-3">
            <button className={btn} disabled={idx === 0} onClick={() => { setPlaying(false); setIdx(i => Math.max(0, i - 1)) }}>‹</button>
            <button
              className="flex-1 px-3 py-1.5 bg-primary text-white rounded text-sm hover:bg-primary-deep"
              onClick={() => { if (idx >= frames.length - 1) setIdx(0); setPlaying(p => !p) }}
            >
              {playing ? t('⏸ 暂停', '⏸ Pause') : t('▶ 播放', '▶ Play')}
            </button>
            <button className={btn} disabled={idx >= frames.length - 1} onClick={() => { setPlaying(false); setIdx(i => Math.min(frames.length - 1, i + 1)) }}>›</button>
          </div>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={idx}
            onChange={e => { setPlaying(false); setIdx(Number(e.target.value)) }}
            className="w-full mt-3 accent-primary"
          />
          <div className="text-xs text-gray-400 font-mono mt-1 text-center truncate">
            {cur.label}{cur.fn ? ` · ${cur.fn}` : ''}
          </div>
        </>
      )}
    </div>
  )
}

function Center({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-terminal-mute font-mono">
      {text}
    </div>
  )
}
