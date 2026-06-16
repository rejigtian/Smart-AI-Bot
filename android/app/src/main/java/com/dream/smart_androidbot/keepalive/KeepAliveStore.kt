package com.dream.smart_androidbot.keepalive

import android.content.Context
import android.content.SharedPreferences

/**
 * Self-contained SharedPreferences store for all keep-alive recovery state.
 *
 * Ported from droidrun-portal, where this state lived on ConfigManager. Keeping
 * it in its own store makes the keepalive package drop-in and avoids polluting
 * the app's main ConfigManager + its listener machinery.
 */
class KeepAliveStore private constructor(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("smart_agent_keepalive", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_ENABLED = "keep_screen_awake_enabled"
        private const val KEY_LAST_RECOVERY_AT = "ka_last_recovery_at"
        private const val KEY_LAST_RECOVERY_ATTEMPT_AT = "ka_last_recovery_attempt_at"
        private const val KEY_CONSECUTIVE_FAILURES = "ka_consecutive_failures"
        private const val KEY_DEGRADED_REASON = "ka_degraded_reason"
        private const val KEY_ACTIVE_RECOVERY_TOKEN = "ka_active_recovery_token"
        private const val KEY_RECOVERY_TOKEN_COUNTER = "ka_recovery_token_counter"
        private const val KEY_RECOVERY_OWNER_SESSION = "ka_recovery_owner_session"
        private const val KEY_RECOVERY_ACTIVITY_IN_FLIGHT = "ka_recovery_activity_in_flight"
        private const val KEY_PENDING_RESULT_TOKEN = "ka_pending_result_token"
        private const val KEY_PENDING_RESULT_SUCCESS = "ka_pending_result_success"
        private const val KEY_PENDING_RESULT_REASON = "ka_pending_result_reason"
        private const val KEY_PENDING_RESULT_AT = "ka_pending_result_at"

        @Volatile
        private var instance: KeepAliveStore? = null

        fun getInstance(context: Context): KeepAliveStore {
            return instance ?: synchronized(this) {
                instance ?: KeepAliveStore(context.applicationContext).also { instance = it }
            }
        }
    }

    // ── Toggle ──────────────────────────────────────────────────────────────

    var keepScreenAwakeEnabled: Boolean
        get() = prefs.getBoolean(KEY_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_ENABLED, value).apply()

    // ── Recovery telemetry ──────────────────────────────────────────────────

    var keepAliveLastRecoveryAtMs: Long
        get() = prefs.getLong(KEY_LAST_RECOVERY_AT, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_RECOVERY_AT, value).apply()

    var keepAliveLastRecoveryAttemptAtMs: Long
        get() = prefs.getLong(KEY_LAST_RECOVERY_ATTEMPT_AT, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_RECOVERY_ATTEMPT_AT, value).apply()

    var keepAliveConsecutiveRecoveryFailures: Int
        get() = prefs.getInt(KEY_CONSECUTIVE_FAILURES, 0)
        set(value) = prefs.edit().putInt(KEY_CONSECUTIVE_FAILURES, value).apply()

    var keepAliveDegradedReason: String?
        get() = prefs.getString(KEY_DEGRADED_REASON, null)
        set(value) =
            prefs.edit().apply {
                if (value == null) remove(KEY_DEGRADED_REASON) else putString(KEY_DEGRADED_REASON, value)
            }.apply()

    // ── Recovery handoff state ──────────────────────────────────────────────

    var keepAliveActiveRecoveryToken: Long
        get() = prefs.getLong(KEY_ACTIVE_RECOVERY_TOKEN, 0L)
        set(value) = prefs.edit().putLong(KEY_ACTIVE_RECOVERY_TOKEN, value).apply()

    var keepAliveRecoveryOwnerSessionId: String?
        get() = prefs.getString(KEY_RECOVERY_OWNER_SESSION, null)
        set(value) =
            prefs.edit().apply {
                if (value == null) remove(KEY_RECOVERY_OWNER_SESSION) else putString(KEY_RECOVERY_OWNER_SESSION, value)
            }.apply()

    var keepAliveRecoveryActivityInFlight: Boolean
        get() = prefs.getBoolean(KEY_RECOVERY_ACTIVITY_IN_FLIGHT, false)
        set(value) = prefs.edit().putBoolean(KEY_RECOVERY_ACTIVITY_IN_FLIGHT, value).apply()

    fun nextKeepAliveRecoveryToken(): Long {
        val next = prefs.getLong(KEY_RECOVERY_TOKEN_COUNTER, 0L) + 1L
        prefs.edit().putLong(KEY_RECOVERY_TOKEN_COUNTER, next).apply()
        return next
    }

    // ── Pending recovery result (process-restart handoff) ───────────────────

    val keepAlivePendingRecoveryResultToken: Long
        get() = prefs.getLong(KEY_PENDING_RESULT_TOKEN, 0L)

    val keepAlivePendingRecoveryResultSuccess: Boolean
        get() = prefs.getBoolean(KEY_PENDING_RESULT_SUCCESS, false)

    val keepAlivePendingRecoveryResultReason: String?
        get() = prefs.getString(KEY_PENDING_RESULT_REASON, null)

    val keepAlivePendingRecoveryResultAtMs: Long
        get() = prefs.getLong(KEY_PENDING_RESULT_AT, 0L)

    fun saveKeepAlivePendingRecoveryResult(
        token: Long,
        success: Boolean,
        reason: String?,
        completedAtMs: Long,
    ) {
        prefs.edit().apply {
            putLong(KEY_PENDING_RESULT_TOKEN, token)
            putBoolean(KEY_PENDING_RESULT_SUCCESS, success)
            if (reason == null) remove(KEY_PENDING_RESULT_REASON) else putString(KEY_PENDING_RESULT_REASON, reason)
            putLong(KEY_PENDING_RESULT_AT, completedAtMs)
        }.apply()
    }

    fun clearKeepAlivePendingRecoveryResult() {
        prefs.edit().apply {
            remove(KEY_PENDING_RESULT_TOKEN)
            remove(KEY_PENDING_RESULT_SUCCESS)
            remove(KEY_PENDING_RESULT_REASON)
            remove(KEY_PENDING_RESULT_AT)
        }.apply()
    }

    // ── Bulk clears ─────────────────────────────────────────────────────────

    fun clearKeepAliveRecoveryHandoffState() {
        prefs.edit().apply {
            remove(KEY_ACTIVE_RECOVERY_TOKEN)
            remove(KEY_RECOVERY_OWNER_SESSION)
            remove(KEY_RECOVERY_ACTIVITY_IN_FLIGHT)
            remove(KEY_PENDING_RESULT_TOKEN)
            remove(KEY_PENDING_RESULT_SUCCESS)
            remove(KEY_PENDING_RESULT_REASON)
            remove(KEY_PENDING_RESULT_AT)
        }.apply()
    }

    fun clearKeepAliveRuntimeState() {
        prefs.edit().apply {
            remove(KEY_LAST_RECOVERY_AT)
            remove(KEY_LAST_RECOVERY_ATTEMPT_AT)
            remove(KEY_CONSECUTIVE_FAILURES)
            remove(KEY_DEGRADED_REASON)
            remove(KEY_ACTIVE_RECOVERY_TOKEN)
            remove(KEY_RECOVERY_OWNER_SESSION)
            remove(KEY_RECOVERY_ACTIVITY_IN_FLIGHT)
            remove(KEY_PENDING_RESULT_TOKEN)
            remove(KEY_PENDING_RESULT_SUCCESS)
            remove(KEY_PENDING_RESULT_REASON)
            remove(KEY_PENDING_RESULT_AT)
        }.apply()
    }
}
