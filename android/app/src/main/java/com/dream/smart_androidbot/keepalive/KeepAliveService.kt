package com.dream.smart_androidbot.keepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.dream.smart_androidbot.R
import com.dream.smart_androidbot.service.AgentAccessibilityService

/**
 * Ported from droidrun-portal. Keeps the agent process alive across overnight
 * OEM/Doze kills by, every 30s while enabled, proactively waking the display
 * and launching a transparent recovery Activity when the device is locked /
 * screen-off — which re-foregrounds the app and resets the OEM idle-kill timer.
 *
 * Recovery state is persisted in [KeepAliveStore] so a process restart mid-
 * recovery can be reconciled (token-based handoff).
 */
class KeepAliveService : Service() {

    companion object {
        private const val TAG = "KeepAliveService"
        private const val CHANNEL_ID = "keep_alive_channel"
        private const val NOTIFICATION_ID = 2004
        private const val POLL_INTERVAL_MS = 30_000L
        private const val WAKE_SETTLE_DELAY_MS = 750L

        const val ACTION_RECONCILE = "com.dream.smart_androidbot.action.KEEP_ALIVE_RECONCILE"
        const val ACTION_STOP = "com.dream.smart_androidbot.action.KEEP_ALIVE_STOP"

        @Volatile
        private var instance: KeepAliveService? = null

        fun isRunning(): Boolean = instance != null

        fun notifyRecoveryResult(
            context: Context,
            recoveryToken: Long,
            success: Boolean,
            reason: String? = null,
        ) {
            val service = instance
            val appContext = context.applicationContext
            val store = KeepAliveStore.getInstance(appContext)
            val deliveryDecision =
                KeepAliveRecoveryHandoffPolicy.deliveryDecision(
                    hasLiveService = service != null,
                    keepAliveEnabled = store.keepScreenAwakeEnabled,
                )
            if (deliveryDecision.shouldHandleWithLiveService && service != null) {
                service.handleRecoveryResult(recoveryToken, success, reason)
                return
            }
            if (!deliveryDecision.shouldPersistPendingResult) {
                return
            }
            store.saveKeepAlivePendingRecoveryResult(
                token = recoveryToken,
                success = success,
                reason = reason,
                completedAtMs = System.currentTimeMillis(),
            )
            if (deliveryDecision.shouldStartServiceBestEffort) {
                KeepAliveController.retryStartupIfEnabledAndInactive(appContext)
            }
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val pollRunnable =
        object : Runnable {
            override fun run() {
                evaluateDeviceState("poll")
                mainHandler.postDelayed(this, POLL_INTERVAL_MS)
            }
        }
    private val screenStateReceiver =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val action = intent?.action ?: return
                evaluateDeviceState(action)
            }
        }

