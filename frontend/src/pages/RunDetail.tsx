import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchRun, fetchResults, fetchSteps, cancelRun, startRun, starResult, fetchDevices, TestResult, StepLog } from '../lib/api'
import StepTreeResultView from '../components/StepTreeResultView'
import LivePanel from '../components/LivePanel'
import ScreenshotReplay from '../components/ScreenshotReplay'

const STATUS_COLOR: Record<string, string> = {
  pass: 'bg-green-100 text-ok',
  fail: 'bg-red-100 text-red-700',
  error: 'bg-orange-100 text-orange-700',
  skip: 'bg-gray-100 text-gray-500',
  pending: 'bg-yellow-50 text-yellow-600',
  running: 'bg-primary-soft text-primary-deep',
  cancelled: 'bg-primary-soft text-primary-deep',
}

const TERMINAL = new Set(['done', 'error', 'cancelled'])

export default function RunDetail() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logRef = useRef<HTMLDivElement>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [logsDone, setLogsDone] = useState(false)
  const [selected, setSelected] = useState<TestResult | null>(null)

  const { data: run, refetch: refetchRun } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => fetchRun(runId!),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return TERMINAL.has(status ?? '') ? false : 3000
    },
  })

  const { data: results = [], refetch: refetchResults } = useQuery({
    queryKey: ['results', runId],
    queryFn: () => fetchResults(runId!),
    refetchInterval: TERMINAL.has(run?.status ?? '') ? false : 3000,
  })

  // The run's device — for the live-screen panel (watch the device during a run).
  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: fetchDevices,
    refetchInterval: 5000,
  })
  const runDevice = devices.find(d => d.id === run?.device_id) ?? null

  // SSE log stream — reconnecting replays full history from the backend buffer
  useEffect(() => {
    if (!runId) return
    setLogs([])
    setLogsDone(false)
    const es = new EventSource(`/api/runs/${runId}/logs`)
    es.onmessage = (e) => {
      if (e.data === '[done]') {
        setLogsDone(true)
        es.close()
        refetchRun()
        refetchResults()
        return
      }
      setLogs(prev => [...prev, e.data])
    }
    es.onerror = () => { setLogsDone(true); es.close() }
    return () => es.close()
  }, [runId])

  // Auto-scroll logs
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [logs])

  const cancelMut = useMutation({
    mutationFn: () => cancelRun(runId!),
    onSettled: () => { refetchRun(); refetchResults() },
  })

  const rerunMut = useMutation({
    mutationFn: () => startRun({
      suite_id: run!.suite_id,
      device_id: run!.device_id,
      provider: run!.provider,
      model: run!.model,
    }),
    onSuccess: (newRun) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
      navigate(`/runs/${newRun.id}`)
    },
  })

  const { data: steps = [] } = useQuery<StepLog[]>({
    queryKey: ['steps', runId, selected?.id],
    queryFn: () => fetchSteps(runId!, selected!.id),
    enabled: !!selected && !!runId,
  })

  const starMut = useMutation({
    mutationFn: (resultId: string) => starResult(runId!, resultId),
    onSuccess: (data) => {
      // Optimistically update local cache
      queryClient.setQueryData<TestResult[]>(['results', runId], (prev) =>
        prev?.map(r => r.id === data.id ? { ...r, is_starred: data.is_starred } : r) ?? []
      )
      // Keep selected panel in sync
      setSelected(prev => prev?.id === data.id ? { ...prev, is_starred: data.is_starred } : prev)
    },
  })

  const statusBadge = (s: string) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[s] ?? 'bg-gray-100 text-gray-500'}`}>
      {s}
    </span>
  )

  const isRunning = run?.status === 'running' || run?.status === 'pending'
  const totalTokens = results.reduce((sum, r) => sum + (r.total_tokens || 0), 0)

  return (
    <div>
      <button className="text-sm text-primary hover:underline mb-4 block" onClick={() => navigate('/suites')}>
        ← Back to suites
      </button>

      {run && (
        <div className="mb-4 flex items-center gap-4 flex-wrap">
          <h1 className="text-xl font-bold">Run</h1>
          {statusBadge(run.status)}
          <span className="text-sm text-gray-500">{run.provider}/{run.model}</span>
          <span className="text-sm text-gray-400">{new Date(run.created_at).toLocaleString()}</span>
          <div className="flex gap-3 text-sm ml-auto items-center">
            <span className="text-ok font-medium">{run.passed} pass</span>
            <span className="text-red-600 font-medium">{run.failed} fail</span>
            {run.errored > 0 && <span className="text-orange-600 font-medium">{run.errored} error</span>}
            {run.skipped > 0 && <span className="text-gray-500">{run.skipped} skip</span>}
            <span className="text-gray-400">/ {run.total} total</span>
            {totalTokens > 0 && <span className="text-primary">{(totalTokens / 1000).toFixed(1)}k tokens</span>}
            {isRunning && (
              <button
                className="ml-2 px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50"
                disabled={cancelMut.isPending}
                onClick={() => cancelMut.mutate()}
              >
                {cancelMut.isPending ? 'Stopping…' : '⏹ Stop'}
              </button>
            )}
            {!isRunning && run && (
              <>
                <button
                  className="ml-2 px-3 py-1 border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-100 disabled:opacity-50"
                  disabled={rerunMut.isPending}
                  onClick={() => rerunMut.mutate()}
                >
                  {rerunMut.isPending ? 'Starting…' : '↩ Run Again'}
                </button>
                <a
                  href={`/api/runs/${runId}/report?download=true`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 px-3 py-1 border border-primary text-primary-deep text-xs rounded hover:bg-primary-soft"
                >
                  ↓ 下载报告
                </a>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-6">
        {/* Left: results table */}
        <div>
          <h2 className="font-semibold mb-2 text-sm text-gray-600 uppercase tracking-wide">Results</h2>
          {run?.suite_id ? (
            <StepTreeResultView
              suiteId={run.suite_id}
              results={results}
              selectedId={selected?.id}
              onSelect={setSelected}
              onStar={(id) => starMut.mutate(id)}
            />
          ) : (
            <div className="bg-white border rounded-lg shadow-sm">
              <p className="text-sm text-gray-400 px-4 py-6 text-center">Waiting for results…</p>
            </div>
          )}
        </div>

        {/* Right: logs or case detail */}
        <div>
          {selected ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="font-semibold text-sm text-gray-600 uppercase tracking-wide">Step Replay</h2>
                <span className="text-xs text-gray-400">{steps.length > 0 ? `${steps.length} steps` : ''}</span>
                <button className="text-xs text-primary hover:underline ml-auto" onClick={() => setSelected(null)}>
                  Show Logs
                </button>
              </div>

              {/* Case meta */}
              <div className="bg-white border rounded-lg px-4 py-3 shadow-sm mb-3 space-y-1">
                <div className="flex items-center gap-2">
                  {statusBadge(selected.status)}
                  <button
                    title={selected.is_starred ? '取消参考标记' : '标记为参考案例'}
                    className={`text-base leading-none transition-colors ${
                      selected.is_starred ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-300'
                    }`}
                    onClick={() => starMut.mutate(selected.id)}
                  >
                    ★
                  </button>
                  {selected.is_starred && (
                    <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">参考案例</span>
                  )}
                  <span className="text-xs text-gray-500 ml-auto">{selected.steps} steps</span>
                </div>
                <p className="text-xs text-gray-500 font-mono truncate">{selected.path}</p>
                <p className="text-sm text-gray-700">{selected.reason}</p>
              </div>

              {/* Step timeline */}
              {steps.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-6">
                  {selected.status === 'pending' || selected.status === 'running'
                    ? 'Waiting for steps…'
                    : 'No step data recorded'}
                </div>
              ) : (
                <div className="space-y-3 overflow-y-auto max-h-[560px] pr-1">
                  {steps.map((sl, idx) => {
                    const fnMatch = sl.action.match(/^(\w+)/)
                    const fnName = fnMatch ? fnMatch[1] : sl.action
                    // Show subgoal header when entering a new subgoal group
                    const showSubgoalHeader = sl.subgoal_index != null && (
                      idx === 0 || steps[idx - 1]?.subgoal_index !== sl.subgoal_index
                    )
                    return (
                      <div key={sl.id}>
                      {showSubgoalHeader && (
                        <div className="flex items-center gap-2 mb-2 mt-1">
                          <span className="text-xs font-bold text-white bg-primary rounded px-2 py-0.5">
                            SubGoal {sl.subgoal_index}
                          </span>
                          <span className="text-xs text-primary-deep truncate">{sl.subgoal_desc}</span>
                        </div>
                      )}
                      <div key={sl.id} className="bg-white border rounded-lg shadow-sm overflow-hidden">
                        {/* Step header */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b">
                          <span className="text-xs font-bold text-white bg-primary rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                            {sl.step}
                          </span>
                          <span className="text-xs font-mono text-primary-deep font-medium">{fnName}</span>
                          <span className="ml-auto flex gap-2 text-[10px] text-gray-400">
                            {sl.total_tokens > 0 && <span title="Tokens">{sl.total_tokens} tok</span>}
                            {sl.llm_ms > 0 && <span title="LLM time">{(sl.llm_ms / 1000).toFixed(1)}s LLM</span>}
                            {sl.perception_ms > 0 && <span title="Perception time">{(sl.perception_ms / 1000).toFixed(1)}s cap</span>}
                            {sl.action_ms > 0 && <span title="Action time">{(sl.action_ms / 1000).toFixed(1)}s act</span>}
                          </span>
                        </div>

                        {/* Screenshot */}
                        {sl.screenshot_b64 && (
                          <img
                            src={`data:image/png;base64,${sl.screenshot_b64}`}
                            alt={`step ${sl.step}`}
                            className="w-full block"
                          />
                        )}

                        {/* Thought */}
                        {sl.thought && (
                          <div className="px-3 pt-2 pb-1">
                            <p className="text-xs text-gray-500 italic leading-relaxed">💭 {sl.thought}</p>
                          </div>
                        )}

                        {/* Action + result */}
                        <div className="px-3 pb-3 pt-1 space-y-1">
                          <p className="text-xs font-mono text-gray-700 break-all">
                            <span className="text-primary">→</span> {sl.action}
                          </p>
                          {sl.action_result && (
                            <p className="text-xs text-ok break-all">
                              <span className="text-ok">↳</span> {sl.action_result}
                            </p>
                          )}
                        </div>
                      </div>
                      </div>
                    )
                  })}

                  {/* Final screenshot if different from last step */}
                  {selected.screenshot_b64 && (
                    <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b">
                        <span className="text-xs font-bold text-white bg-gray-400 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">✓</span>
                        <span className="text-xs text-gray-600 font-medium">Final state</span>
                      </div>
                      <img
                        src={`data:image/png;base64,${selected.screenshot_b64}`}
                        alt="final screenshot"
                        className="w-full block"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 className="font-semibold mb-2 text-xs text-ink-mute uppercase tracking-wider flex items-center gap-2">
                <span className="font-mono text-primary">$</span> Live Logs
                {!logsDone && <span className="text-ok animate-pulse">●</span>}
              </h2>
              <div
                ref={logRef}
                className="bg-terminal text-terminal-text text-xs font-mono rounded-md border border-terminal-line p-4 h-[480px] overflow-y-auto leading-relaxed"
              >
                {logs.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
                {logsDone && <div className="text-terminal-mute mt-2">— stream ended —</div>}
              </div>
            </div>
          )}
        </div>
        </div>
        <aside className="w-[330px] shrink-0 lg:sticky lg:top-6">
          {isRunning ? (
            <LivePanel device={runDevice} />
          ) : (
            <ScreenshotReplay
              steps={steps}
              finalShot={selected?.screenshot_b64}
              hasSelection={!!selected}
              videoUrl={run?.has_recording ? `/api/runs/${run.id}/recording.mp4` : undefined}
            />
          )}
        </aside>
      </div>
    </div>
  )
}
