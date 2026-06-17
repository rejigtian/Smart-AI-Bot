package com.dream.smart_androidbot.api

import android.content.Intent
import android.view.KeyEvent
import androidx.core.content.FileProvider
import com.dream.smart_androidbot.core.StateRepository
import com.dream.smart_androidbot.input.AgentKeyboardIME
import com.dream.smart_androidbot.service.AgentAccessibilityService
import com.dream.smart_androidbot.service.GestureController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URL
import android.accessibilityservice.AccessibilityService as A11yService

class ApiHandler(private val context: android.content.Context) {

    // ── Ping ──────────────────────────────────────────────────────────────────

    fun ping(): ApiResponse = ApiResponse.Success("pong")

    // ── Gestures — absolute pixel coordinates ────────────────────────────────
    // The backend (ws_device.py) converts normalized 0-1000 → absolute pixels
    // before sending, so no coordinate conversion is needed here.

    suspend fun performTapAbs(x: Int, y: Int): ApiResponse {
        val ok = GestureController.tap(x, y)
        return if (ok) ApiResponse.Success("Tapped ($x, $y)")
        else ApiResponse.Error("Gesture dispatch failed — accessibility service may not be running")
    }

    suspend fun performSwipeAbs(
        startX: Int, startY: Int,
        endX: Int, endY: Int,
        durationMs: Long = 500
    ): ApiResponse {
        val ok = GestureController.swipe(startX, startY, endX, endY, durationMs)
        return if (ok) ApiResponse.Success("Swipe ($startX,$startY)→($endX,$endY)")
        else ApiResponse.Error("Swipe gesture failed")
    }

    // ── Global action by int code ─────────────────────────────────────────────

    fun performGlobalActionCode(code: Int): ApiResponse {
        val ok = GestureController.performGlobalAction(code)
        return if (ok) ApiResponse.Success("Global action code $code")
        else ApiResponse.Error("Global action failed: code $code")
    }

    // ── Apps ──────────────────────────────────────────────────────────────────