    private var steadyWakeLock: PowerManager.WakeLock? = null
    private var recoveryWakeLock: PowerManager.WakeLock? = null
    private var receiverRegistered = false
    private var recoveryInFlight = false
    private var activeRecoveryToken: Long? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        val store = KeepAliveStore.getInstance(this)
        restorePersistedRecoveryHandoffState(store)
        createNotificationChannel()
        registerScreenStateReceiver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val store = KeepAliveStore.getInstance(applicationContext)
        if (intent?.action == ACTION_STOP) {
            KeepAliveController.disable(applicationContext)
            return START_NOT_STICKY
        }
        if (!store.keepScreenAwakeEnabled) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, createNotification())
        ensureSteadyWakeLock()
        schedulePoll()
        evaluateDeviceState(intent?.action ?: ACTION_RECONCILE)
        return START_STICKY
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        if (receiverRegistered) {
            try {
                unregisterReceiver(screenStateReceiver)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to unregister screen-state receiver", e)
            }
            receiverRegistered = false
        }
        releaseWakeLocks()
        recoveryInFlight = false
        activeRecoveryToken = null
        instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun schedulePoll() {
        mainHandler.removeCallbacks(pollRunnable)
        mainHandler.postDelayed(pollRunnable, POLL_INTERVAL_MS)
    }

    private fun evaluateDeviceState(trigger: String) {
        val appContext = applicationContext
        val status = KeepAliveController.getStatus(appContext)
        if (!status.enabled) {
            stopSelf()
            return
        }

        ensureSteadyWakeLock()
        val nowMs = System.currentTimeMillis()
        if (handlePersistedRecoveryHandoff(status, nowMs)) {
            return
        }

        val decision =
            KeepAliveRecoveryPolicy.evaluate(
                enabled = status.enabled,
                interactive = status.interactive,
                deviceLocked = status.deviceLocked,
                lastRecoveryAttemptAtMs =
                    KeepAliveStore.getInstance(appContext).keepAliveLastRecoveryAttemptAtMs,
                nowMs = nowMs,
            )

        if (!decision.shouldAttemptRecovery) {
            if (status.interactive && !status.deviceLocked) {
                KeepAliveController.setDegradedReason(appContext, null)
            } else if (decision.degradedReason != null) {
                KeepAliveController.setDegradedReason(appContext, decision.degradedReason)
            }
            return
        }

        val recoveryAtMs = System.currentTimeMillis()
        val recoveryToken = beginRecoveryAttempt(recoveryAtMs)

        if (decision.shouldWakeDisplay) {
            wakeDisplay()
        }

        if (decision.shouldLaunchRecoveryActivity) {
            launchRecoveryActivity("locked:$trigger", recoveryToken)
            return
        }

        if (decision.shouldWakeDisplay) {
            mainHandler.postDelayed(
                {
                    if (!isCurrentRecoveryToken(recoveryToken)) {
                        return@postDelayed
                    }
                    val refreshedStatus = KeepAliveController.getStatus(appContext)
                    if (!refreshedStatus.enabled) {
                        clearRecoveryAttempt(recoveryToken)
                        return@postDelayed
                    }
                    if (!refreshedStatus.interactive || refreshedStatus.deviceLocked) {
                        launchRecoveryActivity("wake_check:$trigger", recoveryToken)
                    } else {
                        finalizeRecoveryAttempt(recoveryToken, callbackSuccess = true, reason = null)
                    }
                },
                WAKE_SETTLE_DELAY_MS,
            )
        }
    }

    private fun wakeDisplay() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (powerManager == null) {
                KeepAliveController.markRecoveryFailure(
                    applicationContext,
                    "power_manager_unavailable",
                )
                return
            }
            if (recoveryWakeLock == null) {
                @Suppress("DEPRECATION")
                recoveryWakeLock =
                    powerManager.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                        "$packageName:keep_alive_recovery",
                    ).apply { setReferenceCounted(false) }
            }
            recoveryWakeLock?.acquire(5_000L)
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to acquire recovery wake lock", t)
            KeepAliveController.markRecoveryFailure(
                applicationContext,
                "wake_lock_acquire_failed",
            )
        }
    }

    private fun launchRecoveryActivity(
        reason: String,
        recoveryToken: Long,
    ) {
        if (recoveryInFlight || !isCurrentRecoveryToken(recoveryToken)) return

        val service = AgentAccessibilityService.getInstance()
        if (service == null) {
            finalizeRecoveryAttempt(
                recoveryToken,
                callbackSuccess = false,
                reason = "accessibility_service_unavailable",
            )
            return
        }

        val launched = service.launchKeepAliveRecoveryActivity(reason, recoveryToken)
        if (!launched) {
            finalizeRecoveryAttempt(
                recoveryToken,
                callbackSuccess = false,
                reason = "recovery_activity_launch_failed",
            )
            return
        }

        recoveryInFlight = true
        KeepAliveStore.getInstance(applicationContext).keepAliveRecoveryActivityInFlight = true
    }

    private fun handleRecoveryResult(
        recoveryToken: Long,
        success: Boolean,
        reason: String?,
    ) {
        mainHandler.post {
            finalizeRecoveryAttempt(recoveryToken, success, reason)
        }
    }

    private fun beginRecoveryAttempt(atMs: Long): Long {
        KeepAliveController.noteRecoveryAttempt(applicationContext, atMs)
        val store = KeepAliveStore.getInstance(applicationContext)
        activeRecoveryToken = store.nextKeepAliveRecoveryToken()
        recoveryInFlight = false
        store.keepAliveActiveRecoveryToken = activeRecoveryToken!!
        store.keepAliveRecoveryOwnerSessionId = KeepAliveProcessSession.currentSessionId
        store.keepAliveRecoveryActivityInFlight = false
        store.clearKeepAlivePendingRecoveryResult()
        return activeRecoveryToken!!
    }

    private fun isCurrentRecoveryToken(recoveryToken: Long): Boolean =
        activeRecoveryToken != null && activeRecoveryToken == recoveryToken

    private fun clearRecoveryAttempt(recoveryToken: Long) {
        if (activeRecoveryToken == recoveryToken) {
            activeRecoveryToken = null
            recoveryInFlight = false
            clearPersistedRecoveryHandoffState()
        }
    }

    private fun finalizeRecoveryAttempt(
        recoveryToken: Long,
        callbackSuccess: Boolean,
        reason: String?,
    ) {
        val status = KeepAliveController.getStatus(applicationContext)
        val decision =
            KeepAliveRecoveryResultPolicy.evaluate(
                enabled = status.enabled,
                activeRecoveryToken = activeRecoveryToken,
                reportedRecoveryToken = recoveryToken,
                callbackSuccess = callbackSuccess,
                interactive = status.interactive,
                deviceLocked = status.deviceLocked,
                failureReason = reason,
            )

        if (decision.shouldIgnore) {
            clearRecoveryAttempt(recoveryToken)
            return
        }

        if (decision.shouldMarkSuccess) {
            KeepAliveController.markRecoverySuccess(applicationContext)
        } else {
            KeepAliveController.markRecoveryFailure(
                applicationContext,
                decision.failureReason ?: "dismiss_failed",
            )
        }
        clearRecoveryAttempt(recoveryToken)
    }

    private fun finalizePersistedRecoveryAttempt(
        recoveryToken: Long,
        callbackSuccess: Boolean,
        reason: String?,
        completedAtMs: Long,
    ) {
        val status = KeepAliveController.getStatus(applicationContext)
        val decision =
            KeepAliveRecoveryResultPolicy.evaluatePersisted(
                enabled = status.enabled,
                activeRecoveryToken = activeRecoveryToken,
                reportedRecoveryToken = recoveryToken,
                callbackSuccess = callbackSuccess,
                failureReason = reason,
            )

        if (decision.shouldIgnore) {
            clearRecoveryAttempt(recoveryToken)
            return
        }

        if (decision.shouldMarkSuccess) {
            KeepAliveController.markRecoverySuccess(applicationContext, atMs = completedAtMs)
        } else {
            KeepAliveController.markRecoveryFailure(
                applicationContext,
                decision.failureReason ?: "dismiss_failed",
                atMs = completedAtMs,
            )
        }
        clearRecoveryAttempt(recoveryToken)
    }

    private fun handlePersistedRecoveryHandoff(
        status: KeepAliveStatus,
        nowMs: Long,
    ): Boolean {
        val store = KeepAliveStore.getInstance(applicationContext)
        val decision =
            KeepAliveRecoveryHandoffPolicy.handoffDecision(
                activeRecoveryToken = store.keepAliveActiveRecoveryToken,
                ownerSessionId = store.keepAliveRecoveryOwnerSessionId,
                currentSessionId = KeepAliveProcessSession.currentSessionId,
                recoveryActivityInFlight = store.keepAliveRecoveryActivityInFlight,
                pendingRecoveryResultToken = store.keepAlivePendingRecoveryResultToken,
                lastRecoveryAttemptAtMs = store.keepAliveLastRecoveryAttemptAtMs,
                nowMs = nowMs,
            )

        if (decision.shouldClearHandoffState) {
            clearPersistedRecoveryHandoffState(resetLastRecoveryAttemptTimestamp = true)
            restorePersistedRecoveryHandoffState(store)
            return false
        }

        if (decision.shouldConsumePendingResult) {
            restorePersistedRecoveryHandoffState(store)
            finalizePersistedRecoveryAttempt(
                recoveryToken = store.keepAlivePendingRecoveryResultToken,
                callbackSuccess = store.keepAlivePendingRecoveryResultSuccess,
                reason = store.keepAlivePendingRecoveryResultReason,
                completedAtMs = store.keepAlivePendingRecoveryResultAtMs,
            )
            return true
        }

        if (decision.shouldSuppressRecoveryEvaluation) {
            if (status.interactive && !status.deviceLocked) {
                KeepAliveController.setDegradedReason(applicationContext, null)
            }
            return true
        }

        return false
    }

    private fun restorePersistedRecoveryHandoffState(store: KeepAliveStore) {
        activeRecoveryToken = store.keepAliveActiveRecoveryToken.takeIf { it > 0L }
        recoveryInFlight =
            store.keepAliveRecoveryActivityInFlight && activeRecoveryToken != null
    }

    private fun clearPersistedRecoveryHandoffState(resetLastRecoveryAttemptTimestamp: Boolean = false) {
        val store = KeepAliveStore.getInstance(applicationContext)
        store.clearKeepAliveRecoveryHandoffState()
        if (resetLastRecoveryAttemptTimestamp) {
            store.keepAliveLastRecoveryAttemptAtMs = 0L
        }
    }

    private fun ensureSteadyWakeLock() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (powerManager == null) {
                KeepAliveController.setDegradedReason(
                    applicationContext,
                    "power_manager_unavailable",
                )
                return
            }
            if (steadyWakeLock == null) {
                @Suppress("DEPRECATION")
                steadyWakeLock =
                    powerManager.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK,
                        "$packageName:keep_alive_steady",
                    ).apply { setReferenceCounted(false) }
            }
            if (steadyWakeLock?.isHeld != true) {
                steadyWakeLock?.acquire()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to acquire steady wake lock", t)
            KeepAliveController.setDegradedReason(
                applicationContext,
                "steady_wake_lock_failed",
            )
        }
    }

    private fun releaseWakeLocks() {
        try {
            if (recoveryWakeLock?.isHeld == true) {
                recoveryWakeLock?.release()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to release recovery wake lock", t)
        }

        try {
            if (steadyWakeLock?.isHeld == true) {
                steadyWakeLock?.release()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to release steady wake lock", t)
        }
    }

    private fun registerScreenStateReceiver() {
        val filter =
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
            }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(
                    screenStateReceiver,
                    filter,
                    Context.RECEIVER_NOT_EXPORTED,
                )
            } else {
                @Suppress("DEPRECATION")
                registerReceiver(screenStateReceiver, filter)
            }
            receiverRegistered = true
        } catch (e: Exception) {
            Log.w(TAG, "Failed to register screen-state receiver", e)
            receiverRegistered = false
        }
    }

    private fun createNotificationChannel() {
        val channel =
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.keep_screen_awake_notification_title),
                NotificationManager.IMPORTANCE_LOW,
            )
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(channel)
    }

    private fun createNotification(): Notification {
        val stopIntent =
            Intent(this, KeepAliveService::class.java).apply {
                action = ACTION_STOP
            }
        val stopPendingIntent =
            PendingIntent.getService(
                this,
                0,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.keep_screen_awake_notification_title))
            .setContentText(getString(R.string.keep_screen_awake_notification_text))
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                getString(R.string.keep_screen_awake_notification_stop),
                stopPendingIntent,
            )
            .build()
    }
}
