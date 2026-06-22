import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchNodes, StepNode, TestResult } from '../lib/api'
import { useT } from '../lib/i18n'

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

// Does this subtree contain a failed result? (surface it on ancestors)
function hasFailure(node: TNode, byNode: Map<string, TestResult>): boolean {
  const own = byNode.get(node.id)?.status
  if (own === 'fail' || own === 'error') return true
  return node.children.some(c => hasFailure(c, byNode))
}

function ResultRow({
  node, depth, byNode, selectedId, onSelect, onStar,
}: {
  node: TNode; depth: number; byNode: Map<string, TestResult>
  selectedId?: string; onSelect: (r: TestResult) => void; onStar: (id: string) => void
}) {
  const t = useT()
  const own = byNode.get(node.id)
  // Only nodes with their OWN result show a status badge. Intermediate nodes
  // show nothing, except a small ⚠ when a descendant failed (easy to locate).
  const failedBelow = !own && hasFailure(node, byNode)
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
          <span className="text-sm">{node.action || <span className="text-gray-400">{t('（空步骤）', '(empty step)')}</span>}</span>
          {node.expected && (
            <span className="ml-2 align-middle px-1.5 py-0.5 text-[10px] rounded bg-blue-100 text-blue-700">{t('期望', 'Expected')}: {node.expected}</span>
          )}
        </div>
        {own && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${BADGE[own.status] || 'bg-gray-100 text-gray-500'}`}>
            {own.status}
          </span>
        )}
        {failedBelow && (
          <span className="text-[11px] text-red-500 flex-shrink-0" title={t('此分支下有失败用例', 'This branch contains a failed case')}>⚠</span>
        )}
        {own && (
          <button
            title={own.is_starred ? t('取消参考标记', 'Unmark reference') : t('标记为参考案例', 'Mark as reference case')}
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
  const t = useT()
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
        title={r.is_starred ? t('取消参考标记', 'Unmark reference') : t('标记为参考案例', 'Mark as reference case')}
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
  const t = useT()
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
          <div className="px-4 py-1.5 text-[11px] text-ink-faint bg-canvas-cool border-t">{t('其他结果（不在当前步骤树中）', 'Other results (not in current step tree)')}</div>
          {orphans.map(r => (
            <FlatRow key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} onStar={onStar} />
          ))}
        </>
      )}
    </div>
  )
}
