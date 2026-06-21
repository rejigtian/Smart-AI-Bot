import axios from 'axios'

export const api = axios.create({ baseURL: '/api' })

// ── Types ────────────────────────────────────────────────────────────────────

export interface Device {
  id: string
  name: string
  token: string
  status: 'online' | 'offline'
  last_seen: string
}

export interface Suite {
  id: string
  name: string
  source_format: string
  case_count: number
  created_at: string
}

export interface TestCase {
  id: string
  order: number
  path: string
  expected: string
  parameters: string
  loop_task: boolean
}

export interface Run {
  id: string
  suite_id: string
  suite_name: string | null
  device_id: string
  status: string
  provider: string
  model: string
  created_at: string
  finished_at: string | null
  passed: number
  failed: number
  errored: number
  skipped: number
  total: number
  total_tokens: number
  has_recording: boolean
}

export interface TestResult {
  id: string
  case_id: string
  path: string
  expected: string
  status: string
  reason: string
  steps: number
  screenshot_b64: string
  log: string
  started_at: string | null
  finished_at: string | null
  is_starred: boolean
  total_tokens: number
}

export interface StepLog {
  id: string
  step: number
  thought: string
  action: string
  action_result: string
  screenshot_b64: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  perception_ms: number
  llm_ms: number
  action_ms: number
  subgoal_index: number | null
  subgoal_desc: string
}

export interface Settings {
  openai_api_key: string
  anthropic_api_key: string
  anthropic_base_url: string
  gemini_api_key: string
  zhipu_api_key: string
  groq_api_key: string
  ollama_base_url: string
  aws_access_key_id: string
  aws_secret_access_key: string
  aws_region_name: string
  default_provider: string
  default_model: string
  verifier_provider: string
  verifier_model: string
  webhook_url: string
  webhook_type: string
}

// ── Devices ──────────────────────────────────────────────────────────────────

export const fetchDevices = () => api.get<Device[]>('/devices').then(r => r.data)
export const createDevice = (name: string) =>
  api.post<Device>('/devices', { name }).then(r => r.data)
export const deleteDevice = (id: string) => api.delete(`/devices/${id}`)

// ── App distribution (APK QR download) ───────────────────────────────────────

export interface AppInfo {
  available: boolean
  version?: string
  filename?: string
  size?: number
}

export const fetchAppInfo = () => api.get<AppInfo>('/app/latest').then(r => r.data)

export interface ServerInfo {
  lan_ip: string
  port: number  // backend's own port — phones connect here directly (not the dev-proxy port)
}

export const fetchServerInfo = () => api.get<ServerInfo>('/server/info').then(r => r.data)

// ── Live device screen ───────────────────────────────────────────────────────

export interface DeviceCapabilities {
  online: boolean
  adb_available: boolean
  adb_serials: string[]
}

export const fetchDeviceCapabilities = (id: string) =>
  api.get<DeviceCapabilities>(`/devices/${id}/capabilities`).then(r => r.data)

// ── Suites ───────────────────────────────────────────────────────────────────

export const fetchSuites = () => api.get<Suite[]>('/suites').then(r => r.data)
export const fetchSuite = (id: string) => api.get<Suite>(`/suites/${id}`).then(r => r.data)
export const fetchCases = (suiteId: string) =>
  api.get<TestCase[]>(`/suites/${suiteId}/cases`).then(r => r.data)
export const uploadSuite = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<Suite>('/suites', form).then(r => r.data)
}
export const deleteSuite = (id: string) => api.delete(`/suites/${id}`)

export interface TrendPoint {
  run_id: string
  created_at: string
  provider: string
  model: string
  passed: number
  failed: number
  errored: number
  total: number
  pass_rate: number
}

export const fetchTrends = (suiteId: string) =>
  api.get<TrendPoint[]>(`/suites/${suiteId}/trends`).then(r => r.data)

// ── Runs ─────────────────────────────────────────────────────────────────────

export const fetchRuns = (suiteId?: string) =>
  api.get<Run[]>('/runs', { params: suiteId ? { suite_id: suiteId } : {} }).then(r => r.data)
export const fetchRun = (id: string) => api.get<Run>(`/runs/${id}`).then(r => r.data)
export const fetchResults = (runId: string) =>
  api.get<TestResult[]>(`/runs/${runId}/results`).then(r => r.data)
export const startRun = (body: {
  suite_id: string
  device_id: string
  provider: string
  model: string
  max_steps?: number
  max_retries?: number
  isolated?: boolean
}) => api.post<Run>('/runs', body).then(r => r.data)
export const batchRun = (body: {
  suite_id: string
  device_id: string
  provider: string
  model: string
  max_steps?: number
  base_path: string
  case_ids: string[]
}) => api.post<Run>('/runs/batch', body).then(r => r.data)
export const quickRun = (body: {
  goal: string
  expected?: string
  device_id: string
  provider: string
  model: string
  max_steps?: number
}) => api.post<Run>('/runs/quick', body).then(r => r.data)
export const cancelRun = (id: string) => api.post(`/runs/${id}/cancel`)
export const deleteRun = (id: string) => api.delete(`/runs/${id}`)
export const starResult = (runId: string, resultId: string) =>
  api.post<{ id: string; is_starred: boolean }>(`/runs/${runId}/results/${resultId}/star`).then(r => r.data)
