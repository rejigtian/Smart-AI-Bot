import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSuite, fetchDevices, fetchSettings, fetchTrends, runTree, runNode,
  TrendPoint, fetchRuns, deleteRun, Run, setSuiteAppPackage,
} from '../lib/api'
import StepTreeEditor from '../components/StepTreeEditor'

function SuiteAppPackage({ suiteId, value }: { suiteId: string; value: string }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [pkg, setPkg] = useState(value)
  useEffect(() => setPkg(value), [value])
  const mut = useMutation({
    mutationFn: () => setSuiteAppPackage(suiteId, pkg.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suite', suiteId] }); setEditing(false) },
  })
  if (editing) {
    return (
      <input
        autoFocus
        className="border rounded px-1.5 py-0.5 text-xs font-mono"
        placeholder="com.example.app"
        value={pkg}
        onChange={e => setPkg(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') mut.mutate(); if (e.key === 'Escape') setEditing(false) }}
        onBlur={() => mut.mutate()}
      />
    )
  }
  return (
    <button
      className="text-xs text-ink-faint hover:text-primary"
      onClick={() => setEditing(true)}
      title="设置目标应用包名（用于匹配「设置」里的项目档案，导入其知识库）"
    >
      目标应用: <span className="font-mono">{value || '未设置'}</span> ✎
    </button>
  )
}

const PROVIDERS = ['openai', 'anthropic', 'bedrock', 'google', 'zhipuai', 'groq', 'ollama']


function TrendChart({ trends }: { trends: TrendPoint[] }) {
  const W = 640, H = 170
  const padL = 30, padR = 16, padT = 16, padB = 28
  const innerW = W - padL - padR, innerH = H - padT - padB
  const n = trends.length
  const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const yAt = (v: number) => padT + (1 - v / 100) * innerH

  const linePts = trends.map((t, i) => `${xAt(i)},${yAt(t.pass_rate)}`).join(' ')
  const areaPts = `${xAt(0)},${yAt(0)} ${linePts} ${xAt(n - 1)},${yAt(0)}`
  const latest = trends[n - 1]
  const dotColor = (v: number) => (v === 100 ? '#22c55e' : v >= 70 ? '#3b82f6' : '#ef4444')
  // Show ~6 date labels max to avoid crowding.
  const labelEvery = Math.max(1, Math.ceil(n / 6))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Horizontal gridlines + y-axis labels */}
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={padL} y1={yAt(v)} x2={W - padR} y2={yAt(v)}
                stroke="#eceef1" strokeWidth="1" strokeDasharray={v === 0 ? undefined : '3 4'} />
          <text x={padL - 6} y={yAt(v) + 3} fontSize="9" textAnchor="end" fill="#9aa3af">{v}</text>
        </g>
      ))}
      <polygon points={areaPts} fill="url(#trendFill)" />
      <polyline points={linePts} fill="none" stroke="#3b82f6" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
      {trends.map((t, i) => (
        <g key={t.run_id}>
          <circle cx={xAt(i)} cy={yAt(t.pass_rate)} r={i === n - 1 ? 4.5 : 3}
                  fill={dotColor(t.pass_rate)} stroke="#fff" strokeWidth="1.5">
            <title>
              {`${new Date(t.created_at).toLocaleString()}\n${t.model || t.provider}\n通过 ${t.passed}/${t.total} · 失败 ${t.failed} · 错误 ${t.errored} (${t.pass_rate}%)`}
            </title>
          </circle>
          {(i === n - 1 || i % labelEvery === 0) && (
            <text x={xAt(i)} y={H - 9} fontSize="8.5" textAnchor="middle" fill="#9aa3af">
              {new Date(t.created_at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
            </text>
          )}
        </g>
      ))}
      {/* Latest value badge */}
      <text x={xAt(n - 1)} y={yAt(latest.pass_rate) - 9} fontSize="11" fontWeight="600"
            textAnchor="middle" fill={dotColor(latest.pass_rate)}>
        {latest.pass_rate.toFixed(0)}%
      </text>
    </svg>
  )
}

// ── Per-suite run history ────────────────────────────────────────────────────

const RUN_STATUS_STYLE: Record<string, string> = {
  done: 'bg-green-100 text-green-700',
  running: 'bg-primary-soft text-primary-deep',
  pending: 'bg-yellow-50 text-yellow-600',
  error: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-gray-100 text-gray-500',
}
const RUN_TERMINAL = new Set(['done', 'error', 'cancelled'])

