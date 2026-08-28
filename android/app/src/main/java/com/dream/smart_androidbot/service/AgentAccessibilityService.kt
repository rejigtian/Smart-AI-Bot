package com.dream.smart_androidbot.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import com.dream.smart_androidbot.keepalive.KeepAliveController
import com.dream.smart_androidbot.keepalive.KeepAliveRecoveryActivity
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import com.dream.smart_androidbot.core.AccessibilityTreeBuilder
import com.dream.smart_androidbot.input.AgentKeyboardIME
import com.dream.smart_androidbot.model.ElementNode
import com.dream.smart_androidbot.model.PhoneState
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume
import java.io.ByteArrayOutputStream
import android.util.Base64
import android.util.Log

class AgentAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "AgentA11y"

        // takeScreenshot() can transiently fail — most notably with
        // ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT (3), the OS-enforced ~1s
        // minimum gap between screenshots. Retry a few times before giving up.
        private const val SCREENSHOT_MAX_ATTEMPTS = 3

        @Volatile
        private var instance: AgentAccessibilityService? = null

        fun getInstance(): AgentAccessibilityService? = instance

        // ── Real-recording state ────────────────────────────────────────────
        // When true, the service captures real user interactions (tap/scroll/
        // touch coordinates) and pushes them to the backend over the portal WS.
        @Volatile
        var recording: Boolean = false

        // Set by ReverseConnectionService on connect; sends a raw JSON string
        // (a "record_event" push) to the backend.
        @Volatile
        var wsSender: ((String) -> Unit)? = null

        fun pushRecordEvent(json: String) {
            if (recording) wsSender?.invoke(json)
        }
    }

    // Reason the last screenshot attempt(s) failed (errorCode=N / timeout-12s /
    // null-bitmap / processing-error). Surfaced to the server so a failure is
    // diagnosable instead of a generic "screenshot failed".
    @Volatile
    var lastScreenshotFailure: String = ""
        private set

    private val mainHandler = Handler(Looper.getMainLooper())

    // Best-effort navigation stack (Activity names), maintained from the foreground
    // Activity seen at each state read. The OS back stack isn't readable by an
    // accessibility service, so we approximate: a new Activity is a push; seeing an
    // Activity already in the stack is a pop back to that level.
    private val pageStack = mutableListOf<String>()

    private fun updatePageStack(activity: String?) {
        if (activity.isNullOrEmpty()) return
        synchronized(pageStack) {
            val idx = pageStack.lastIndexOf(activity)
            when {
                pageStack.isEmpty() -> pageStack.add(activity)
                pageStack.last() == activity -> {}                       // same page
                idx >= 0 -> while (pageStack.size > idx + 1) pageStack.removeAt(pageStack.size - 1)  // popped back
                else -> pageStack.add(activity)                          // new page pushed
            }
            while (pageStack.size > 20) pageStack.removeAt(0)            // cap depth
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        val info = serviceInfo ?: AccessibilityServiceInfo()
        // NOTE: no FLAG_REQUEST_TOUCH_EXPLORATION_MODE — it turns taps into
        // "explore then select" (double-tap to click), which swallows rapid
        // consecutive taps. We don't use touch-interaction coordinates anyway.
        info.flags = info.flags or
                AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        info.notificationTimeout = 0
        serviceInfo = info
        // Re-establish keep-alive whenever a11y reconnects (e.g. after a kill).
        KeepAliveController.reconcileBestEffort(this)
    }

    /**
     * Launch the transparent keep-alive recovery Activity. Called by
     * KeepAliveService when the device is locked/screen-off; bringing an Activity
     * to the foreground resets the OEM idle-kill timer and wakes the screen.
     */
    fun launchKeepAliveRecoveryActivity(reason: String, recoveryToken: Long): Boolean {
        return try {
            val intent = Intent(this, KeepAliveRecoveryActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                        Intent.FLAG_ACTIVITY_NO_ANIMATION or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(KeepAliveRecoveryActivity.EXTRA_REASON, reason)
                putExtra(KeepAliveRecoveryActivity.EXTRA_RECOVERY_TOKEN, recoveryToken)
            }
            startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch keep-alive recovery activity", e)
            false
        }
    }

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (!recording || event == null) return
        val evt = when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_CLICKED -> captureTap(event)
            AccessibilityEvent.TYPE_VIEW_SCROLLED -> captureScroll(event)
            AccessibilityEvent.TYPE_TOUCH_INTERACTION_START -> captureTouch()
            else -> null
        }
        if (evt == null || evt.length() == 0) return
        val push = JSONObject()
            .put("type", "record_event")
            .put("event", evt)
            .toString()
        pushRecordEvent(push)
    }

    // ── Real-recording capture ────────────────────────────────────────────────

    private fun captureTap(event: AccessibilityEvent): JSONObject {
        val node = event.source
        if (node != null) {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            val json = JSONObject()
                .put("kind", "tap")
                .put("text", node.text?.toString() ?: "")
                .put("contentDescription", node.contentDescription?.toString() ?: "")
                .put("resourceId", node.viewIdResourceName ?: "")
                .put("className", node.className?.toString() ?: "")
                .put("x", bounds.centerX())
                .put("y", bounds.centerY())
            node.recycle()
            return json
        }
        // Fallback: the source node is already recycled (e.g. a dialog button that
        // dismisses its dialog on click). Record the class name — no coordinates —
        // so replay can degrade to element matching.
        val cls = event.className?.toString() ?: ""
        if (cls.isEmpty()) return JSONObject()
        return JSONObject().put("kind", "tap").put("className", cls)
    }

    private fun captureScroll(event: AccessibilityEvent): JSONObject {
        // Filter out spurious scrolls: auto-scrolling carousels, list loads, and
        // animations fire TYPE_VIEW_SCROLLED with a zero (or tiny) delta. Only
        // record a scroll that actually moved.
        var dx = 0
        var dy = 0
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            dx = event.scrollDeltaX
            dy = event.scrollDeltaY
        }
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return JSONObject()  // no real movement

        val json = JSONObject().put("kind", "scroll")
        // Positive deltaY = content moved down (finger swiped up) → "down".
        val direction = when {
            Math.abs(dx) > Math.abs(dy) && dx > 0 -> "right"
            Math.abs(dx) > Math.abs(dy) && dx < 0 -> "left"
            dy < 0 -> "up"
            else -> "down"
        }
        json.put("direction", direction)
        val node = event.source
        if (node != null) {
            json.put("className", node.className?.toString() ?: "")
            node.recycle()
        }
        return json
    }

    private fun captureTouch(): JSONObject = JSONObject()

    override fun onDestroy() {
        super.onDestroy()
        if (instance === this) instance = null
    }

    // ── Screen bounds ─────────────────────────────────────────────────────────

    fun getScreenBounds(): Rect {
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        return Rect(0, 0, metrics.widthPixels, metrics.heightPixels)
    }

    // ── Phone state ───────────────────────────────────────────────────────────

    fun getPhoneState(): PhoneState {
        val root = rootInActiveWindow
        val focused = findFocusedNode(root)
        val keyboardVisible = isKeyboardVisible()
        val pkgName = root?.packageName?.toString()
        val appName = pkgName?.let { getAppName(it) }
        val isEditable = focused?.isEditable ?: false
        val activityName = getTopActivityName()
        updatePageStack(activityName)
        root?.recycle()
        return PhoneState(
            focusedElement = focused,
            keyboardVisible = keyboardVisible,
            packageName = pkgName,
            appName = appName,
            isEditable = isEditable,
            activityName = activityName,
            pageStack = synchronized(pageStack) { pageStack.toList() },
        )
    }

    private fun findFocusedNode(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        return root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
    }

    private fun isKeyboardVisible(): Boolean {
        for (window in windows) {
            if (window.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) return true
        }
        return false
    }

    private fun getAppName(packageName: String): String? {
        return try {
            val pm = packageManager
            val appInfo: ApplicationInfo = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(appInfo).toString()
        } catch (e: PackageManager.NameNotFoundException) {
            null
        }
    }

    private fun getTopActivityName(): String? {
        for (window in windows) {
            if (window.type == AccessibilityWindowInfo.TYPE_APPLICATION) {
                return window.root?.className?.toString()
            }
        }
        return null
    }

    // ── Visible elements (flat indexed list) ─────────────────────────────────

    fun getVisibleElements(): List<ElementNode> {
        val root = rootInActiveWindow ?: return emptyList()
        val screen = getScreenBounds()
        val elements = mutableListOf<ElementNode>()
        var index = 0
        traverseForElements(root, screen, elements, 0) { index++ }
        root.recycle()
        return elements
    }

    private fun traverseForElements(
        node: AccessibilityNodeInfo,
        screen: Rect,
        elements: MutableList<ElementNode>,
        depth: Int,
        nextIndex: () -> Int
    ) {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)

        // Skip fully off-screen nodes
        if (!Rect.intersects(bounds, screen)) {
            return
        }

        val text = node.text?.toString() ?: ""
        val desc = node.contentDescription?.toString() ?: ""
        val resourceId = node.viewIdResourceName ?: ""
        val className = node.className?.toString() ?: ""
        val isClickable = node.isClickable || node.isCheckable
        val isScrollable = node.isScrollable
        val isEditable = node.isEditable

        val isInteresting = isClickable || isScrollable || isEditable ||
                text.isNotEmpty() || desc.isNotEmpty()

        var element: ElementNode? = null
        if (isInteresting) {
            element = ElementNode(
                overlayIndex = nextIndex(),
                className = className,
                text = text,
                contentDescription = desc,
                resourceId = resourceId,
                isClickable = isClickable,
                isScrollable = isScrollable,
                isCheckable = node.isCheckable,
                isChecked = node.isChecked,
                isEditable = isEditable,
                isSelected = node.isSelected,
                isEnabled = node.isEnabled,
                bounds = bounds,
                depth = depth
            )
            elements.add(element)
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            traverseForElements(child, screen, elements, depth + 1, nextIndex)
            child.recycle()
        }
    }

    // ── Full accessibility tree (for structured state reporting) ──────────────

    fun getFullTreeJson(filter: Boolean = true): JSONObject {
        val root = rootInActiveWindow ?: return JSONObject()
        val screen = getScreenBounds()
        val result = AccessibilityTreeBuilder.buildFullAccessibilityTreeJson(root, screen)
        root.recycle()
        return result
    }

    private data class SettingsActionTarget(
        val bounds: Rect,
        val enabled: Boolean,
    )

    /**
     * Perform a real Android force-stop through the target app's system details page.
     *
     * A regular third-party app cannot call ActivityManager.forceStopPackage().
     * Removing a recent-task card or calling killBackgroundProcesses() is not
     * equivalent, so we deliberately drive Settings and only report success after
     * the force-stop button is disabled or its confirmation dialog is accepted.
     */
    suspend fun forceStopAppViaSettings(packageName: String): Pair<Boolean, String> {
        val detailsIntent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:$packageName"),
        ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }

        return try {
            BackgroundLaunchBridge.withLaunchWindow(this) { startActivity(detailsIntent) }

            var forceStopTarget: SettingsActionTarget? = null
            for (attempt in 0 until 24) {
                delay(250)
                val root = rootInActiveWindow ?: continue
                forceStopTarget = findSettingsAction(root, ::isForceStopControl)
                root.recycle()
                if (forceStopTarget != null) break
            }

            val target = forceStopTarget
                ?: return Pair(false, "force-stop control was not found in system Settings")
            if (!target.enabled) {
                performGlobalAction(GLOBAL_ACTION_HOME)
                return Pair(true, "already stopped")
            }
            if (!tapSettingsTarget(target)) {
                performGlobalAction(GLOBAL_ACTION_HOME)
                return Pair(false, "could not tap the force-stop control")
            }

            var confirmationTapped = false
            var becameDisabled = false
            for (attempt in 0 until 24) {
                delay(250)
                val root = rootInActiveWindow ?: continue
                val confirmTarget = findSettingsAction(root, ::isForceStopConfirmation)
                val currentForceStop = findSettingsAction(root, ::isForceStopControl)
                root.recycle()
                if (currentForceStop != null && !currentForceStop.enabled) {
                    becameDisabled = true
                    break
                }
                if (confirmTarget != null && confirmTarget.enabled) {
                    // A dispatched gesture is not proof that Settings accepted it.
                    // Retry sparingly while the dialog remains, then keep polling
                    // until the actual force-stop control becomes disabled.
                    if (!confirmationTapped || attempt % 4 == 0) {
                        confirmationTapped = tapSettingsTarget(confirmTarget) || confirmationTapped
                    }
                }
            }
            performGlobalAction(GLOBAL_ACTION_HOME)
            if (becameDisabled) {
                Pair(true, "verified stopped in system Settings")
            } else if (!confirmationTapped) {
                Pair(false, "force-stop confirmation was not found or could not be tapped")
            } else {
                Pair(false, "force-stop control did not become disabled after confirmation")
            }
        } catch (error: Exception) {
            performGlobalAction(GLOBAL_ACTION_HOME)
            Pair(false, error.message ?: error.javaClass.simpleName)
        }
    }

    private suspend fun tapSettingsTarget(target: SettingsActionTarget): Boolean {
        if (target.bounds.isEmpty) return false
        return GestureController.tap(
            target.bounds.centerX().coerceAtLeast(1),
            target.bounds.centerY().coerceAtLeast(1),
        )
    }

    private fun findSettingsAction(
        node: AccessibilityNodeInfo,
        matcher: (String, String, String) -> Boolean,
    ): SettingsActionTarget? {
        val text = node.text?.toString().orEmpty().trim()
        val description = node.contentDescription?.toString().orEmpty().trim()
        val resourceId = node.viewIdResourceName.orEmpty()
        if (matcher(text, description, resourceId)) {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            return SettingsActionTarget(bounds, node.isEnabled)
        }
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            val result = findSettingsAction(child, matcher)
            child.recycle()
            if (result != null) return result
        }
        return null
    }

    private fun isForceStopControl(text: String, description: String, resourceId: String): Boolean {
        val labels = setOf(
            "强行停止", "强制停止", "强制结束", "停止运行", "结束运行", "強制停止",
            "force stop", "강제 종료",
        )
        return labels.contains(text.lowercase()) ||
            labels.contains(description.lowercase()) ||
            resourceId.lowercase().contains("force_stop")
    }

    private fun isForceStopConfirmation(text: String, description: String, resourceId: String): Boolean {
        val labels = setOf(
            "确定", "确认", "確定", "ok", "强行停止", "强制停止",
            "强制结束", "停止运行", "结束运行", "強制停止", "force stop", "강제 종료",
        )
        val value = if (text.isNotBlank()) text.lowercase() else description.lowercase()
        return labels.contains(value) || resourceId.lowercase().endsWith(":id/button1")
    }

    // ── Screenshot ────────────────────────────────────────────────────────────

    suspend fun takeScreenshotBase64(hideOverlay: Boolean = false): String {
        repeat(SCREENSHOT_MAX_ATTEMPTS) { attempt ->
            Log.d(TAG, "takeScreenshot: requesting… (attempt ${attempt + 1}/$SCREENSHOT_MAX_ATTEMPTS)")
            // Tracks why THIS attempt failed; read after the coroutine resumes.
            var failure = "unknown"
            val result = withTimeoutOrNull(12_000L) {
                suspendCancellableCoroutine { cont ->
                    takeScreenshot(
                        0,  // default display
                        mainExecutor,
                        object : TakeScreenshotCallback {
                            override fun onSuccess(screenshotResult: ScreenshotResult) {
                                try {
                                    val hardwareBuffer = screenshotResult.getHardwareBuffer()
                                    val colorSpace = screenshotResult.getColorSpace()
                                    val hardwareBitmap = Bitmap.wrapHardwareBuffer(hardwareBuffer, colorSpace)
                                    hardwareBuffer.close()
                                    if (hardwareBitmap == null) {
                                        failure = "null-bitmap"
                                        Log.w(TAG, "takeScreenshot: hardwareBitmap is null")
                                        cont.resume("")
                                        return
                                    }
                                    val softBitmap = hardwareBitmap.copy(Bitmap.Config.ARGB_8888, false)
                                    hardwareBitmap.recycle()
                                    val out = ByteArrayOutputStream()
                                    softBitmap.compress(Bitmap.CompressFormat.JPEG, 75, out)
                                    softBitmap.recycle()
                                    val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                                    Log.d(TAG, "takeScreenshot: success ${out.size()} bytes")
                                    cont.resume(b64)
                                } catch (e: Exception) {
                                    failure = "processing-error: ${e.message}"
                                    Log.e(TAG, "takeScreenshot: processing error ${e.message}")
                                    cont.resume("")
                                }
                            }

                            override fun onFailure(errorCode: Int) {
                                failure = "errorCode=$errorCode"
                                Log.w(TAG, "takeScreenshot: onFailure errorCode=$errorCode")
                                cont.resume("")
                            }
                        }
                    )
                }
            }
            if (!result.isNullOrEmpty()) {
                lastScreenshotFailure = ""
                return result
            }
            if (result == null) {
                failure = "timeout-12s"
                Log.w(TAG, "takeScreenshot: timed out (no callback in 12s)")
            }
            lastScreenshotFailure = failure
            if (attempt < SCREENSHOT_MAX_ATTEMPTS - 1) {
                // errorCode=3 is ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT — the
                // OS needs ~1s between screenshots, so wait it out; otherwise a
                // short backoff is enough for transient internal errors.
                delay(if (failure == "errorCode=3") 1100L else 350L)
            }
        }
        Log.w(TAG, "takeScreenshot: giving up after $SCREENSHOT_MAX_ATTEMPTS attempts ($lastScreenshotFailure)")
        return ""
    }

    // ── Text input ────────────────────────────────────────────────────────────

    suspend fun inputText(text: String, clear: Boolean = false): Boolean {
        // Try IME approach first (works with focused editable fields)
        if (AgentKeyboardIME.inputText(text, clear)) return true

        // Fallback: set text via accessibility action on focused node
        val root = rootInActiveWindow ?: return false
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        root.recycle()
        if (focused != null) {
            val args = android.os.Bundle()
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            val result = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            focused.recycle()
            return result
        }
        return false
    }

    // ── Package list ──────────────────────────────────────────────────────────

    fun getInstalledPackages(): List<String> {
        return try {
            packageManager.getInstalledPackages(0).map { it.packageName }
        } catch (e: Exception) {
            emptyList()
        }
    }

    // ── Node lookup by index ──────────────────────────────────────────────────

    fun findNodeByIndex(index: Int): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val screen = getScreenBounds()
        var counter = 0
        val result = findNodeByIndexRecursive(root, screen, index) { counter++ }
        root.recycle()
        return result
    }

    private fun findNodeByIndexRecursive(
        node: AccessibilityNodeInfo,
        screen: Rect,
        targetIndex: Int,
        nextIndex: () -> Int
    ): AccessibilityNodeInfo? {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (!Rect.intersects(bounds, screen)) return null

        val text = node.text?.toString() ?: ""
        val desc = node.contentDescription?.toString() ?: ""
        val isInteresting = node.isClickable || node.isCheckable || node.isScrollable ||
                node.isEditable || text.isNotEmpty() || desc.isNotEmpty()

        if (isInteresting) {
            val idx = nextIndex()
            if (idx == targetIndex) return node
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findNodeByIndexRecursive(child, screen, targetIndex, nextIndex)
            if (found != null) {
                if (found !== child) child.recycle()
                return found
            }
            child.recycle()
        }
        return null
    }
}