export const fetchSteps = (runId: string, resultId: string) =>
  api.get<StepLog[]>(`/runs/${runId}/results/${resultId}/steps`).then(r => r.data)

// ── Run Comparison ───────────────────────────────────────────────────────────

export interface CompareItem {
  case_id: string
  path: string
  expected: string
  status_a: string | null
  status_b: string | null
  reason_a: string
  reason_b: string
  steps_a: number
  steps_b: number
}

export interface CompareOut {
  run_a: Run
  run_b: Run
  cases: CompareItem[]
  summary: { improved: number; regressed: number; unchanged: number }
}

export const compareRuns = (a: string, b: string) =>
  api.get<CompareOut>('/runs/compare', { params: { a, b } }).then(r => r.data)

// ── Case CRUD ─────────────────────────────────────────────────────────────────

export const addCase = (suiteId: string, data: { path: string; expected: string; loop_task?: boolean }) =>
  api.post<TestCase>(`/suites/${suiteId}/cases`, data).then(r => r.data)

// ── Per-case run history (memory hygiene) ─────────────────────────────────────

export interface CaseResult {
  id: string
  run_id: string
  status: string
  reason: string
  steps: number
  total_tokens: number
  is_starred: boolean
  provider: string
  model: string
  created_at: string
  finished_at: string | null
}

export const fetchCaseResults = (suiteId: string, caseId: string) =>
  api.get<CaseResult[]>(`/suites/${suiteId}/cases/${caseId}/results`).then(r => r.data)

export const deleteCaseResult = (suiteId: string, caseId: string, resultId: string) =>
  api.delete(`/suites/${suiteId}/cases/${caseId}/results/${resultId}`)

export const purgeCaseResults = (suiteId: string, caseId: string, scope: 'all' | 'failed') =>
  api.delete<{ deleted: number }>(`/suites/${suiteId}/cases/${caseId}/results`, { params: { scope } })
    .then(r => r.data)
export const updateCase = (
  suiteId: string,
  caseId: string,
  data: { path: string; expected: string; loop_task?: boolean },
) =>
  api.put<TestCase>(`/suites/${suiteId}/cases/${caseId}`, data).then(r => r.data)
export const deleteCase = (suiteId: string, caseId: string) =>
  api.delete(`/suites/${suiteId}/cases/${caseId}`)

// ── Step-tree nodes ───────────────────────────────────────────────────────────

export interface StepNode {
  id: string
  suite_id: string
  parent_id: string | null
  action: string
  expected: string
  order: number
  reversible: boolean
  loop_task: boolean
}

export const fetchNodes = (suiteId: string) =>
  api.get<StepNode[]>(`/suites/${suiteId}/nodes`).then(r => r.data)

export const addNode = (
  suiteId: string,
  data: { parent_id: string | null; action: string; expected?: string; loop_task?: boolean },
) => api.post<StepNode>(`/suites/${suiteId}/nodes`, data).then(r => r.data)

export const updateNode = (
  suiteId: string,
  nodeId: string,
  data: { action?: string; expected?: string; loop_task?: boolean; reversible?: boolean },
) => api.put<StepNode>(`/suites/${suiteId}/nodes/${nodeId}`, data).then(r => r.data)

export const moveNode = (suiteId: string, nodeId: string, newParentId: string | null) =>
  api.post<StepNode>(`/suites/${suiteId}/nodes/${nodeId}/move`, { new_parent_id: newParentId }).then(r => r.data)

export const deleteNode = (suiteId: string, nodeId: string) =>
  api.delete(`/suites/${suiteId}/nodes/${nodeId}`)

export const runTree = (data: { suite_id: string; device_id: string; provider: string; model: string; max_steps: number }) =>
  api.post<Run>('/runs/tree', data).then(r => r.data)

export const runNode = (data: { suite_id: string; device_id: string; node_id: string; provider: string; model: string; max_steps: number }) =>
  api.post<Run>('/runs/node', data).then(r => r.data)

export interface NodeSearchHit {
  node_id: string
  suite_id: string
  suite_name: string
  path: string
  expected: string
}

export const searchNodes = (q: string) =>
  api.get<NodeSearchHit[]>('/nodes/search', { params: { q } }).then(r => r.data)

export const copyNode = (suiteId: string, sourceNodeId: string, parentId: string | null) =>
  api.post<StepNode[]>(`/suites/${suiteId}/nodes/copy`, { source_node_id: sourceNodeId, parent_id: parentId }).then(r => r.data)

// ── Settings ─────────────────────────────────────────────────────────────────

export const fetchSettings = () => api.get<Settings>('/settings').then(r => r.data)
export const saveSettings = (data: Partial<Settings>) =>
  api.put<Settings>('/settings', data).then(r => r.data)