function SuiteRuns({ suiteId }: { suiteId: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: runs = [] } = useQuery({
    queryKey: ['runs', suiteId],
    queryFn: () => fetchRuns(suiteId),
    refetchInterval: q => ((q.state.data ?? []) as Run[]).some(r => !RUN_TERMINAL.has(r.status)) ? 3000 : false,
  })
  const del = useMutation({
    mutationFn: (id: string) => deleteRun(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs', suiteId] })
      qc.invalidateQueries({ queryKey: ['runs'] })            // global Runs page
      qc.invalidateQueries({ queryKey: ['trends', suiteId] }) // trend reflects deletions
      qc.invalidateQueries({ queryKey: ['case-results', suiteId] })
    },
  })

  if (runs.length === 0) return null

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-semibold text-ink-secondary">运行历史</h2>
        <span className="text-xs text-ink-faint">{runs.length} 次 · 删除整次运行会一并清掉它的用例结果与记忆</span>
      </div>
      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
        {runs.map((r, i) => (
          <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 group ${i > 0 ? 'border-t' : ''}`}>
            <button className="flex-1 min-w-0 text-left" onClick={() => navigate(`/runs/${r.id}`)}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RUN_STATUS_STYLE[r.status] || 'bg-gray-100 text-gray-500'}`}>
                  {r.status}
                </span>
                {!RUN_TERMINAL.has(r.status) && <span className="text-primary animate-pulse text-xs">●</span>}
                <span className="text-xs text-ink-faint">{new Date(r.created_at).toLocaleString()}</span>
                <span className="text-xs text-ink-faint font-mono truncate">{r.model}</span>
              </div>
              <div className="flex gap-3 mt-0.5 text-xs">
                <span className="text-ok">{r.passed} 通过</span>
                <span className="text-red-600">{r.failed} 失败</span>
                {r.errored > 0 && <span className="text-orange-600">{r.errored} 错误</span>}
                {r.skipped > 0 && <span className="text-gray-500">{r.skipped} 跳过</span>}
                <span className="text-ink-faint">/ {r.total}</span>
                {r.total_tokens > 0 && <span className="text-primary">{(r.total_tokens / 1000).toFixed(1)}k tok</span>}
              </div>
            </button>
            <button
              className="px-2 py-0.5 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 flex-shrink-0 disabled:opacity-40"
              disabled={del.isPending}
              onClick={() => { if (confirm('删除整次运行记录？该次运行的所有用例结果和由它产生的记忆都会一并删除。')) del.mutate(r.id) }}
              title="删除整次运行（含其用例结果 + 派生记忆）"
            >
              🗑 删除
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function SuiteDetail() {
  const { suiteId } = useParams<{ suiteId: string }>()
  const navigate = useNavigate()

  const [deviceId, setDeviceId] = useState('')
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('gpt-4o')
  const [maxSteps, setMaxSteps] = useState(20)
  const settingsInitialized = useRef(false)

  const DEFAULT_MODELS: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    bedrock: 'us.anthropic.claude-sonnet-4-6',
    google: 'gemini-1.5-pro',
    zhipuai: 'glm-4v',
    groq: 'llama-3.1-70b-versatile',
    ollama: 'llama3',
  }

  const { data: suite } = useQuery({ queryKey: ['suite', suiteId], queryFn: () => fetchSuite(suiteId!) })
  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: fetchDevices, refetchInterval: 5000 })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings })

  // Only apply saved defaults once on first load; don't overwrite user's manual changes
  useEffect(() => {
    if (settings && !settingsInitialized.current) {
      settingsInitialized.current = true
      if (settings.default_provider) setProvider(settings.default_provider)
      if (settings.default_model) setModel(settings.default_model)
    }
  }, [settings])

  const { data: trends = [] } = useQuery({
    queryKey: ['trends', suiteId],
    queryFn: () => fetchTrends(suiteId!),
    enabled: !!suiteId,
  })

  const onlineDevices = devices.filter(d => d.status === 'online')

  function handleProviderChange(p: string) {
    setProvider(p)
    if (settings && p === settings.default_provider && settings.default_model) {
      setModel(settings.default_model)
    } else {
      setModel(DEFAULT_MODELS[p] || '')
    }
  }

  const treeRunMut = useMutation({
    mutationFn: () => runTree({ suite_id: suiteId!, device_id: deviceId, provider, model, max_steps: maxSteps }),
    onSuccess: run => navigate(`/runs/${run.id}`),
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(e)
      alert(`步骤树运行启动失败: ${msg}`)
    },
  })

  const nodeRunMut = useMutation({
    mutationFn: (nodeId: string) => runNode({ suite_id: suiteId!, device_id: deviceId, node_id: nodeId, provider, model, max_steps: maxSteps }),
    onSuccess: run => navigate(`/runs/${run.id}`),
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(e)
      alert(`节点运行启动失败: ${msg}`)
    },
  })
  const onRunNode = (nodeId: string) => {
    if (!deviceId) { alert('请先在右侧选择设备'); return }
    nodeRunMut.mutate(nodeId)
  }

  return (
    <div>
      <button className="text-sm text-primary hover:underline mb-4 block" onClick={() => navigate('/suites')}>
        ← 返回套件列表
      </button>

      <div className="flex items-start gap-8">
        {/* Left: test case list */}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold mb-1">{(suite?.name || '').replace(/\.xmind$/i, '')}</h1>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-sm text-gray-500">步骤树 · 拖动节点改挂 · 悬停行可编辑 · 可运行单节点或整树</p>
            <SuiteAppPackage suiteId={suiteId!} value={suite?.app_package || ''} />
          </div>

          <StepTreeEditor suiteId={suiteId!} onRunNode={onRunNode} />

          {/* Pass rate trend chart */}
          {trends.length >= 2 && (
            <div className="mt-6">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-sm font-semibold text-ink-secondary">通过率趋势</h2>
                <span className="text-xs text-ink-faint">
                  最近 {trends.length} 次 · 最新 {trends[trends.length - 1].pass_rate.toFixed(0)}%
                </span>
              </div>
              <div className="bg-white border rounded-lg p-3 shadow-sm">
                <TrendChart trends={trends} />
              </div>
            </div>
          )}

          {/* Run history for this suite — open one, or delete a whole run */}
          <SuiteRuns suiteId={suiteId!} />
        </div>

        {/* Right: run config */}
        <div className="w-72 flex-shrink-0">
          <div className="bg-white border rounded-lg p-5 shadow-sm">
            <h2 className="font-semibold mb-4">开始运行</h2>

            <label className="block text-sm font-medium mb-1">设备</label>
            {onlineDevices.length === 0 ? (
              <p className="text-sm text-red-500 mb-3">无在线设备，请先连接设备。</p>
            ) : (
              <select
                className="w-full border rounded px-2 py-1.5 text-sm mb-3"
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
              >
                <option value="">— 选择设备 —</option>
                {onlineDevices.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}

            <label className="block text-sm font-medium mb-1">Provider</label>
            <select
              className="w-full border rounded px-2 py-1.5 text-sm mb-3"
              value={provider}
              onChange={e => handleProviderChange(e.target.value)}
            >
              {PROVIDERS.map(p => <option key={p}>{p}</option>)}
            </select>

            <label className="block text-sm font-medium mb-1">Model</label>
            <input
              className="w-full border rounded px-2 py-1.5 text-sm mb-3 font-mono"
              value={model}
              onChange={e => setModel(e.target.value)}
            />

            <label className="block text-sm font-medium mb-1">每条用例最大步数</label>
            <input
              type="number"
              className="w-full border rounded px-2 py-1.5 text-sm mb-3"
              value={maxSteps}
              onChange={e => setMaxSteps(parseInt(e.target.value) || 20)}
              min={5}
              max={100}
            />

            <button
              className="w-full bg-primary text-white py-2 rounded font-medium hover:bg-primary-deep disabled:opacity-50"
              disabled={!deviceId || treeRunMut.isPending}
              onClick={() => treeRunMut.mutate()}
              title="按步骤树做一次深度优先遍历，逐个叶子用例运行；共享前缀只导航一次"
            >
              {treeRunMut.isPending ? '启动中…' : '▶ 运行步骤树（DFS）'}
            </button>
            <p className="mt-2 text-xs text-ink-faint">
              单独跑某个节点：在左侧树里 hover 该节点 → 点「▶ 运行」。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