    fun launchApp(packageName: String, activity: String = ""): ApiResponse {
        // Launch from the AccessibilityService context — accessibility services are
        // exempt from Android 10+ background-activity-launch (BAL) restrictions, so
        // the target app reliably comes to the foreground. Launching from the plain
        // app context (we run in the background) gets silently blocked: startActivity
        // doesn't throw but the foreground transition never happens.
        val launcher: android.content.Context =
            AgentAccessibilityService.getInstance() ?: context
        val pm = launcher.packageManager
        return try {
            val intent = if (activity.isNotEmpty()) {
                Intent().apply {
                    setClassName(
                        packageName,
                        if (activity.startsWith(".")) packageName + activity else activity
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            } else {
                pm.getLaunchIntentForPackage(packageName)?.apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            }
            if (intent != null) {
                launcher.startActivity(intent)
                return ApiResponse.Success("Launched $packageName")
            }
            // Fallback: resolve the main launcher activity by package.
            val fallback = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_LAUNCHER)
                setPackage(packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            if (fallback.resolveActivity(pm) != null) {
                launcher.startActivity(fallback)
                ApiResponse.Success("Launched $packageName")
            } else {
                ApiResponse.Error("Could not create intent for $packageName")
            }
        } catch (e: Exception) {
            ApiResponse.Error("Launch failed: ${e.message}")
        }
    }

    fun stopApp(packageName: String): ApiResponse {
        return try {
            val am = context.getSystemService(android.app.ActivityManager::class.java)
            am?.killBackgroundProcesses(packageName)
            ApiResponse.Success("Stopped $packageName")
        } catch (e: Exception) {
            ApiResponse.Error("Stop failed: ${e.message}")
        }
    }

    fun getPackages(): ApiResponse {
        val pm = context.packageManager
        val arr = JSONArray()
        try {
            pm.getInstalledApplications(0)
                .mapNotNull { appInfo ->
                    // Only launchable apps: the agent can only start these, and it
                    // keeps the list short + relevant (no system services / providers).
                    if (pm.getLaunchIntentForPackage(appInfo.packageName) == null) return@mapNotNull null
                    val label = pm.getApplicationLabel(appInfo).toString()
                    appInfo.packageName to label
                }
                .sortedBy { it.second.lowercase() }
                .forEach { (pkg, label) ->
                    // appName is the display label (e.g. "我是卧底") so the agent can
                    // map a human app name to its package instead of guessing.
                    arr.put(JSONObject().put("packageName", pkg).put("appName", label))
                }
        } catch (e: Exception) {
            return ApiResponse.Error("Failed to list packages: ${e.message}")
        }
        return ApiResponse.RawArray(arr)
    }

    // ── Device state ──────────────────────────────────────────────────────────

    fun getState(): ApiResponse {
        val state = StateRepository.getPhoneState()
        val screen = StateRepository.getScreenBounds()

        // device_context — read by perception.py format_ui_state()
        val screenBoundsObj = JSONObject()
        screenBoundsObj.put("width", screen?.width() ?: 0)
        screenBoundsObj.put("height", screen?.height() ?: 0)
        val deviceCtx = JSONObject()
        deviceCtx.put("screen_bounds", screenBoundsObj)

        // phone_state — read by format_ui_state()
        val phoneState = JSONObject()
        phoneState.put("currentApp", state?.appName ?: "")
        phoneState.put("packageName", state?.packageName ?: "")
        phoneState.put("activityName", state?.activityName ?: "")
        phoneState.put("keyboardVisible", state?.keyboardVisible ?: false)
        phoneState.put("isEditable", state?.isEditable ?: false)
        phoneState.put("pageStack", JSONArray(state?.pageStack ?: emptyList<String>()))

        // a11y_tree — full tree with boundsInScreen / isVisibleToUser / isFocusable
        val a11yTree = StateRepository.getFullTree()

        val result = JSONObject()
        result.put("device_context", deviceCtx)
        result.put("phone_state", phoneState)
        result.put("a11y_tree", a11yTree)
        return ApiResponse.RawObject(result)
    }

    fun getFullTree(): ApiResponse {
        val tree = StateRepository.getFullTree()
        return ApiResponse.RawObject(tree)
    }

    // ── Screenshot ────────────────────────────────────────────────────────────

    suspend fun screenshot(): ApiResponse {
        val b64 = StateRepository.takeScreenshot()
        return if (b64.isNotEmpty()) ApiResponse.Text(b64)
        else ApiResponse.Error("Screenshot failed — accessibility service must be running and screen must be on")
    }

    // ── Text input ────────────────────────────────────────────────────────────

    suspend fun inputText(text: String, clear: Boolean = false): ApiResponse {
        val ok = StateRepository.inputText(text, clear)
        return if (ok) ApiResponse.Success("Input: $text")
        else ApiResponse.Error("Text input failed — field may not be focused")
    }

    // ── APK install from URL ──────────────────────────────────────────────────

    suspend fun installApk(url: String): ApiResponse = withContext(Dispatchers.IO) {
        try {
            val fileName = "install_${System.currentTimeMillis()}.apk"
            val file = File(context.cacheDir, fileName)
            URL(url).openStream().use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
            val apkUri = FileProvider.getUriForFile(
                context, "${context.packageName}.fileprovider", file
            )
            val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            ApiResponse.Success("Installer launched — tap Install in the system dialog")
        } catch (e: Exception) {
            ApiResponse.Error("Install failed: ${e.message}")
        }
    }

    // ── Key press by Android KeyEvent key code ───────────────────────────────

    suspend fun pressKeyCode(keyCode: Int): ApiResponse {
        // Try IME first (for edit fields with active input connection)
        if (AgentKeyboardIME.sendKeyEventDirect(keyCode)) {
            return ApiResponse.Success("Key code $keyCode via IME")
        }
        // Fallback: global action for navigation keys
        val globalCode = when (keyCode) {
            KeyEvent.KEYCODE_BACK   -> A11yService.GLOBAL_ACTION_BACK
            KeyEvent.KEYCODE_HOME   -> A11yService.GLOBAL_ACTION_HOME
            KeyEvent.KEYCODE_APP_SWITCH -> A11yService.GLOBAL_ACTION_RECENTS
            else -> return ApiResponse.Error("Key code $keyCode: no IME connection and no global action mapping")
        }
        val ok = GestureController.performGlobalAction(globalCode)
        return if (ok) ApiResponse.Success("Key code $keyCode via global action")
        else ApiResponse.Error("Key code $keyCode failed")
    }
}
