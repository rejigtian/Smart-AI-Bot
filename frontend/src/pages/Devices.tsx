import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  fetchDevices, createDevice, deleteDevice, renameDevice, fetchAppInfo, fetchServerInfo, Device,
} from '../lib/api'
import LivePanel from '../components/LivePanel'

// The phone-reachable host:port for the pairing QR. A phone can't reach the
// server via localhost, so on localhost we swap in the backend-reported LAN IP.
//
// Crucially, in Vite dev the page is served on :5173 but the device must talk
// to the BACKEND directly: the Vite WS proxy silently drops the connection
// ~every 16 min (code 1006). So in dev we target the backend's own port. In
// production the frontend is served by the backend (or nginx), so the browsed
// origin already points at the right place and we keep location.host/port.
function reachableHost(lanIp?: string, backendPort?: number): string {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  const ip = isLocal && lanIp ? lanIp : location.hostname
  if (import.meta.env.DEV && backendPort) {
    return `${ip}:${backendPort}`  // bypass the Vite dev proxy → connect to backend
  }
  if (isLocal) {
    return location.port ? `${ip}:${location.port}` : ip
  }
  return location.host
}

function wsJoinUrl(lanIp?: string, backendPort?: number): string {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
  return `${proto}${reachableHost(lanIp, backendPort)}/v1/providers/join`
}

function httpBase(lanIp?: string, backendPort?: number): string {
  return `${location.protocol}//${reachableHost(lanIp, backendPort)}`
}

// Build the pairing payload the Portal app scans.
function buildConnectUri(device: Device, lanIp?: string, backendPort?: number): { uri: string; wsUrl: string } {
  const wsUrl = wsJoinUrl(lanIp, backendPort)
  const params = new URLSearchParams({ url: wsUrl, token: device.token, name: device.name })
  return { uri: `smartbot://connect?${params.toString()}`, wsUrl }
}

