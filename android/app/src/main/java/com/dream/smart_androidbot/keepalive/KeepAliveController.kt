package com.dream.smart_androidbot.keepalive

import android.app.KeyguardManager
import android.content.Context
import android.os.PowerManager
import org.json.JSONObject

/**
 * Ported from droidrun-portal. Public entry point for enabling/disabling the
 * keep-alive subsystem and querying its status. Backed by [KeepAliveStore]
 * instead of the app's ConfigManager.
 */
object KeepAliveController {
    data class BestEffortReconcileResult(
        val deferredReason: String? = null,
    )

    fun setEnabled(context: Context, enabled: Boolean) {
        if (enabled) {
            enable(context)
        } else {
            disable(context)
        }
    }

    fun enable(context: Context) {
        val appContext = context.applicationContext
        val store = KeepAliveStore.getInstance(appContext)
        if (store.keepScreenAwakeEnabled && KeepAliveService.isRunning()) {
            return
        }
        store.keepScreenAwakeEnabled = true
        try {
            KeepAliveServiceRuntime.start(appContext)
        } catch (e: KeepAliveStartupException) {
            store.keepScreenAwakeEnabled = false
            store.clearKeepAliveRuntimeState()
            KeepAliveServiceRuntime.stop(appContext)
            throw e
        }
    }

    fun disable(context: Context) {
        val appContext = context.applicationContext
        val store = KeepAliveStore.getInstance(appContext)
        store.keepScreenAwakeEnabled = false
        store.clearKeepAliveRuntimeState()
        KeepAliveServiceRuntime.stop(appContext)
    }

    fun reconcile(context: Context) {
        val appContext = context.applicationContext
        val store = KeepAliveStore.getInstance(appContext)
        if (store.keepScreenAwakeEnabled) {
            KeepAliveServiceRuntime.start(appContext)
        } else {
            KeepAliveServiceRuntime.stop(appContext)
        }
    }

    fun reconcileBestEffort(context: Context): BestEffortReconcileResult {
        return try {
            reconcile(context)
            BestEffortReconcileResult()
        } catch (e: KeepAliveStartupException) {
            BestEffortReconcileResult(deferredReason = e.reason)
        }
    }

    fun retryStartupIfEnabledAndInactive(context: Context): String? {
        val appContext = context.applicationContext
        val store = KeepAliveStore.getInstance(appContext)
        if (!store.keepScreenAwakeEnabled || KeepAliveService.isRunning()) {
            return null
        }
        return try {
            KeepAliveServiceRuntime.start(appContext)
            null
        } catch (e: KeepAliveStartupException) {
            e.reason
        }
    }

    fun getStatus(context: Context): KeepAliveStatus {
        val appContext = context.applicationContext
        val store = KeepAliveStore.getInstance(appContext)
        return KeepAliveStatus(
            enabled = store.keepScreenAwakeEnabled,
            serviceActive = KeepAliveService.isRunning(),
            interactive = isInteractive(appContext),
            deviceLocked = isDeviceLocked(appContext),
            lastRecoveryAtMs = store.keepAliveLastRecoveryAtMs,
            consecutiveRecoveryFailures = store.keepAliveConsecutiveRecoveryFailures,
            degradedReason = store.keepAliveDegradedReason,
        )
    }

    fun getMutationResultStatus(
        context: Context,
        requestedEnabled: Boolean,
    ): KeepAliveStatus =
        getStatus(context).withTargetState(
            enabled = requestedEnabled,
            serviceActive = requestedEnabled,
        )

    fun getStatusJson(context: Context): JSONObject = getStatus(context).toJson()

    fun getMutationResultStatusJson(
        context: Context,
        requestedEnabled: Boolean,
    ): JSONObject = getMutationResultStatus(context, requestedEnabled).toJson()

    fun noteRecoveryAttempt(
        context: Context,
        atMs: Long = System.currentTimeMillis(),
    ) {
        KeepAliveStore.getInstance(context.applicationContext).keepAliveLastRecoveryAttemptAtMs = atMs
    }

    fun markRecoverySuccess(
        context: Context,
        atMs: Long = System.currentTimeMillis(),
    ) {
        val store = KeepAliveStore.getInstance(context.applicationContext)
        store.keepAliveLastRecoveryAtMs = atMs
        store.keepAliveLastRecoveryAttemptAtMs = 0L
        store.keepAliveConsecutiveRecoveryFailures = 0
        store.keepAliveDegradedReason = null
    }

    fun markRecoveryFailure(
        context: Context,
        reason: String,
        atMs: Long = System.currentTimeMillis(),
    ) {
        val store = KeepAliveStore.getInstance(context.applicationContext)
        store.keepAliveLastRecoveryAtMs = atMs
        store.keepAliveLastRecoveryAttemptAtMs = atMs
        store.keepAliveConsecutiveRecoveryFailures =
            store.keepAliveConsecutiveRecoveryFailures + 1
        store.keepAliveDegradedReason = reason
    }

    fun setDegradedReason(
        context: Context,
        reason: String?,
    ) {
        KeepAliveStore.getInstance(context.applicationContext).keepAliveDegradedReason = reason
    }

    private fun isInteractive(context: Context): Boolean {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        return powerManager?.isInteractive ?: false
    }

    private fun isDeviceLocked(context: Context): Boolean {
        val keyguardManager =
            context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        return keyguardManager?.isDeviceLocked ?: false
    }
}
