import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSuite, fetchCases, fetchDevices, fetchSettings, fetchTrends, startRun, batchRun,
  addCase, updateCase, deleteCase, TestCase,
  fetchCaseResults, deleteCaseResult, purgeCaseResults, TrendPoint,
  fetchRuns, deleteRun, Run,
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
  const [adding, setAdding] = useState(false)
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
            onClick={() => { setAdding(true); if (!open) toggle(pathKey) }}
            title="在这个分组下添加一条子用例"
            className="px-2 py-0.5 text-xs rounded border border-hairline-strong text-ok opacity-0 group-hover:opacity-100 hover:bg-green-50 flex-shrink-0"
          >
            + 子用例
          </button>
          <button
            type="button"
            onClick={() => onBatch(base, collectCaseIds(node))}
            title="进基准页一次,逐个验证这个分组下的所有点"
            className="mx-3 px-2 py-0.5 text-xs rounded border border-hairline-strong text-primary opacity-0 group-hover:opacity-100 hover:bg-primary-soft flex-shrink-0"
          >
            ▶ 批量跑
          </button>
        </div>
      )}
      {open && (
        <>
          {adding && (
            <AddCaseForm suiteId={suiteId} basePath={base} indentPx={indent + 32}
                         onDone={() => setAdding(false)} />
          )}
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
  const [showHistory, setShowHistory] = useState(false)
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
    <>
      <div className={`pr-4 py-2 flex items-start gap-2 group ${index > 0 ? 'border-t' : ''}`}
           style={{ paddingLeft: indentPx }}>
        <span className="text-ink-faint mt-0.5 select-none">·</span>
        <div className="flex-1 min-w-0">
          {showPath && <div className="text-xs text-gray-400 truncate">{c.path}</div>}
          <div className="text-sm font-medium">{c.expected}</div>
        </div>
        <div className="flex gap-1 flex-shrink-0 mt-0.5">
          <button
            className={`px-2 py-0.5 text-xs border rounded hover:bg-gray-100 ${showHistory ? 'bg-gray-100 text-ink' : 'text-ink-mute'}`}
            onClick={() => setShowHistory(v => !v)}
            title="查看 / 清理这条用例的历史运行记录（影响下次运行的记忆）"
          >
            记录{showHistory ? ' ▾' : ' ▸'}
          </button>
          <span className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
          </span>
        </div>
      </div>
      {showHistory && <CaseHistory suiteId={suiteId} caseId={c.id} indentPx={indentPx + 14} />}
    </>
  )
}

// ── Per-case run history + memory hygiene ────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  pass: 'bg-green-100 text-green-700',
  fail: 'bg-red-100 text-red-700',
  error: 'bg-orange-100 text-orange-700',
  skip: 'bg-gray-100 text-gray-500',
}

