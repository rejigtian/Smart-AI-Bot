import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSuite, fetchCases, fetchDevices, fetchSettings, fetchTrends, startRun, batchRun,
  addCase, updateCase, deleteCase, TestCase,
} from '../lib/api'

const PROVIDERS = ['openai', 'anthropic', 'bedrock', 'google', 'zhipuai', 'groq', 'ollama']

// ── Path tree (collapse the repeated xmind breadcrumb) ──────────────────────

type TreeNode = {
  label: string
  children: TreeNode[]
  cases: TestCase[]
}

function buildCaseTree(cases: TestCase[]): TreeNode {
  const root: TreeNode = { label: '', children: [], cases: [] }
  for (const c of cases) {
    const segs = (c.path || '').split('>').map(s => s.trim()).filter(Boolean)
    let node = root
    for (const seg of segs) {
      let child = node.children.find(ch => ch.label === seg)
      if (!child) { child = { label: seg, children: [], cases: [] }; node.children.push(child) }
      node = child
    }
    node.cases.push(c)
  }
  return compress(root)
}

// Merge a chain of single-child, case-less nodes into one "A > B > C" label.
function compress(node: TreeNode): TreeNode {
  node.children = node.children.map(compress)
  if (node.label && node.cases.length === 0 && node.children.length === 1) {
    const only = node.children[0]
    return { label: `${node.label} > ${only.label}`, children: only.children, cases: only.cases }
  }
  return node
}

function countLeaves(node: TreeNode): number {
  return node.cases.length + node.children.reduce((n, c) => n + countLeaves(c), 0)
}

// Pull the common root chain out so it shows once as a top breadcrumb.
function stripCommonRoot(root: TreeNode): { prefix: string; node: TreeNode } {
  if (root.cases.length === 0 && root.children.length === 1 && root.children[0].children.length > 0) {
    return { prefix: root.children[0].label, node: root.children[0] }
  }
  return { prefix: '', node: root }
}

function collectFolderKeys(node: TreeNode, parentKey: string, out: string[]) {
  for (const ch of node.children) {
    const key = `${parentKey}/${ch.label}`
    if (ch.children.length > 0) out.push(key)
    collectFolderKeys(ch, key, out)
  }
}

function collectCaseIds(node: TreeNode): string[] {
  return [...node.cases.map(c => c.id), ...node.children.flatMap(collectCaseIds)]
}

type FolderProps = {
  node: TreeNode; depth: number; suiteId: string; total: number
  pathKey: string; collapsed: Set<string>; toggle: (k: string) => void
  parentBase: string; onBatch: (base: string, caseIds: string[]) => void
}

function TreeFolder({ node, depth, suiteId, total, pathKey, collapsed, toggle, parentBase, onBatch }: FolderProps) {
  const open = !collapsed.has(pathKey)
  const indent = depth * 16
  const base = node.label ? (parentBase ? `${parentBase} > ${node.label}` : node.label) : parentBase
  return (
    <div>
      {node.label !== '' && (
        <div className="flex items-center border-t hover:bg-canvas-cool group">
          <button
            type="button"
            onClick={() => toggle(pathKey)}
            className="flex-1 flex items-center gap-1.5 px-4 py-2 text-left text-sm font-medium text-ink-secondary min-w-0"
            style={{ paddingLeft: 16 + indent }}
          >
            <span className="text-ink-faint w-3">{open ? '▾' : '▸'}</span>
            <span className="truncate">{node.label}</span>
            <span className="text-xs font-normal text-ink-faint ml-1">{countLeaves(node)}</span>
          </button>
          <button
            type="button"
            onClick={() => onBatch(base, collectCaseIds(node))}
            title="进基准页一次,逐个验证这个分组下的所有点"
            className="mr-3 px-2 py-0.5 text-xs rounded border border-hairline-strong text-primary opacity-0 group-hover:opacity-100 hover:bg-primary-soft flex-shrink-0"
          >
            ▶ 批量跑
          </button>
        </div>
      )}
      {open && (
        <>
          {node.cases.map((c, i) => (
            <CaseRow key={c.id} c={c} suiteId={suiteId} index={i} total={total}
                     showPath={false} indentPx={node.label ? indent + 16 : 16} />
          ))}
          {node.children.map(ch => (
            <TreeFolder key={ch.label} node={ch} depth={node.label ? depth + 1 : depth}
                        suiteId={suiteId} total={total}
                        pathKey={`${pathKey}/${ch.label}`} collapsed={collapsed} toggle={toggle}
                        parentBase={base} onBatch={onBatch} />
          ))}
        </>
      )}
    </div>
  )
}

// ── Inline editable case row ────────────────────────────────────────────────

