package com.dream.smart_androidbot.ui

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.dream.smart_androidbot.R
import com.dream.smart_androidbot.config.ConfigManager
import com.dream.smart_androidbot.databinding.ActivityMainBinding
import com.dream.smart_androidbot.keepalive.KeepAliveController
import com.dream.smart_androidbot.keepalive.KeepAliveService
import com.dream.smart_androidbot.keepalive.KeepAliveSetup
import com.dream.smart_androidbot.keepalive.KeepAliveStore
import com.dream.smart_androidbot.service.AgentAccessibilityService
import com.dream.smart_androidbot.service.ReverseConnectionService
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var config: ConfigManager
    private val statusHandler = Handler(Looper.getMainLooper())
    private val statusRunnable = Runnable { refreshStatus() }

    // Runtime permissions requested on first launch. Requested as ONE batch —
    // Android shows only one permission dialog at a time, so launching several
    // single-permission requests back-to-back drops all but the first (the app
    // list one then only appeared on the 2nd launch). RequestMultiplePermissions
    // queues them so every prompt is shown in sequence on the first launch.
    private val permsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* results don't block usage; everything degrades gracefully */ }

    // QR scanner (ZXing). The CaptureActivity handles the CAMERA runtime prompt.
    private val qrScanLauncher = registerForActivityResult(ScanContract()) { result ->
        val contents = result.contents
        if (contents == null) {
            Toast.makeText(this, "扫码已取消", Toast.LENGTH_SHORT).show()
        } else {
            applyScannedPayload(contents)
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        config = ConfigManager.getInstance(this)

        // Request the runtime permissions we need, all in one batch (see
        // permsLauncher) so every prompt shows on the first launch:
        //  - POST_NOTIFICATIONS (Android 13+)
        //  - GET_INSTALLED_APPS — the installed-app list; on MIUI/HyperOS this is
        //    a runtime permission. Only added on ROMs that actually define it.
        val wanted = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            wanted += android.Manifest.permission.POST_NOTIFICATIONS
        }
        val installedAppsPerm = "com.android.permission.GET_INSTALLED_APPS"
        val appListPermDefined = try {
            packageManager.getPermissionInfo(installedAppsPerm, 0); true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
        if (appListPermDefined &&
            checkSelfPermission(installedAppsPerm) != PackageManager.PERMISSION_GRANTED
        ) {
            wanted += installedAppsPerm
        }
        if (wanted.isNotEmpty()) permsLauncher.launch(wanted.toTypedArray())

        // Populate config fields
        binding.editServerUrl.setText(config.serverUrl)
        binding.editToken.setText(config.token)
        binding.editDeviceName.setText(config.deviceName)
        binding.textDeviceId.text = "ID: ${config.deviceId}"

        // Keep-alive toggle
        binding.switchKeepAlive.isChecked = KeepAliveStore.getInstance(this).keepScreenAwakeEnabled
        binding.switchKeepAlive.setOnCheckedChangeListener { _, checked ->
            KeepAliveController.setEnabled(this, checked)
            Toast.makeText(
                this,
                if (checked) "Keep-Alive enabled" else "Keep-Alive disabled",
                Toast.LENGTH_SHORT
            ).show()
        }

        // Status card button actions
        binding.btnEnableAccessibility.setOnClickListener { openAccessibilitySettings() }
        binding.btnEnableIme.setOnClickListener { openImeSettings() }
        binding.btnBackgroundSetup.setOnClickListener { openBackgroundSetup() }

        // Scan QR from the Web UI to fill server URL + token and connect
        binding.btnScanQr.setOnClickListener {
            val options = ScanOptions().apply {
                setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                setPrompt("对准 Web 设备页上的二维码")
                setBeepEnabled(false)
                setOrientationLocked(true)
                setCaptureActivity(PortraitCaptureActivity::class.java)
            }
            qrScanLauncher.launch(options)
        }

        // Config buttons
        binding.btnSave.setOnClickListener {
            saveConfig()
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        }

        binding.btnConnect.setOnClickListener {
            saveConfig()
            if (config.token.isBlank()) {
                Toast.makeText(this, "Token is required", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (!isAccessibilityEnabled()) {
                Toast.makeText(this, "Please enable Accessibility Service first", Toast.LENGTH_LONG).show()
                openAccessibilitySettings()
                return@setOnClickListener
            }
            startForegroundService(
                Intent(this, ReverseConnectionService::class.java).apply {
                    action = ReverseConnectionService.ACTION_START
                }
            )
            Toast.makeText(this, "Connecting…", Toast.LENGTH_SHORT).show()
        }

        binding.btnDisconnect.setOnClickListener {
            startService(
                Intent(this, ReverseConnectionService::class.java).apply {
                    action = ReverseConnectionService.ACTION_STOP
                }
            )
            Toast.makeText(this, "Disconnected", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        scheduleStatusRefresh()
    }

    override fun onPause() {
        super.onPause()
        statusHandler.removeCallbacks(statusRunnable)
    }

    // ── Status refresh ────────────────────────────────────────────────────────

    private fun scheduleStatusRefresh() {
        statusHandler.postDelayed(statusRunnable, 1_500)
    }

    private fun refreshStatus() {
        updateAccessibilityCard()
        updateImeCard()
        updateBackgroundCard()
        updateConnectionCard()
        // Sync switch to service runtime state (in case service stopped itself)
        binding.switchKeepAlive.setOnCheckedChangeListener(null)
        binding.switchKeepAlive.isChecked = KeepAliveService.isRunning()
        binding.switchKeepAlive.setOnCheckedChangeListener { _, checked ->
            KeepAliveController.setEnabled(this, checked)
        }
        scheduleStatusRefresh()
    }

    private fun updateBackgroundCard() {
        val battery = KeepAliveSetup.isBatteryUnrestricted(this)
        val overlay = KeepAliveSetup.canDrawOverlays(this)
        val appList = canListApps()
        fun mark(b: Boolean) = if (b) "✓" else "✗"
        // Green only when every AUTO-DETECTABLE critical passes. 后台弹出界面 and
        // 自启动 have no query API on MIUI, so they can't be verified here — they
        // are flagged for manual confirmation rather than faked as done.
        val ok = battery && overlay && appList
        setDotColor(binding.dotBackground, ok, warn = !ok)
        binding.textBackgroundStatus.text =
            "悬浮窗 ${mark(overlay)} · 省电豁免 ${mark(battery)} · 读取应用列表 ${mark(appList)}\n" +
            "后台弹出界面 / 自启动：无法自动检测，请在权限页确认已开"
        binding.btnBackgroundSetup.text = if (ok) "再设置" else "一键设置"
    }

    private fun openBackgroundSetup() {
        // Step 1: ask for battery-optimization exemption (system dialog).
        if (!KeepAliveSetup.isBatteryUnrestricted(this)) {
            KeepAliveSetup.requestBatteryExemption(this)
        }
        // Step 2: grant the overlay permission — the portable BAL exemption that
        // lets the backgrounded app launch other apps via start_app.
        if (!KeepAliveSetup.canDrawOverlays(this)) {
            KeepAliveSetup.requestOverlayPermission(this)
            Toast.makeText(
                this,
                "请允许「显示悬浮窗 / 在其他应用上层显示」——这是后台启动 App 的关键",
                Toast.LENGTH_LONG,
            ).show()
            return  // let the user finish this grant before jumping further
        }
        // Step 3: OEM auto-start page (keep-alive on boot).
        KeepAliveSetup.openAutostartSettings(this)
        // Step 4: on MIUI/HyperOS also open the per-app permission editor — its
        // 后台弹出界面 / 读取应用列表 toggles are what let the agent launch apps
        // and enumerate them; they have no standard request API. Opened last so
        // it lands on top. No-op on non-MIUI ROMs.
        KeepAliveSetup.openAppPermissionEditor(this)
        Toast.makeText(this, "逐项开启后返回本页，卡片会显示每项状态", Toast.LENGTH_SHORT).show()
    }

    private fun updateAccessibilityCard() {
        val enabled = isAccessibilityEnabled()
        setDotColor(binding.dotAccessibility, enabled)
        binding.textAccessibilityStatus.text =
            if (enabled) "Active — gestures and screen reading ready"
            else "Not enabled — tap Enable to open settings"
        binding.btnEnableAccessibility.text = if (enabled) "Enabled ✓" else "Enable"
        binding.btnEnableAccessibility.isEnabled = !enabled
    }

    private fun updateImeCard() {
        val enabled = isImeEnabled()
        val selected = isImeSelected()
        val ok = enabled && selected
        setDotColor(binding.dotIme, ok, warn = enabled && !selected)
        binding.textImeStatus.text = when {
            ok          -> "Active — reliable text input ready"
            enabled     -> "Enabled but not selected — tap Switch to activate"
            else        -> "Not enabled — tap Setup to open Input Method settings"
        }
        binding.btnEnableIme.text = when {
            ok      -> "Selected ✓"
            enabled -> "Switch"
            else    -> "Setup"
        }
        binding.btnEnableIme.isEnabled = !ok
    }

    private fun updateConnectionCard() {
        when (ReverseConnectionService.connectionState()) {
            ReverseConnectionService.ConnState.CONNECTED -> {
                setDotColor(binding.dotConnection, ok = true)
                binding.textConnectionStatus.text = "已连接 ✓ — ${config.serverUrl}"
            }
            ReverseConnectionService.ConnState.CONNECTING -> {
                setDotColor(binding.dotConnection, ok = false, warn = true)
                binding.textConnectionStatus.text = "连接中… — ${config.serverUrl}"
            }
            ReverseConnectionService.ConnState.STOPPED -> {
                setDotColor(binding.dotConnection, ok = false)
                binding.textConnectionStatus.text = "未连接"
            }
        }
    }

    // ── Dot color helper ──────────────────────────────────────────────────────

    private fun setDotColor(dot: android.view.View, ok: Boolean, warn: Boolean = false) {
        val color = when {
            ok   -> ContextCompat.getColor(this, R.color.dot_green)
            warn -> ContextCompat.getColor(this, R.color.dot_orange)
            else -> ContextCompat.getColor(this, R.color.dot_red)
        }
        (dot.background as? android.graphics.drawable.GradientDrawable)?.setColor(color)
    }

    // ── Permission checks ─────────────────────────────────────────────────────

    private fun isAccessibilityEnabled(): Boolean =
        AgentAccessibilityService.getInstance() != null

    /** Functional check for the installed-app-list permission: if we can see any
     *  package other than ourselves, enumeration works. On MIUI without the
     *  「读取应用列表」grant, getInstalledApplications returns only this app. */
    private fun canListApps(): Boolean = try {
        packageManager.getInstalledApplications(0).any { it.packageName != packageName }
    } catch (_: Exception) { false }

    private fun isImeEnabled(): Boolean = try {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.enabledInputMethodList.any {
            it.packageName == packageName && it.serviceName.contains("AgentKeyboardIME")
        }
    } catch (_: Exception) { false }

    private fun isImeSelected(): Boolean {
        val selected = Settings.Secure.getString(
            contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD
        ) ?: return false
        return selected.contains(packageName)
    }

    // ── Navigation to system settings ─────────────────────────────────────────

    private fun openAccessibilitySettings() {
        try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        } catch (_: Exception) {
            Toast.makeText(this, "Cannot open Accessibility Settings", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openImeSettings() {
        try {
            if (isImeEnabled()) {
                // Already enabled — show input method picker to let user switch
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                @Suppress("DEPRECATION")
                imm.showInputMethodPicker()
            } else {
                startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
            }
        } catch (_: Exception) {
            Toast.makeText(this, "Cannot open Input Method Settings", Toast.LENGTH_SHORT).show()
        }
    }

    // ── Config helpers ────────────────────────────────────────────────────────

    private fun saveConfig() {
        config.serverUrl = binding.editServerUrl.text.toString().trim()
        config.token = binding.editToken.text.toString().trim()
        config.deviceName = binding.editDeviceName.text.toString().trim()
    }

    // ── QR pairing ────────────────────────────────────────────────────────────

    /**
     * Parse a `smartbot://connect?url=…&token=…&name=…` payload from a scanned QR,
     * write it into config + the input fields, and auto-connect.
     */
    private fun applyScannedPayload(raw: String) {
        val uri = try { Uri.parse(raw.trim()) } catch (_: Exception) { null }
        if (uri == null || uri.scheme != "smartbot" || uri.host != "connect") {
            Toast.makeText(this, "二维码无效（不是 Smart-AI-Bot 连接码）", Toast.LENGTH_LONG).show()
            return
        }
        val url = uri.getQueryParameter("url")?.trim().orEmpty()
        val token = uri.getQueryParameter("token")?.trim().orEmpty()
        val name = uri.getQueryParameter("name")?.trim().orEmpty()
        if (url.isBlank() || token.isBlank()) {
            Toast.makeText(this, "二维码缺少 url 或 token", Toast.LENGTH_LONG).show()
            return
        }

        config.serverUrl = url
        config.token = token
        if (name.isNotBlank()) config.deviceName = name

        // Reflect into the visible fields so the user sees what was paired.
        binding.editServerUrl.setText(url)
        binding.editToken.setText(token)
        if (name.isNotBlank()) binding.editDeviceName.setText(name)

        if (!isAccessibilityEnabled()) {
            Toast.makeText(this, "已读取连接信息 — 请先开启无障碍服务再连接", Toast.LENGTH_LONG).show()
            openAccessibilitySettings()
            return
        }

        startForegroundService(
            Intent(this, ReverseConnectionService::class.java).apply {
                action = ReverseConnectionService.ACTION_START
            }
        )
        Toast.makeText(this, "已读取连接信息，正在连接…", Toast.LENGTH_SHORT).show()
    }
}