function CaseHistory({ suiteId, caseId, indentPx }: { suiteId: string; caseId: string; indentPx: number }) {
  const qc = useQueryClient()
  const { data: results = [], isLoading } = useQuery({
    queryKey: ['case-results', suiteId, caseId],
    queryFn: () => fetchCaseResults(suiteId, caseId),
  })
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['case-results', suiteId, caseId] })
    qc.invalidateQueries({ queryKey: ['trends', suiteId] })
  }
  const delOne = useMutation({
    mutationFn: (rid: string) => deleteCaseResult(suiteId, caseId, rid),
    onSuccess: invalidate,
  })
  const purge = useMutation({
    mutationFn: (scope: 'all' | 'failed') => purgeCaseResults(suiteId, caseId, scope),
    onSuccess: invalidate,
  })
  const failedCount = results.filter(r => r.status === 'fail' || r.status === 'error').length

  return (
    <div className="bg-canvas-cool border-t text-xs" style={{ paddingLeft: indentPx, paddingRight: 16 }}>
      <div className="flex items-center justify-between py-2 pr-1">
        <span className="text-ink-faint">
          {isLoading ? '加载中…' : `${results.length} 条运行记录`}
          {results.length > 0 && <span className="ml-1">· 加 ★ 或最近一次通过会作为下次运行的参考</span>}
        </span>
        {results.length > 0 && (
          <span className="flex gap-1.5 flex-shrink-0">
            <button
              className="px-2 py-0.5 border border-orange-200 text-orange-600 rounded hover:bg-orange-50 disabled:opacity-40"
              disabled={failedCount === 0 || purge.isPending}
              onClick={() => { if (confirm(`删除这条用例的 ${failedCount} 条失败记录？`)) purge.mutate('failed') }}
            >
              删失败 {failedCount > 0 ? `(${failedCount})` : ''}
            </button>
            <button
              className="px-2 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-40"
              disabled={purge.isPending}
              onClick={() => { if (confirm('清空这条用例的全部运行记录？相关记忆（参考 + 经验）也会一并删除。')) purge.mutate('all') }}
            >
              清空
            </button>
          </span>
        )}
      </div>
      {!isLoading && results.length === 0 && (
        <div className="pb-2 text-ink-faint">还没有运行记录。</div>
      )}
      {results.map(r => (
        <div key={r.id} className="flex items-center gap-2 py-1.5 border-t border-hairline">
          <span className={`px-1.5 py-0.5 rounded font-medium ${STATUS_STYLE[r.status] || 'bg-gray-100 text-gray-500'}`}>
            {r.status}
          </span>
          {r.is_starred && <span title="已加星：作为下次运行参考">★</span>}
          <span className="text-ink-mute whitespace-nowrap">
            {new Date(r.created_at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="text-ink-faint truncate flex-1 font-mono">{r.model || r.provider}</span>
          <span className="text-ink-faint whitespace-nowrap">{r.steps} 步 · {r.total_tokens} tok</span>
          <button
            className="px-1.5 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50 flex-shrink-0 disabled:opacity-40"
            disabled={delOne.isPending}
            onClick={() => { if (confirm('删除这条运行记录？')) delOne.mutate(r.id) }}
            title="删除这条记录（及由它产生的记忆）"
          >
            🗑
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Add case row ─────────────────────────────────────────────────────────────

// Inline add form, shown on demand and closed right after a successful add.
// With `basePath` (a folder's full path), the path is prefilled to that path
// AS-IS. Keeping it and just filling Expected adds a SIBLING check under the
// same scenario (xmind leaves share the parent path, differ by expected).
// Appending "> 子场景" instead creates a deeper sub-level.
function AddCaseForm({ suiteId, basePath = '', indentPx = 16, onDone }: {
  suiteId: string; basePath?: string; indentPx?: number; onDone: () => void
}) {
  const qc = useQueryClient()
  const [path, setPath] = useState(basePath)
  const [expected, setExpected] = useState('')

  const norm = (s: string) => s.trim().replace(/>\s*$/, '').trim()
  // A check needs both a location (path) and an assertion (expected). This also
  // unblocks same-path siblings, which the old "path must differ" rule rejected.
  const canAdd = norm(path) !== '' && expected.trim() !== ''

  const addMut = useMutation({
    mutationFn: () => addCase(suiteId, { path: norm(path), expected: expected.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases', suiteId] })
      qc.invalidateQueries({ queryKey: ['suite', suiteId] })
      onDone()  // close the form; re-open via "+ 子用例" / "+ 添加用例" to add another
    },
  })

  return (
    <div className="py-3 bg-green-50 border-t" style={{ paddingLeft: indentPx, paddingRight: 16 }}>
      <div className="text-xs text-gray-500 mb-1">
        路径 / Path{basePath && ' （不改路径 = 加同级检查；末尾加「> 子场景」= 建子层级）'}
      </div>
      <input
        autoFocus={!basePath}
        className="w-full border rounded px-2 py-1 text-xs mb-2 font-mono"
        placeholder="模块 > 子功能 > 场景"
        value={path}
        onChange={e => setPath(e.target.value)}
      />
      <div className="text-xs text-gray-500 mb-1">预期结果 / Expected</div>
      <input
        autoFocus={!!basePath}
        className="w-full border rounded px-2 py-1 text-sm mb-3"
        placeholder="预期看到什么结果"
        value={expected}
        onChange={e => setExpected(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && canAdd) addMut.mutate() }}
      />
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-1 bg-ok text-white text-xs rounded hover:bg-ok disabled:opacity-50"
          disabled={!canAdd || addMut.isPending}
          onClick={() => addMut.mutate()}
        >
          {addMut.isPending ? '添加中…' : '添加'}
        </button>
        <button
          className="px-3 py-1 border text-xs rounded hover:bg-gray-100"
          onClick={onDone}
        >
          取消
        </button>
      </div>
    </div>
  )
}

// Bottom "+ 添加用例" button — adds a top-level case (no prefilled prefix).
function AddCaseRow({ suiteId }: { suiteId: string }) {
  const [open, setOpen] = useState(false)
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
  return <AddCaseForm suiteId={suiteId} onDone={() => setOpen(false)} />
}

// ── Pass-rate trend chart ────────────────────────────────────────────────────

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
  const [addingRoot, setAddingRoot] = useState(false)

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
              <>
                <div className="flex items-center gap-2 px-4 py-2 bg-canvas-cool group">
                  <span className="flex-1 text-xs font-mono text-ink-mute truncate" title={rootPrefix}>
                    {rootPrefix}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAddingRoot(true)}
                    title="给这个主用例添加一条同级检查（子用例）"
                    className="px-2 py-0.5 text-xs rounded border border-hairline-strong text-ok opacity-0 group-hover:opacity-100 hover:bg-green-50 flex-shrink-0"
                  >
                    + 子用例
                  </button>
                </div>
                {addingRoot && (
                  <AddCaseForm suiteId={suiteId!} basePath={rootPrefix} indentPx={32}
                               onDone={() => setAddingRoot(false)} />
                )}
              </>
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
