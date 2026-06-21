import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchNodes, addNode, updateNode, deleteNode, moveNode, StepNode,
  searchNodes, copyNode, NodeSearchHit,
  fetchNodeResults, deleteNodeResult, purgeNodeResults, CaseResult,
} from '../lib/api'

const STATUS_STYLE: Record<string, string> = {
  pass: 'bg-green-100 text-green-700',
  fail: 'bg-red-100 text-red-700',
  error: 'bg-orange-100 text-orange-700',
  skip: 'bg-gray-100 text-gray-500',
}

function NodeHistory({ nodeId, indentPx }: { nodeId: string; indentPx: number }) {
  const qc = useQueryClient()
  const { data: results = [], isLoading } = useQuery({
    queryKey: ['node-results', nodeId],
    queryFn: () => fetchNodeResults(nodeId),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['node-results', nodeId] })
  const delOne = useMutation({ mutationFn: (rid: string) => deleteNodeResult(nodeId, rid), onSuccess: invalidate })
  const purge = useMutation({ mutationFn: (scope: 'all' | 'failed') => purgeNodeResults(nodeId, scope), onSuccess: invalidate })
  const failedCount = results.filter((r: CaseResult) => r.status === 'fail' || r.status === 'error').length

  return (
    <div className="bg-canvas-cool border-t text-xs" style={{ paddingLeft: indentPx, paddingRight: 16 }}>
      <div className="flex items-center justify-between py-2 pr-1">
        <span className="text-ink-faint">
          {isLoading ? '加载中…' : `${results.length} 条运行记录`}
          {results.length > 0 && <span className="ml-1">· 加 ★ 或最近一次通过会作为下次运行的参考</span>}
        </span>
        {results.length > 0 && (
          <span className="flex gap-1.5 flex-shrink-0">
            <button className="px-2 py-0.5 border border-orange-200 text-orange-600 rounded hover:bg-orange-50 disabled:opacity-40"
                    disabled={failedCount === 0 || purge.isPending}
                    onClick={() => { if (confirm(`删除这个节点的 ${failedCount} 条失败记录？`)) purge.mutate('failed') }}>
              删失败 {failedCount > 0 ? `(${failedCount})` : ''}
            </button>
            <button className="px-2 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-40"
                    disabled={purge.isPending}
                    onClick={() => { if (confirm('清空这个节点的全部运行记录？相关记忆也会一并删除。')) purge.mutate('all') }}>
              清空
            </button>
          </span>
        )}
      </div>
      {!isLoading && results.length === 0 && <div className="pb-2 text-ink-faint">还没有运行记录。</div>}
      {results.map((r: CaseResult) => (
        <div key={r.id} className="flex items-center gap-2 py-1.5 border-t border-hairline">
          <span className={`px-1.5 py-0.5 rounded font-medium ${STATUS_STYLE[r.status] || 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
          {r.is_starred && <span title="已加星：作为下次运行参考">★</span>}
          <span className="text-ink-mute whitespace-nowrap">
            {new Date(r.created_at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="text-ink-faint truncate flex-1 font-mono">{r.model || r.provider}</span>
          <span className="text-ink-faint whitespace-nowrap">{r.steps} 步 · {r.total_tokens} tok</span>
          <button className="px-1.5 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50 flex-shrink-0 disabled:opacity-40"
                  disabled={delOne.isPending}
                  onClick={() => { if (confirm('删除这条运行记录？')) delOne.mutate(r.id) }}
                  title="删除这条记录（及由它产生的记忆）">
            🗑
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Tree assembly from the flat parent_id list ──────────────────────────────

type TreeNode = StepNode & { children: TreeNode[] }

function buildTree(nodes: StepNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  nodes.forEach(n => byId.set(n.id, { ...n, children: [] }))
  const roots: TreeNode[] = []
  byId.forEach(n => {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id)!.children.push(n)
    else roots.push(n)
  })
  const sortRec = (list: TreeNode[]) => {
    list.sort((a, b) => a.order - b.order)
    list.forEach(c => sortRec(c.children))
  }
  sortRec(roots)
  return roots
}

// ── One editable node row ───────────────────────────────────────────────────

function NodeRow({
  node, depth, suiteId, dragId, setDragId, onRunNode,
}: {
  node: TreeNode; depth: number; suiteId: string
  dragId: string | null; setDragId: (id: string | null) => void
  onRunNode?: (nodeId: string) => void
}) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['nodes', suiteId] })
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [reusing, setReusing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [dropHover, setDropHover] = useState(false)
  const [action, setAction] = useState(node.action)
  const [expected, setExpected] = useState(node.expected)
  const [loopTask, setLoopTask] = useState(node.loop_task)
  const [reversible, setReversible] = useState(node.reversible)
  const indent = depth * 18

  const saveMut = useMutation({
    mutationFn: () => updateNode(suiteId, node.id, { action, expected, loop_task: loopTask, reversible }),
    onSuccess: () => { invalidate(); setEditing(false) },
  })
  const delMut = useMutation({
    mutationFn: () => deleteNode(suiteId, node.id),
    onSuccess: invalidate,
  })
  const moveMut = useMutation({
    mutationFn: (childId: string) => moveNode(suiteId, childId, node.id),
    onSuccess: invalidate,
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(e)
      alert(`移动失败: ${msg}`)
    },
  })

  if (editing) {
    return (
      <div className="px-4 py-3 bg-primary-soft border-t" style={{ paddingLeft: 16 + indent }}>
        <div className="text-xs text-gray-500 mb-1">行为 / Action</div>
        <input className="w-full border rounded px-2 py-1 text-sm mb-2 font-mono"
               value={action} onChange={e => setAction(e.target.value)} />
        <div className="text-xs text-gray-500 mb-1">期望 / Expected（留空 = 执行成功即通过）</div>
        <input className="w-full border rounded px-2 py-1 text-sm mb-2"
               value={expected} onChange={e => setExpected(e.target.value)} />
        <label className="flex items-center gap-2 mb-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={loopTask} onChange={e => setLoopTask(e.target.checked)} />
          循环任务（重复同一动作的任务，跳过卡死兜底）
        </label>
        <label className="flex items-center gap-2 mb-3 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={!reversible} onChange={e => setReversible(!e.target.checked)} />
          不可回退（提交后 back 撤不掉，分支切换时从头重放而非按返回）
        </label>
        <div className="flex gap-2">
          <button className="px-3 py-1 bg-primary text-white text-xs rounded hover:bg-primary-deep disabled:opacity-50"
                  disabled={saveMut.isPending || action.trim() === ''}
                  onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? '保存中…' : '保存'}
          </button>
          <button className="px-3 py-1 border text-xs rounded hover:bg-gray-100"
                  onClick={() => { setAction(node.action); setExpected(node.expected); setLoopTask(node.loop_task); setReversible(node.reversible); setEditing(false) }}>
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        className={`pr-4 py-2 flex items-start gap-2 group border-t ${dropHover ? 'bg-amber-50' : ''}`}
        style={{ paddingLeft: 16 + indent }}
        draggable
        onDragStart={() => setDragId(node.id)}
        onDragEnd={() => setDragId(null)}
        onDragOver={e => { if (dragId && dragId !== node.id) { e.preventDefault(); setDropHover(true) } }}
        onDragLeave={() => setDropHover(false)}
        onDrop={e => {
          e.preventDefault(); setDropHover(false)
          if (dragId && dragId !== node.id) moveMut.mutate(dragId)
        }}
        title="拖动到另一个节点上 = 改挂到它下面"
      >
        <span className="text-ink-faint mt-0.5 select-none cursor-grab">⋮⋮</span>
        <div className="flex-1 min-w-0">
          {node.ref_id ? (
            <div className="text-sm font-medium text-blue-700">
              🔗 链接：<span className="font-mono text-xs">{node.ref_path || '（源已失效）'}</span>
              <span className="ml-2 text-[10px] text-gray-400">改源处即同步</span>
            </div>
          ) : (
            <div className="text-sm font-medium">
              {node.action || <span className="text-gray-400">（空步骤）</span>}
              {node.expected
                ? <span className="ml-2 align-middle px-1.5 py-0.5 text-[10px] rounded bg-blue-100 text-blue-700">期望: {node.expected}</span>
                : <span className="ml-2 align-middle text-[10px] text-gray-400">执行成功即通过</span>}
              {node.loop_task && <span className="ml-2 align-middle px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700">循环</span>}
              {!node.reversible && <span className="ml-2 align-middle text-[10px]" title="不可回退">🔒</span>}
            </div>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onRunNode && (
            <button className="px-2 py-0.5 text-xs border border-primary text-primary rounded hover:bg-primary-soft"
                    onClick={() => onRunNode(node.id)}
                    title="运行到这个节点（执行 root→该节点的整条链）">
              ▶ 运行
            </button>
          )}
          <button className="px-2 py-0.5 text-xs border rounded hover:bg-gray-100" onClick={() => setAdding(true)}>+ 步骤</button>
          {!node.ref_id && <button className="px-2 py-0.5 text-xs border rounded hover:bg-gray-100" onClick={() => setReusing(true)}>复用</button>}
          {!node.ref_id && (
            <button className={`px-2 py-0.5 text-xs border rounded hover:bg-gray-100 ${showHistory ? 'bg-gray-100' : ''}`}
                    onClick={() => setShowHistory(v => !v)} title="查看 / 清理这个节点的历史运行记录（影响下次运行的记忆）">
              记录{showHistory ? ' ▾' : ' ▸'}
            </button>
          )}
          {!node.ref_id && <button className="px-2 py-0.5 text-xs border rounded hover:bg-gray-100" onClick={() => setEditing(true)}>编辑</button>}
          <button className="px-2 py-0.5 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                  disabled={delMut.isPending}
                  onClick={() => { if (confirm('删除这个节点？子节点会上提到它的父节点。')) delMut.mutate() }}>
            删除
          </button>
        </div>
      </div>
      {adding && (
        <AddNodeForm suiteId={suiteId} parentId={node.id} indentPx={16 + indent + 18}
                     onDone={() => setAdding(false)} />
      )}
      {reusing && (
        <ReusePicker suiteId={suiteId} parentId={node.id} indentPx={16 + indent + 18}
                     onDone={() => setReusing(false)} />
      )}
      {showHistory && <NodeHistory nodeId={node.id} indentPx={16 + indent + 18} />}
      {node.children.map(c => (
        <NodeRow key={c.id} node={c} depth={depth + 1} suiteId={suiteId}
                 dragId={dragId} setDragId={setDragId} onRunNode={onRunNode} />
      ))}
    </>
  )
}

// ── Case-library reuse picker: search any suite, insert a snapshot copy ──────

function ReusePicker({ suiteId, parentId, indentPx, onDone }: {
  suiteId: string; parentId: string | null; indentPx: number; onDone: () => void
}) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<'copy' | 'link'>('copy')
  const { data: hits = [] } = useQuery({
    queryKey: ['node-search', q],
    queryFn: () => (q.trim() ? searchNodes(q.trim()) : Promise.resolve([] as NodeSearchHit[])),
    enabled: q.trim().length > 0,
  })
  const copyMut = useMutation({
    mutationFn: (sourceId: string) => copyNode(suiteId, sourceId, parentId, mode === 'link'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nodes', suiteId] }); onDone() },
  })
  return (
    <div className="py-3 border-t bg-blue-50" style={{ paddingLeft: indentPx, paddingRight: 16 }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-gray-500">搜索用例库复用一段流程</span>
        <div className="inline-flex rounded border text-[11px] overflow-hidden">
          {(['copy', 'link'] as const).map(m => (
            <button key={m} type="button"
                    className={`px-2 py-0.5 ${mode === m ? 'bg-primary text-white' : 'bg-white text-ink-mute hover:bg-gray-50'}`}
                    onClick={() => setMode(m)}>
              {m === 'copy' ? '快照拷贝' : '活链接'}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-400">{mode === 'copy' ? '拷一份，之后独立' : '存源引用，改源即同步'}</span>
      </div>
      <input autoFocus className="w-full border rounded px-2 py-1 text-sm mb-2"
             placeholder="搜索行为或期望，如「登录」「语音」" value={q} onChange={e => setQ(e.target.value)} />
      <div className="max-h-48 overflow-auto">
        {hits.map(h => (
          <button key={h.node_id} disabled={copyMut.isPending}
                  className="w-full text-left px-2 py-1 text-xs hover:bg-white rounded disabled:opacity-50"
                  onClick={() => copyMut.mutate(h.node_id)}>
            <span className="font-mono">{h.path}</span>
            {h.expected && <span className="text-blue-600"> · 期望:{h.expected}</span>}
            <span className="text-gray-400"> · {h.suite_name}</span>
          </button>
        ))}
        {q.trim() && hits.length === 0 && <div className="text-xs text-gray-400 px-2 py-1">没有匹配</div>}
      </div>
      <button className="mt-2 px-3 py-1 border text-xs rounded hover:bg-gray-100" onClick={onDone}>取消</button>
    </div>
  )
}

// ── Add-a-step form (child of parentId, or root when null) ───────────────────

function AddNodeForm({
  suiteId, parentId, indentPx, onDone,
}: {
  suiteId: string; parentId: string | null; indentPx: number; onDone: () => void
}) {
  const qc = useQueryClient()
  const [action, setAction] = useState('')
  const [expected, setExpected] = useState('')
  const addMut = useMutation({
    mutationFn: () => addNode(suiteId, { parent_id: parentId, action: action.trim(), expected: expected.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nodes', suiteId] }); onDone() },
  })
  return (
    <div className="py-3 bg-green-50 border-t" style={{ paddingLeft: indentPx, paddingRight: 16 }}>
      <div className="text-xs text-gray-500 mb-1">行为 / Action</div>
      <input autoFocus className="w-full border rounded px-2 py-1 text-sm mb-2 font-mono"
             placeholder="这一步做什么" value={action} onChange={e => setAction(e.target.value)} />
      <div className="text-xs text-gray-500 mb-1">期望 / Expected（可选）</div>
      <input className="w-full border rounded px-2 py-1 text-sm mb-2"
             placeholder="留空 = 执行成功即通过" value={expected}
             onChange={e => setExpected(e.target.value)}
             onKeyDown={e => { if (e.key === 'Enter' && action.trim()) addMut.mutate() }} />
      <div className="flex gap-2">
        <button className="px-3 py-1 bg-ok text-white text-xs rounded hover:bg-ok disabled:opacity-50"
                disabled={!action.trim() || addMut.isPending} onClick={() => addMut.mutate()}>
          {addMut.isPending ? '添加中…' : '添加'}
        </button>
        <button className="px-3 py-1 border text-xs rounded hover:bg-gray-100" onClick={onDone}>取消</button>
      </div>
    </div>
  )
}

// ── Editor root ─────────────────────────────────────────────────────────────

export default function StepTreeEditor({ suiteId, onRunNode }: { suiteId: string; onRunNode?: (nodeId: string) => void }) {
  const { data: nodes = [], isLoading } = useQuery({
    queryKey: ['nodes', suiteId],
    queryFn: () => fetchNodes(suiteId),
    retry: 1,  // fail fast instead of the default 3 retries if the route errors
  })
  const tree = useMemo(() => buildTree(nodes), [nodes])
  const [addingRoot, setAddingRoot] = useState(false)
  const [reusingRoot, setReusingRoot] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)

  if (isLoading) return <div className="p-4 text-sm text-gray-400">加载步骤树…</div>

  return (
    <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
      {tree.length === 0 && !addingRoot && (
        <div className="px-4 py-6 text-sm text-gray-400 text-center">还没有步骤。点下面「+ 根步骤」开始。</div>
      )}
      {tree.map(n => (
        <NodeRow key={n.id} node={n} depth={0} suiteId={suiteId} dragId={dragId} setDragId={setDragId} onRunNode={onRunNode} />
      ))}
      {reusingRoot && (
        <ReusePicker suiteId={suiteId} parentId={null} indentPx={16} onDone={() => setReusingRoot(false)} />
      )}
      {addingRoot
        ? <AddNodeForm suiteId={suiteId} parentId={null} indentPx={16} onDone={() => setAddingRoot(false)} />
        : (
          <div className="flex border-t">
            <button className="flex-1 text-left px-4 py-2.5 text-sm text-primary hover:bg-primary-soft"
                    onClick={() => setAddingRoot(true)}>+ 根步骤</button>
            <button className="px-4 py-2.5 text-sm text-blue-600 hover:bg-blue-50 border-l"
                    onClick={() => setReusingRoot(true)}>从用例库复用</button>
          </div>
        )}
    </div>
  )
}
