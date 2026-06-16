package com.dream.smart_androidbot.keepalive

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.dream.smart_androidbot.config.ConfigManager
import com.dream.smart_androidbot.service.ReverseConnectionService

/**
 * Starts agent services automatically after device reboot,
 * if keep-alive was previously enabled by the user.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val config = ConfigManager.getInstance(context)

        Log.i("BootReceiver", "Boot complete — reconciling agent services")

        // Re-establish keep-alive (no-op if the user never enabled it)
        KeepAliveController.reconcileBestEffort(context)

        // Start WS connection if token is configured
        if (config.token.isNotBlank()) {
            context.startForegroundService(
                Intent(context, ReverseConnectionService::class.java).apply {
                    action = ReverseConnectionService.ACTION_START
                }
            )
        }
    }
}
