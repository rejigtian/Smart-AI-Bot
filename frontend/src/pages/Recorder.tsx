import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, fetchDevices } from '../lib/api'
import { useT } from '../lib/i18n'

interface Element {
  index: number
  text: string
  className: string
  resourceId: string
  cx: number
  cy: number
}

interface Step {
  action: string
  args: Record<string, unknown>
  description: string
}

interface SnapshotData {
  screenshot_b64: string
  ui_text: string
  elements: Element[]
}

interface ActionData extends SnapshotData {
  result: string
  description: string
}

const BTN = 'px-3 py-1.5 text-xs rounded border font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const BTN_GRAY = `${BTN} border-gray-300 text-gray-700 hover:bg-gray-100`
const BTN_BLUE = `${BTN} border-primary bg-primary text-white hover:bg-primary-deep`
const BTN_RED  = `${BTN} border-red-400 text-red-600 hover:bg-red-50`

export default function Recorder() {
  const navigate = useNavigate()
  const t = useT()

  const { data: allDevices = [] } = useQuery({ queryKey: ['devices'], queryFn: fetchDevices, refetchInterval: 5000 })
  const onlineDevices = allDevices.filter(d => d.status === 'online')

  const [deviceId, setDeviceId] = useState('')
  const [recording, setRecording] = useState(false)
  const [screenshot, setScreenshot] = useState('')
  const [elements, setElements] = useState<Element[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Text input action state
  const [inputText, setInputText] = useState('')
  const [inputClear, setInputClear] = useState(false)

  // Save form
  const [suiteName, setSuiteName] = useState('')
  const [expected, setExpected] = useState('')
  const [saved, setSaved] = useState<{ suiteId: string } | null>(null)

  // ── Device selection helpers ────────────────────────────────────────────────
  const selectedDevice = allDevices.find(d => d.id === deviceId)

  const applySnapshot = (data: SnapshotData) => {
    setScreenshot(data.screenshot_b64)
    setElements(data.elements)
  }

  // ── API calls ───────────────────────────────────────────────────────────────
  const fetchSnapshot = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get<SnapshotData>(`/recorder/snapshot?device_id=${deviceId}`)
      applySnapshot(data)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Snapshot failed')
    } finally {
      setLoading(false)
    }
  }

  const doAction = async (action: string, args: Record<string, unknown>) => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post<ActionData>('/recorder/action', { device_id: deviceId, action, args })
      applySnapshot(data)
      setSteps(prev => [...prev, { action, args, description: data.description }])
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Action failed')
    } finally {
      setLoading(false)
    }
  }

  const startRecording = async () => {
    if (!deviceId) return
    setSteps([])
    setSaved(null)
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<SnapshotData>(`/recorder/snapshot?device_id=${deviceId}`)
      applySnapshot(data)
      setRecording(true)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to connect to device')
    } finally {
      setLoading(false)
    }
  }

  const stopRecording = () => {
    setRecording(false)
  }

  const resetRecording = () => {
    setRecording(false)
    setScreenshot('')
    setElements([])
    setSteps([])
    setSaved(null)
    setError('')
    setSuiteName('')
    setExpected('')
  }

  const saveRecording = async () => {
    if (!suiteName.trim() || !expected.trim() || steps.length === 0) return
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post<{ suite_id: string }>('/recorder/save', {
        device_id: deviceId,
        suite_name: suiteName.trim(),
        expected: expected.trim(),
        steps,
      })
      setSaved({ suiteId: data.suite_id })
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('录制测试用例', 'Record test case')}</h1>

      {/* Device selector (always visible) */}
      {!recording && (
        <div className="bg-white border rounded-lg p-4 shadow-sm mb-6 flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">{t('选择设备', 'Select device')}</label>
            {onlineDevices.length === 0 ? (
              <p className="text-sm text-gray-400">{t('暂无在线设备', 'No online devices')}</p>
            ) : (
              <select
                className="w-full border rounded px-3 py-1.5 text-sm"
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
              >
                <option value="">{t('— 请选择 —', '— Select —')}</option>
                {onlineDevices.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.id.slice(0, 8)}…)</option>
                ))}
              </select>
            )}
          </div>
          <button
            className={BTN_BLUE}
            disabled={!deviceId || loading}
            onClick={startRecording}
          >
            {loading ? t('连接中…', 'Connecting…') : t('▶ 开始录制', '▶ Start recording')}
          </button>
          <p className="w-full text-xs text-gray-400">
            {t('录制模式：选择设备后，在网页上操作即可控制手机并同步记录步骤，完成后保存为可重复运行的测试用例。', 'Recording mode: after selecting a device, operate in the browser to control the phone and record steps in sync, then save as a repeatable test case.')}
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Recording UI */}
      {recording && (
        <>
          {/* Control bar */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm font-medium">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse mr-1.5" />
              {t('录制中 — ', 'Recording — ')}{selectedDevice?.name ?? deviceId}
            </span>
            <button className={BTN_GRAY} disabled={loading} onClick={fetchSnapshot}>
              {loading ? '…' : t('⟳ 刷新截图', '⟳ Refresh screenshot')}
            </button>
            <button className={BTN_RED} onClick={stopRecording}>
              {t('⏹ 停止录制', '⏹ Stop recording')}
            </button>
            <span className="ml-auto text-sm text-gray-400">{steps.length} {t('步已录制', 'steps recorded')}</span>
          </div>

          {/* Main 2-column layout */}
          <div className="grid grid-cols-[1fr_340px] gap-5 mb-6">
            {/* Left: screenshot + action bar */}
            <div>
              {screenshot ? (
                <img
                  src={`data:image/png;base64,${screenshot}`}
                  alt="screen"
                  className="w-full rounded-lg border shadow-sm mb-3"
                />
              ) : (
                <div className="h-64 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-sm mb-3">
                  {t('截图加载中…', 'Loading screenshot…')}
                </div>
              )}

              {/* Action bar */}
              <div className="bg-white border rounded-lg p-3 shadow-sm space-y-2">
                {/* Scroll */}
                <div>
                  <div className="text-xs text-gray-400 mb-1.5 font-medium">{t('滚动', 'Scroll')}</div>
                  <div className="flex gap-2 flex-wrap">
                    {(['down', 'up', 'left', 'right'] as const).map(dir => {
                      const labels: Record<string, string> = { down: t('↓ 向下', '↓ Down'), up: t('↑ 向上', '↑ Up'), left: t('← 向左', '← Left'), right: t('→ 向右', '→ Right') }
                      return (
                        <button key={dir} className={BTN_GRAY} disabled={loading}
                          onClick={() => doAction('scroll', { direction: dir, distance: 'medium' })}>
                          {labels[dir]}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* System keys */}
                <div>
                  <div className="text-xs text-gray-400 mb-1.5 font-medium">{t('系统操作', 'System actions')}</div>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { action: 'back', label: t('↩ 返回', '↩ Back') },
                      { action: 'home', label: t('⌂ 主页', '⌂ Home') },
                      { action: 'recent', label: t('⊞ 最近', '⊞ Recent') },
                    ].map(({ action, label }) => (
                      <button key={action} className={BTN_GRAY} disabled={loading}
                        onClick={() => doAction('global_action', { action })}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Text input */}
                <div>
                  <div className="text-xs text-gray-400 mb-1.5 font-medium">{t('输入文本', 'Input text')}</div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      className="flex-1 border rounded px-2 py-1 text-sm"
                      placeholder={t('输入内容后点击「输入」', 'Type text then click "Input"')}
                      value={inputText}
                      onChange={e => setInputText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && inputText) {
                          doAction('input_text', { text: inputText, clear: inputClear })
                          setInputText('')
                        }
                      }}
                    />
                    <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none">
                      <input type="checkbox" checked={inputClear} onChange={e => setInputClear(e.target.checked)} />
                      {t('清空', 'Clear')}
                    </label>
                    <button
                      className={BTN_BLUE}
                      disabled={!inputText || loading}
                      onClick={() => {
                        doAction('input_text', { text: inputText, clear: inputClear })
                        setInputText('')
                      }}
                    >
                      {t('输入', 'Input')}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: element list */}
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                {t('UI 元素', 'UI elements')} ({elements.length})
              </div>
              <div className="bg-white border rounded-lg shadow-sm overflow-y-auto" style={{ maxHeight: '70vh' }}>
                {elements.length === 0 && (
                  <p className="text-sm text-gray-400 px-4 py-6 text-center">{t('暂无可交互元素', 'No interactive elements')}</p>
                )}
                {elements.map((el, i) => (
                  <button
                    key={el.index}
                    disabled={loading}
                    onClick={() => doAction('tap_element', { index: el.index })}
                    className={`w-full text-left px-3 py-2 hover:bg-primary-soft disabled:opacity-50 transition-colors ${
                      i > 0 ? 'border-t' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5 text-xs font-mono bg-gray-100 text-gray-500 rounded px-1">
                        {el.index}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm truncate">
                          {el.text || <span className="text-gray-400 italic">{el.className || 'element'}</span>}
                        </div>
                        {el.resourceId && (
                          <div className="text-xs text-gray-400 truncate">{el.resourceId}</div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Recorded steps */}
      {steps.length > 0 && (
        <div className="bg-white border rounded-lg shadow-sm p-4 mb-5">
          <div className="text-sm font-semibold mb-2">{t('已录制步骤', 'Recorded steps')}（{steps.length}）</div>
          <ol className="space-y-1">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 font-mono text-xs text-gray-400 mt-0.5 w-5 text-right">{i + 1}.</span>
                <span className="text-gray-700">{s.description}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Save form (shown when stopped with steps, or while recording) */}
      {(steps.length > 0) && !saved && (
        <div className="bg-white border rounded-lg shadow-sm p-4 space-y-3">
          <div className="text-sm font-semibold">{t('保存为测试用例', 'Save as test case')}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('套件名称', 'Suite name')}</label>
              <input
                type="text"
                className="w-full border rounded px-3 py-1.5 text-sm"
                placeholder={t('例：登录流程测试', 'e.g. Login flow test')}
                value={suiteName}
                onChange={e => setSuiteName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('期望结果', 'Expected result')}</label>
              <input
                type="text"
                className="w-full border rounded px-3 py-1.5 text-sm"
                placeholder={t('例：成功进入主页并显示欢迎语', 'e.g. Successfully reach the home page and show a welcome message')}
                value={expected}
                onChange={e => setExpected(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              className={BTN_BLUE}
              disabled={!suiteName.trim() || !expected.trim() || steps.length === 0 || loading}
              onClick={saveRecording}
            >
              {loading ? t('保存中…', 'Saving…') : t('✓ 保存为测试用例', '✓ Save as test case')}
            </button>
            <button className={BTN_GRAY} onClick={resetRecording}>
              {t('重置', 'Reset')}
            </button>
          </div>
        </div>
      )}

      {/* Success state */}
      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-4">
          <span className="text-ok font-medium">{t('✓ 测试用例已保存', '✓ Test case saved')}</span>
          <button
            className="text-sm text-primary hover:underline"
            onClick={() => navigate(`/suites/${saved.suiteId}`)}
          >
            {t('查看套件 →', 'View suite →')}
          </button>
          <button className={`${BTN_GRAY} ml-auto`} onClick={resetRecording}>
            {t('继续录制', 'Continue recording')}
          </button>
        </div>
      )}
    </div>
  )
}
