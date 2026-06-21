import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchNodes, StepNode, TestResult } from '../lib/api'

// Read-only step-tree with per-node run status. Shared prefix shown once;
// click a node that has a result to inspect its replay on the right.

type TNode = StepNode & { children: TNode[] }

function buildTree(nodes: StepNode[]): TNode[] {
  const byId = new Map<string, TNode>()
  nodes.forEach(n => byId.set(n.id, { ...n, children: [] }))
  const roots: TNode[] = []
  byId.forEach(n => {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id)!.children.push(n)
    else roots.push(n)
  })
  const sortRec = (l: TNode[]) => { l.sort((a, b) => a.order - b.order); l.forEach(c => sortRec(c.children)) }
  sortRec(roots)
  return roots
}

const BADGE: Record<string, string> = {
  pass: 'bg-green-100 text-green-700',
  fail: 'bg-red-100 text-red-700',
  error: 'bg-orange-100 text-orange-700',
  skip: 'bg-gray-100 text-gray-500',
  running: 'bg-blue-100 text-blue-700',
  pending: 'bg-gray-100 text-gray-400',
}

// Effective status of a node = its own result, else aggregate of descendants.
function aggStatus(node: TNode, byNode: Map<string, TestResult>): string | null {
  const own = byNode.get(node.id)?.status || null
  const kids = node.children.map(c => aggStatus(c, byNode)).filter(Boolean) as string[]
  const all = [own, ...kids].filter(Boolean) as string[]
  if (all.length === 0) return null
  if (all.some(s => s === 'fail' || s === 'error')) return 'fail'
  if (all.some(s => s === 'running' || s === 'pending')) return 'running'
  if (all.some(s => s === 'pass')) return 'pass'
  return all[0]
}

function ResultRow({
  node, depth, byNode, selectedId, onSelect, onStar,
}: {
  node: TNode; depth: number; byNode: Map<string, TestResult>
  selectedId?: string; onSelect: (r: TestResult) => void; onStar: (id: string) => void
}) {
  const own = byNode.get(node.id)
  const status = own?.status ?? aggStatus(node, byNode)
  const selected = own && selectedId === own.id
  return (
    <>
      <div
        className={`flex items-center gap-2 py-2 pr-3 border-t ${own ? 'cursor-pointer hover:bg-gray-50' : ''} ${selected ? 'bg-primary-soft' : ''}`}
        style={{ paddingLeft: 12 + depth * 18 }}
        onClick={() => own && onSelect(own)}
      >
        <span className="text-ink-faint select-none text-xs">{node.children.length ? '▾' : '·'}</span>
        <div className="flex-1 min-w-0">
          <span className="text-sm">{node.action || <span className="text-gray-400">（空步骤）</span>}</span>
          {node.expected && (
            <span className="ml-2 align-middle px-1.5 py-0.5 text-[10px] rounded bg-blue-100 text-blue-700">期望: {node.expected}</span>
          )}
        </div>
        {status && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${own ? (BADGE[status] || 'bg-gray-100 text-gray-500') : 'bg-gray-50 text-gray-400'}`}>
            {own ? status : `经过·${status}`}
          </span>
        )}
        {own && (
          <button
            title={own.is_starred ? '取消参考标记' : '标记为参考案例'}
            className={`flex-shrink-0 text-base leading-none ${own.is_starred ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-300'}`}
            onClick={e => { e.stopPropagation(); onStar(own.id) }}
          >
            ★
          </button>
        )}
      </div>
      {node.children.map(c => (
        <ResultRow key={c.id} node={c} depth={depth + 1} byNode={byNode}
                   selectedId={selectedId} onSelect={onSelect} onStar={onStar} />
      ))}
    </>
  )
}

function FlatRow({
  r, selectedId, onSelect, onStar,
}: {
  r: TestResult; selectedId?: string; onSelect: (r: TestResult) => void; onStar: (id: string) => void
}) {
  return (
    <div
      className={`flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer border-t ${selectedId === r.id ? 'bg-primary-soft' : ''}`}
      onClick={() => onSelect(r)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${BADGE[r.status] || 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
          <span className="text-xs text-gray-500 break-words flex-1">{r.path}</span>
        </div>
        <div className="text-sm mt-1 break-words">{r.expected}</div>
      </div>
      <button
        title={r.is_starred ? '取消参考标记' : '标记为参考案例'}
        className={`ml-2 flex-shrink-0 text-base leading-none ${r.is_starred ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-300'}`}
        onClick={e => { e.stopPropagation(); onStar(r.id) }}
      >
        ★
      </button>
    </div>
  )
}

export default function StepTreeResultView({
  suiteId, results, selectedId, onSelect, onStar,
}: {
  suiteId: string; results: TestResult[]
  selectedId?: string; onSelect: (r: TestResult) => void; onStar: (id: string) => void
}) {
  const { data: nodes = [] } = useQuery({ queryKey: ['nodes', suiteId], queryFn: () => fetchNodes(suiteId) })
  const tree = useMemo(() => buildTree(nodes), [nodes])
  const byNode = useMemo(() => {
    const m = new Map<string, TestResult>()
    results.forEach(r => m.set(r.case_id, r))
    return m
  }, [results])

  if (results.length === 0) {
    return (
      <div className="bg-white border rounded-lg shadow-sm">
        <p className="text-sm text-gray-400 px-4 py-6 text-center">Waiting for results…</p>
      </div>
    )
  }

  const nodeIds = new Set(nodes.map(n => n.id))
  const mapped = results.filter(r => nodeIds.has(r.case_id))
  // Legacy run (results key old case ids, not step nodes) -> flat fallback.
  if (mapped.length === 0) {
    return (
      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        {results.map(r => (
          <FlatRow key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} onStar={onStar} />
        ))}
      </div>
    )
  }

  const orphans = results.filter(r => !nodeIds.has(r.case_id))
  return (
    <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
      {tree.map(n => (
        <ResultRow key={n.id} node={n} depth={0} byNode={byNode}
                   selectedId={selectedId} onSelect={onSelect} onStar={onStar} />
      ))}
      {orphans.length > 0 && (
        <>
          <div className="px-4 py-1.5 text-[11px] text-ink-faint bg-canvas-cool border-t">其他结果（不在当前步骤树中）</div>
          {orphans.map(r => (
            <FlatRow key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} onStar={onStar} />
          ))}
        </>
      )}
    </div>
  )
}
