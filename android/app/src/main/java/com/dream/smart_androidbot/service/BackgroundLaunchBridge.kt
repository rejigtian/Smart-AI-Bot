package com.dream.smart_androidbot.service

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.WindowManager

/**
 * Helper that lets the (backgrounded) Portal app launch other apps' activities
 * despite Android 10+ background-activity-launch (BAL) restrictions.
 *
 * Two independent BAL exemptions are leveraged:
 *   1. Holding the SYSTEM_ALERT_WINDOW app-op — AOSP's
 *      BackgroundActivityStartController grants the start outright.
 *   2. Owning a *visible* window at the moment of startActivity — required by
 *      some OEM forks (e.g. MIUI) that gate on a visible window rather than the
 *      app-op alone.
 *
 * We satisfy both by momentarily attaching a 1×1, non-interactive overlay
 * window around the launch call, then removing it immediately. The window only
 * has to exist for the synchronous BAL check inside startActivity().
 */
object BackgroundLaunchBridge {
    private const val TAG = "BackgroundLaunch"

    /** True if we hold the overlay permission (always true pre-Android M). */
    fun canDrawOverlays(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

    /**
     * Run [block] (the actual startActivity call) while a transient overlay
     * window is attached, so the launch passes the BAL check even when the app
     * is fully backgrounded. Falls back to running [block] directly when we lack
     * the overlay permission.
     */
    fun <T> withLaunchWindow(context: Context, block: () -> T): T {
        if (!canDrawOverlays(context)) {
            // No overlay permission — best-effort direct call. Works only within
            // the ~10s grace window after the app was last foregrounded.
            return block()
        }
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            ?: return block()
        val view = View(context)
        val type =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val params = WindowManager.LayoutParams(
            1, 1, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        )
        var added = false
        return try {
            wm.addView(view, params)
            added = true
            block()
        } catch (e: Exception) {
            Log.w(TAG, "overlay bridge failed, launching without it", e)
            block()
        } finally {
            if (added) {
                try { wm.removeView(view) } catch (_: Exception) {}
            }
        }
    }
}