function CaseRow({
  c, suiteId, index, total, showPath = true, indentPx = 16,
}: {
  c: TestCase; suiteId: string; index: number; total: number
  showPath?: boolean; indentPx?: number
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [path, setPath] = useState(c.path)
  const [expected, setExpected] = useState(c.expected)

  const saveMut = useMutation({
    mutationFn: () => updateCase(suiteId, c.id, { path, expected }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cases', suiteId] }); setEditing(false) },
  })

  const delMut = useMutation({
    mutationFn: () => deleteCase(suiteId, c.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases', suiteId] }),
  })

  if (editing) {
    return (
      <div className={`px-4 py-3 bg-primary-soft ${index > 0 ? 'border-t' : ''}`}>
        <div className="text-xs text-gray-500 mb-1">路径 / Path</div>
        <input
          className="w-full border rounded px-2 py-1 text-xs mb-2 font-mono"
          value={path}
          onChange={e => setPath(e.target.value)}
        />
        <div className="text-xs text-gray-500 mb-1">预期结果 / Expected</div>
        <input
          className="w-full border rounded px-2 py-1 text-sm mb-3"
          value={expected}
          onChange={e => setExpected(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="px-3 py-1 bg-primary text-white text-xs rounded hover:bg-primary-deep disabled:opacity-50"
            disabled={saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? '保存中…' : '保存'}
          </button>
          <button
            className="px-3 py-1 border text-xs rounded hover:bg-gray-100"
            onClick={() => { setPath(c.path); setExpected(c.expected); setEditing(false) }}
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`pr-4 py-2 flex items-start gap-2 group ${index > 0 ? 'border-t' : ''}`}
         style={{ paddingLeft: indentPx }}>
      <span className="text-ink-faint mt-0.5 select-none">·</span>
      <div className="flex-1 min-w-0">
        {showPath && <div className="text-xs text-gray-400 truncate">{c.path}</div>}
        <div className="text-sm font-medium">{c.expected}</div>
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
        <button
          className="px-2 py-0.5 text-xs border rounded hover:bg-gray-100"
          onClick={() => setEditing(true)}
        >
          编辑
        </button>
        <button
          className="px-2 py-0.5 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
          disabled={delMut.isPending || total <= 1}
          onClick={() => { if (confirm('删除这条用例？')) delMut.mutate() }}
        >
          删除
        </button>
      </div>
    </div>
  )
}

// ── Add case row ─────────────────────────────────────────────────────────────

function AddCaseRow({ suiteId }: { suiteId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const [expected, setExpected] = useState('')

  const addMut = useMutation({
    mutationFn: () => addCase(suiteId, { path, expected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases', suiteId] })
      qc.invalidateQueries({ queryKey: ['suite', suiteId] })
      setPath(''); setExpected(''); setOpen(false)
    },
  })

  if (!open) {
    return (
      <button
        className="w-full text-left px-4 py-2.5 text-sm text-primary hover:bg-primary-soft border-t"
        onClick={() => setOpen(true)}
      >
        + 添加用例
      </button>
    )
  }

  return (
    <div className="px-4 py-3 bg-green-50 border-t">
      <div className="text-xs text-gray-500 mb-1">路径 / Path</div>
      <input
        className="w-full border rounded px-2 py-1 text-xs mb-2 font-mono"
        placeholder="模块 > 子功能 > 场景"
        value={path}
        onChange={e => setPath(e.target.value)}
      />
      <div className="text-xs text-gray-500 mb-1">预期结果 / Expected</div>
      <input
        className="w-full border rounded px-2 py-1 text-sm mb-3"
        placeholder="预期看到什么结果"
        value={expected}
        onChange={e => setExpected(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="px-3 py-1 bg-ok text-white text-xs rounded hover:bg-ok disabled:opacity-50"
          disabled={!path.trim() || addMut.isPending}
          onClick={() => addMut.mutate()}
        >
          {addMut.isPending ? '添加中…' : '添加'}
        </button>
        <button
          className="px-3 py-1 border text-xs rounded hover:bg-gray-100"
          onClick={() => { setPath(''); setExpected(''); setOpen(false) }}
        >
          取消
        </button>
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
  const [isolated, setIsolated] = useState(false)
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
  const { data: cases = [] } = useQuery({ queryKey: ['cases', suiteId], queryFn: () => fetchCases(suiteId!) })
  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: fetchDevices, refetchInterval: 5000 })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings })

  // Case tree + persisted collapse state
  const { prefix: rootPrefix, node: treeRoot } = useMemo(() => stripCommonRoot(buildCaseTree(cases)), [cases])
  const allFolderKeys = useMemo(() => { const out: string[] = []; collectFolderKeys(treeRoot, '', out); return out }, [treeRoot])
  const collapseKey = `tree-collapsed-${suiteId}`
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`tree-collapsed-${suiteId}`) || '[]')) } catch { return new Set() }
  })
  useEffect(() => { localStorage.setItem(collapseKey, JSON.stringify([...collapsed])) }, [collapsed, collapseKey])
  const toggleFolder = (k: string) => setCollapsed(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n
  })
  const allCollapsed = allFolderKeys.length > 0 && allFolderKeys.every(k => collapsed.has(k))

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

  const runMut = useMutation({
    mutationFn: () => startRun({ suite_id: suiteId!, device_id: deviceId, provider, model, max_steps: maxSteps, isolated }),
    onSuccess: run => navigate(`/runs/${run.id}`),
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(e)
      alert(`启动失败: ${msg}`)
    },
  })

  const batchMut = useMutation({
    mutationFn: (v: { base: string; caseIds: string[] }) =>
      batchRun({ suite_id: suiteId!, device_id: deviceId, provider, model, max_steps: maxSteps, base_path: v.base, case_ids: v.caseIds }),
    onSuccess: run => navigate(`/runs/${run.id}`),
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(e)
      alert(`批量跑启动失败: ${msg}`)
    },
  })
  const onBatch = (base: string, caseIds: string[]) => {
    if (!deviceId) { alert('请先在右侧选择设备'); return }
    if (caseIds.length === 0) return
    batchMut.mutate({ base, caseIds })
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
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-500">{cases.length} 条用例 · 按路径分组 · 悬停行可编辑</p>
            {allFolderKeys.length > 0 && (
              <button
                type="button"
                className="text-xs text-primary hover:text-primary-deep"
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(allFolderKeys))}
              >
                {allCollapsed ? '全部展开' : '全部收起'}
              </button>
            )}
          </div>

          <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
            {rootPrefix && (
              <div className="px-4 py-2 text-xs font-mono text-ink-mute bg-canvas-cool truncate" title={rootPrefix}>
                {rootPrefix}
              </div>
            )}
            {treeRoot.cases.map((c, i) => (
              <CaseRow key={c.id} c={c} suiteId={suiteId!} index={i} total={cases.length}
                       showPath={false} indentPx={16} />
            ))}
            {treeRoot.children.map(ch => (
              <TreeFolder key={ch.label} node={ch} depth={0} suiteId={suiteId!} total={cases.length}
                          pathKey={`/${ch.label}`} collapsed={collapsed} toggle={toggleFolder}
                          parentBase={rootPrefix} onBatch={onBatch} />
            ))}
            <AddCaseRow suiteId={suiteId!} />
          </div>

          {/* Pass rate trend chart */}
          {trends.length >= 2 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Pass Rate Trend</h2>
              <div className="bg-white border rounded-lg p-4 shadow-sm">
                <svg viewBox={`0 0 ${Math.max(trends.length * 60, 300)} 120`} className="w-full h-32">
                  {/* Grid lines */}
                  {[0, 25, 50, 75, 100].map(v => (
                    <g key={v}>
                      <line x1="30" y1={100 - v} x2={trends.length * 60} y2={100 - v} stroke="#e5e7eb" strokeWidth="0.5" />
                      <text x="0" y={104 - v} fontSize="8" fill="#9ca3af">{v}%</text>
                    </g>
                  ))}
                  {/* Line + dots */}
                  <polyline
                    fill="none" stroke="#3b82f6" strokeWidth="2"
                    points={trends.map((t, i) => `${30 + i * 55},${100 - t.pass_rate}`).join(' ')}
                  />
                  {trends.map((t, i) => (
                    <g key={t.run_id}>
                      <circle
                        cx={30 + i * 55} cy={100 - t.pass_rate} r="4"
                        fill={t.pass_rate === 100 ? '#22c55e' : t.pass_rate >= 70 ? '#3b82f6' : '#ef4444'}
                      />
                      <text
                        x={30 + i * 55} y={95 - t.pass_rate}
                        fontSize="7" fill="#6b7280" textAnchor="middle"
                      >
                        {t.pass_rate.toFixed(0)}%
                      </text>
                      <text
                        x={30 + i * 55} y="115"
                        fontSize="6" fill="#9ca3af" textAnchor="middle"
                      >
                        {new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>
          )}
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

            <label className="flex items-start gap-2 text-xs text-ink-mute mb-5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={isolated}
                onChange={e => setIsolated(e.target.checked)}
              />
              <span>
                独立隔离运行
                <span className="block text-ink-faint">
                  每条用例从头冷启动、互不影响（更慢，隔离性强）。默认关闭 = 按用例树共享导航跑一遍（更快）。
                </span>
              </span>
            </label>

            <button
              className="w-full bg-primary text-white py-2 rounded font-medium hover:bg-primary-deep disabled:opacity-50"
              disabled={!deviceId || runMut.isPending}
              onClick={() => runMut.mutate()}
            >
              {runMut.isPending ? '启动中…' : isolated ? '▶ 开始运行（隔离）' : '▶ 开始运行（树形）'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