export default function Devices() {
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [qrDevice, setQrDevice] = useState<Device | null>(null)
  const [showDownload, setShowDownload] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: fetchDevices,
    refetchInterval: 5000,
  })

  // Default the live-view selection to the first online device (or first device).
  useEffect(() => {
    if (selectedId && devices.some(d => d.id === selectedId)) return
    const preferred = devices.find(d => d.status === 'online') ?? devices[0]
    setSelectedId(preferred?.id ?? null)
  }, [devices, selectedId])

  const selectedDevice = devices.find(d => d.id === selectedId) ?? null

  const { data: appInfo } = useQuery({ queryKey: ['app-info'], queryFn: fetchAppInfo })
  const { data: serverInfo } = useQuery({ queryKey: ['server-info'], queryFn: fetchServerInfo })
  const lanIp = serverInfo?.lan_ip
  const backendPort = serverInfo?.port
  const downloadUrl = `${httpBase(lanIp, backendPort)}/api/app/download`

  const createMut = useMutation({
    mutationFn: () => createDevice(newName || 'New Device'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devices'] }); setNewName('') },
  })

  const deleteMut = useMutation({
    mutationFn: deleteDevice,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  })

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameDevice(id, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devices'] }); setEditingId(null) },
  })
  const saveEdit = () => {
    if (editingId && editName.trim()) renameMut.mutate({ id: editingId, name: editName.trim() })
    else setEditingId(null)
  }

  const copyToken = async (device: Device) => {
    const text = device.token
    try {
      // navigator.clipboard only exists in secure contexts (HTTPS / localhost).
      // When the UI is served over plain HTTP on a LAN/IP it is undefined, so
      // fall back to the legacy execCommand path.
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopiedId(device.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // Last resort: surface the token so the user can copy it by hand.
      window.prompt('Copy this token manually:', text)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Devices</h1>
        <div className="flex gap-2">
          <button
            className="border border-primary text-primary px-4 py-1.5 rounded text-sm hover:bg-primary-soft"
            onClick={() => setShowDownload(true)}
          >
            📱 安装 App
          </button>
          <input
            className="border rounded px-3 py-1.5 text-sm w-48"
            placeholder="Device name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createMut.mutate()}
          />
          <button
            className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-primary-deep disabled:opacity-50"
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
          >
            + Generate Token
          </button>
        </div>
      </div>

      {isLoading && <p className="text-gray-500">Loading…</p>}

      {devices.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No devices yet.</p>
          <p className="text-sm mt-1">Generate a token, then configure Portal app with it.</p>
        </div>
      )}

      {devices.length > 0 && (
        <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-6 lg:items-start">
          {/* Left — device list + pairing hint */}
          <div>
            <div className="grid gap-4">
              {devices.map(d => (
                <div
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className={`bg-white border rounded-lg p-4 flex items-center gap-4 shadow-sm cursor-pointer transition-colors ${
                    d.id === selectedId ? 'ring-2 ring-primary border-primary' : 'hover:border-hairline-strong'
                  }`}
                >
                  <span
                    className={`w-3 h-3 rounded-full flex-shrink-0 ${
                      d.status === 'online' ? 'bg-ok' : 'bg-gray-300'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {editingId === d.id ? (
                        <input
                          autoFocus
                          className="font-medium border rounded px-1.5 py-0.5 text-sm min-w-0 flex-1"
                          value={editName}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => {
                            e.stopPropagation()
                            if (e.key === 'Enter') saveEdit()
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          onBlur={saveEdit}
                        />
                      ) : (
                        <>
                          <span className="font-medium">{d.name}</span>
                          <button
                            className="text-xs text-gray-400 hover:text-primary"
                            title="重命名"
                            onClick={e => { e.stopPropagation(); setEditingId(d.id); setEditName(d.name) }}
                          >
                            ✎
                          </button>
                        </>
                      )}
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          d.status === 'online'
                            ? 'bg-green-100 text-ok'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {d.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 font-mono truncate">
                      ID: {d.id}
                    </div>
                    <div className="text-xs text-gray-400 font-mono truncate">
                      Token: {d.token.slice(0, 20)}…
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="text-xs px-3 py-1.5 border border-primary text-primary rounded hover:bg-primary-soft"
                      onClick={e => { e.stopPropagation(); setQrDevice(d) }}
                    >
                      Show QR
                    </button>
                    <button
                      className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                      onClick={e => { e.stopPropagation(); copyToken(d) }}
                    >
                      {copiedId === d.id ? '✓ Copied' : 'Copy Token'}
                    </button>
                    <button
                      className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50"
                      onClick={e => {
                        e.stopPropagation()
                        if (confirm(`Delete device "${d.name}"?`)) deleteMut.mutate(d.id)
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 bg-primary-soft rounded-lg text-sm text-primary-deep">
              <strong>Portal setup:</strong> In the Portal app, tap <strong>扫码连接 (Scan QR)</strong> and point it at a
              device's QR code — or set the server URL to{' '}
              <code className="bg-primary-soft px-1 rounded">{wsJoinUrl(lanIp, backendPort)}</code>{' '}
              and paste the token manually. Use this LAN address from a phone on the same
              network; for a public server, configure a domain (see deployment docs).
            </div>

            <details className="mt-3 px-4 py-3 border rounded-lg text-sm text-gray-600">
              <summary className="cursor-pointer font-medium text-primary-deep select-none">
                连不上 / 扫码无法访问？点此排查
              </summary>
              <ol className="list-decimal ml-5 mt-3 space-y-2">
                <li>
                  <strong>用的是局域网地址吗？</strong> 本页应通过{' '}
                  <code className="bg-gray-100 px-1 rounded">192.168.*</code> 这类内网 IP 打开（地址栏直接换成该 IP），
                  且手机和电脑在<strong>同一个路由器 / WiFi</strong> 下。当前发给设备的地址是{' '}
                  <code className="bg-gray-100 px-1 rounded break-all">{reachableHost(lanIp, backendPort)}</code>。
                </li>
                <li>
                  <strong>VPN / 虚拟网卡会让自动探测选错 IP。</strong> 装了公司 VPN、Radmin、Docker 等时，可能给出{' '}
                  <code className="bg-gray-100 px-1 rounded">10.*</code> / <code className="bg-gray-100 px-1 rounded">26.*</code>{' '}
                  这类手机访问不到的地址 —— 改用真实内网 IP 打开本页，或临时断开 VPN。
                </li>
                <li>
                  <strong>防火墙挡了吗？</strong> 用手机浏览器打开{' '}
                  <a
                    className="text-primary underline break-all"
                    href={`${httpBase(lanIp, backendPort)}/api/app/latest`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {`${httpBase(lanIp, backendPort)}/api/app/latest`}
                  </a>{' '}
                  —— 能看到 JSON 说明网络通；打不开多半是端口入站被防火墙拦了，需放行前端 / 后端端口。
                </li>
                <li>
                  <strong>安装与权限：</strong> 装 APK 时允许「未知来源」，装好后在系统设置里给它开启<strong>无障碍服务</strong>。
                </li>
                <li>
                  <strong>设备在外网？</strong> 跨网络时需配置域名 + <code className="bg-gray-100 px-1 rounded">wss://</code>，详见部署文档。
                </li>
              </ol>
            </details>
          </div>

          {/* Right — live screen */}
          <div className="mt-4 lg:mt-0">
            <LivePanel device={selectedDevice} />
          </div>
        </div>
      )}

      {showDownload && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowDownload(false)}
        >
          <div
            className="bg-white rounded-lg p-6 max-w-sm w-full text-center"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-1">扫码安装 App</h2>
            <p className="text-sm text-gray-500 mb-4">
              {appInfo?.available
                ? `Portal App ${appInfo.version ?? ''}`
                : '暂无可下载的安装包'}
            </p>
            {appInfo?.available ? (
              <>
                <div className="flex justify-center mb-4">
                  <QRCodeSVG value={downloadUrl} size={240} includeMargin />
                </div>
                <p className="text-xs text-gray-400 mb-1">
                  用手机浏览器扫码下载 APK，安装时允许「未知来源」
                </p>
                <a
                  href={downloadUrl}
                  className="text-xs text-primary font-mono break-all underline"
                >
                  {downloadUrl}
                </a>
              </>
            ) : (
              <p className="text-xs text-gray-400 mb-4">
                请先在 <code className="bg-gray-100 px-1 rounded">android/</code> 目录执行{' '}
                <code className="bg-gray-100 px-1 rounded">./gradlew assembleDebug</code> 生成并归档安装包。
              </p>
            )}
            <button
              className="w-full text-sm px-4 py-2 border rounded hover:bg-gray-50 mt-4"
              onClick={() => setShowDownload(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {qrDevice && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setQrDevice(null)}
        >
          <div
            className="bg-white rounded-lg p-6 max-w-sm w-full text-center"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-1">Scan to connect</h2>
            <p className="text-sm text-gray-500 mb-4">{qrDevice.name}</p>
            <div className="flex justify-center mb-4">
              <QRCodeSVG value={buildConnectUri(qrDevice, lanIp, backendPort).uri} size={240} includeMargin />
            </div>
            <p className="text-xs text-gray-400 mb-1">
              In the Portal app tap <strong>扫码连接 (Scan QR)</strong>
            </p>
            <p className="text-xs text-gray-400 font-mono break-all mb-4">
              {buildConnectUri(qrDevice, lanIp, backendPort).wsUrl}
            </p>
            <button
              className="w-full text-sm px-4 py-2 border rounded hover:bg-gray-50"
              onClick={() => setQrDevice(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
