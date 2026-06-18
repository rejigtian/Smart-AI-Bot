import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  fetchDevices, createDevice, deleteDevice, fetchAppInfo, fetchServerInfo, Device,
} from '../lib/api'

// A phone can't reach the server via localhost. So when the page is opened on
// localhost we swap in the backend-reported LAN IP (keeping the browsed port,
// which nginx/vite proxy /v1 and /api through). When opened via a real IP or a
// public domain, location.host is already reachable, so we keep it as-is.
function reachableHost(lanIp?: string): string {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  if (isLocal && lanIp) {
    return location.port ? `${lanIp}:${location.port}` : lanIp
  }
  return location.host
}

function wsJoinUrl(lanIp?: string): string {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
  return `${proto}${reachableHost(lanIp)}/v1/providers/join`
}

function httpBase(lanIp?: string): string {
  return `${location.protocol}//${reachableHost(lanIp)}`
}

// Build the pairing payload the Portal app scans.
function buildConnectUri(device: Device, lanIp?: string): { uri: string; wsUrl: string } {
  const wsUrl = wsJoinUrl(lanIp)
  const params = new URLSearchParams({ url: wsUrl, token: device.token, name: device.name })
  return { uri: `smartbot://connect?${params.toString()}`, wsUrl }
}

export default function Devices() {
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [qrDevice, setQrDevice] = useState<Device | null>(null)
  const [showDownload, setShowDownload] = useState(false)

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: fetchDevices,
    refetchInterval: 5000,
  })

  const { data: appInfo } = useQuery({ queryKey: ['app-info'], queryFn: fetchAppInfo })
  const { data: serverInfo } = useQuery({ queryKey: ['server-info'], queryFn: fetchServerInfo })
  const lanIp = serverInfo?.lan_ip
  const downloadUrl = `${httpBase(lanIp)}/api/app/download`

  const createMut = useMutation({
    mutationFn: () => createDevice(newName || 'New Device'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devices'] }); setNewName('') },
  })

  const deleteMut = useMutation({
    mutationFn: deleteDevice,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  })

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

      <div className="grid gap-4">
        {devices.map(d => (
          <div key={d.id} className="bg-white border rounded-lg p-4 flex items-center gap-4 shadow-sm">
            <span
              className={`w-3 h-3 rounded-full flex-shrink-0 ${
                d.status === 'online' ? 'bg-ok' : 'bg-gray-300'
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{d.name}</span>
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
                onClick={() => setQrDevice(d)}
              >
                Show QR
              </button>
              <button
                className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                onClick={() => copyToken(d)}
              >
                {copiedId === d.id ? '✓ Copied' : 'Copy Token'}
              </button>
              <button
                className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50"
                onClick={() => {
                  if (confirm(`Delete device "${d.name}"?`)) deleteMut.mutate(d.id)
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {devices.length > 0 && (
        <div className="mt-6 p-4 bg-primary-soft rounded-lg text-sm text-primary-deep">
          <strong>Portal setup:</strong> In the Portal app, tap <strong>扫码连接 (Scan QR)</strong> and point it at a
          device's QR code — or set the server URL to{' '}
          <code className="bg-primary-soft px-1 rounded">{wsJoinUrl(lanIp)}</code>{' '}
          and paste the token manually. Use this LAN address from a phone on the same
          network; for a public server, configure a domain (see deployment docs).
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
              <QRCodeSVG value={buildConnectUri(qrDevice, lanIp).uri} size={240} includeMargin />
            </div>
            <p className="text-xs text-gray-400 mb-1">
              In the Portal app tap <strong>扫码连接 (Scan QR)</strong>
            </p>
            <p className="text-xs text-gray-400 font-mono break-all mb-4">
              {buildConnectUri(qrDevice, lanIp).wsUrl}
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
