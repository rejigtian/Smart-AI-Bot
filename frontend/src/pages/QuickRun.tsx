import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { fetchDevices, fetchSettings, fetchProjects, quickRun } from '../lib/api'
import { useT } from '../lib/i18n'

const PROVIDERS = ['openai', 'anthropic', 'bedrock', 'google', 'zhipuai', 'groq', 'ollama']

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  bedrock: 'us.anthropic.claude-sonnet-4-6',
  google: 'gemini-1.5-pro',
  zhipuai: 'glm-4v',
  groq: 'llama-3.1-70b-versatile',
  ollama: 'llama3',
}

export default function QuickRun() {
  const navigate = useNavigate()
  const t = useT()

  const [goal, setGoal] = useState('')
  const [expected, setExpected] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('gpt-4o')
  const [maxSteps, setMaxSteps] = useState(20)
  const [appPackage, setAppPackage] = useState('')
  const settingsInitialized = useRef(false)

  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: fetchDevices, refetchInterval: 5000 })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects })

  const onlineDevices = devices.filter(d => d.status === 'online')

  // Apply saved defaults only once on first load
  useEffect(() => {
    if (settings && !settingsInitialized.current) {
      settingsInitialized.current = true
      if (settings.default_provider) setProvider(settings.default_provider)
      if (settings.default_model) setModel(settings.default_model)
    }
  }, [settings])

  function handleProviderChange(p: string) {
    setProvider(p)
    // Use saved default only if this is the saved default provider; otherwise use per-provider default
    if (settings && p === settings.default_provider && settings.default_model) {
      setModel(settings.default_model)
    } else {
      setModel(DEFAULT_MODELS[p] || '')
    }
  }

  const runMut = useMutation({
    mutationFn: () => quickRun({
      goal,
      expected: expected || '任务完成',
      device_id: deviceId,
      provider,
      model,
      max_steps: maxSteps,
      app_package: appPackage,
    }),
    onSuccess: run => navigate(`/runs/${run.id}`),
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(e)
      alert(`${t('启动失败', 'Failed to start')}: ${msg}`)
    },
  })

  const canSubmit = goal.trim().length > 0 && deviceId.length > 0 && !runMut.isPending

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t('快速任务', 'Quick Task')}</h1>

      <div className="bg-white border rounded-lg p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            {t('任务描述', 'Task')} <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={4}
            className="w-full border rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder={t('描述你想让 Agent 完成的任务，例如：打开设置页面，检查 Wi-Fi 是否已开启', 'Describe the task for the Agent, e.g. open Settings and check whether Wi-Fi is on')}
            value={goal}
            onChange={e => setGoal(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            {t('预期结果', 'Expected result')} <span className="text-gray-400 font-normal">{t('（可选，不填则默认"任务完成"）', '(optional, defaults to "task complete")')}</span>
          </label>
          <input
            type="text"
            className="w-full border rounded px-3 py-1.5 text-sm"
            placeholder={t('例如：Wi-Fi 开关显示为开启状态', 'e.g. the Wi-Fi toggle shows as on')}
            value={expected}
            onChange={e => setExpected(e.target.value)}
          />
        </div>

        {projects.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('项目知识库', 'Project knowledge')} <span className="text-gray-400 font-normal">{t('（可选，导入对应项目档案的 KB）', '(optional, imports the KB of the matching project profile)')}</span>
            </label>
            <select
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={appPackage}
              onChange={e => setAppPackage(e.target.value)}
            >
              <option value="">— {t('不使用', 'None')} —</option>
              {projects.map(p => (
                <option key={p.id} value={p.app_package}>{p.name}（{p.app_package}）</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('设备', 'Device')}</label>
            {onlineDevices.length === 0 ? (
              <p className="text-sm text-red-500">{t('无在线设备', 'No online devices')}</p>
            ) : (
              <select
                className="w-full border rounded px-2 py-1.5 text-sm"
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
              >
                <option value="">— {t('选择设备', 'Select device')} —</option>
                {onlineDevices.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('最大步数', 'Max steps')}</label>
            <input
              type="number"
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={maxSteps}
              onChange={e => setMaxSteps(parseInt(e.target.value) || 20)}
              min={5}
              max={100}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Provider</label>
            <select
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={provider}
              onChange={e => handleProviderChange(e.target.value)}
            >
              {PROVIDERS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Model</label>
            <input
              type="text"
              className="w-full border rounded px-2 py-1.5 text-sm font-mono"
              value={model}
              onChange={e => setModel(e.target.value)}
            />
          </div>
        </div>

        <button
          className="w-full bg-primary text-white py-2 rounded font-medium hover:bg-primary-deep disabled:opacity-50 mt-2"
          disabled={!canSubmit}
          onClick={() => runMut.mutate()}
        >
          {runMut.isPending ? t('启动中…', 'Starting…') : t('▶ 开始任务', '▶ Start task')}
        </button>
      </div>
    </div>
  )
}
