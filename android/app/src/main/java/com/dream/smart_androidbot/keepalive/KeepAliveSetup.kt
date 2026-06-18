package com.dream.smart_androidbot.keepalive

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log

/**
 * One-tap background-survival setup. The biggest reason the agent loses the
 * device mid-run is that aggressive OEMs (MIUI / EMUI / ColorOS / OriginOS)
 * freeze the backgrounded Portal app's network when the target app takes the
 * foreground. The fix is device-side: exempt the app from battery optimization
 * and add it to the OEM auto-start whitelist. This helper detects the state and
 * deep-links straight into the right settings pages.
 */
object KeepAliveSetup {
    private const val TAG = "KeepAliveSetup"

    /** True if the app is already exempt from Doze / battery optimization. */
    fun isBatteryUnrestricted(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * True if we can draw overlays. This is the portable signal for the
     * background-activity-launch (BAL) exemption that lets the backgrounded
     * Portal app launch other apps via start_app. Without it, launches are
     * silently dropped once the app leaves the foreground.
     */
    fun canDrawOverlays(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

    /** Open the system "display over other apps" screen for this package. */
    fun requestOverlayPermission(context: Context): Boolean {
        return try {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
                    data = Uri.parse("package:${context.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
            true
        } catch (e: Exception) {
            Log.w(TAG, "overlay-permission request failed, falling back to app details", e)
            openAppDetails(context)
        }
    }

    /** Fire the system dialog that asks the user to exempt us from battery optimization. */
    fun requestBatteryExemption(context: Context): Boolean {
        return try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.w(TAG, "battery-exemption request failed, falling back to settings list", e)
            // Fall back to the global battery-optimization list.
            try {
                context.startActivity(
                    Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
                true
            } catch (e2: Exception) {
                false
            }
        }
    }

    /**
     * Deep-link into the manufacturer's auto-start / background-management page.
     * Tries known OEM activities in order; falls back to the app-details page so
     * the user can always get somewhere useful.
     */
    fun openAutostartSettings(context: Context): Boolean {
        val candidates = oemAutostartIntents(context.packageName)
        for (intent in candidates) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (intent.resolveActivity(context.packageManager) != null) {
                return try {
                    context.startActivity(intent)
                    true
                } catch (e: Exception) {
                    Log.w(TAG, "autostart intent failed: $intent", e)
                    false
                }
            }
        }
        return openAppDetails(context)
    }

    /** Generic app-details settings page — always available. */
    fun openAppDetails(context: Context): Boolean {
        return try {
            context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${context.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun comp(pkg: String, cls: String): Intent =
        Intent().setComponent(ComponentName(pkg, cls))

    /** Known OEM auto-start management activities, most-specific first. */
    private fun oemAutostartIntents(pkg: String): List<Intent> {
        val brand = (Build.MANUFACTURER + " " + Build.BRAND).lowercase()
        return when {
            brand.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco") -> listOf(
                // The dedicated 自启动管理 list — what users expect from "autostart".
                comp("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
                // Fallback: per-app permission editor (also has 「后台弹出界面」).
                comp("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity")
                    .putExtra("extra_pkgname", pkg),
                comp("com.miui.securitycenter", "com.miui.powercenter.PowerSettings"),
            )
            brand.contains("huawei") || brand.contains("honor") -> listOf(
                comp("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                comp("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
                comp("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
            )
            brand.contains("oppo") || brand.contains("realme") -> listOf(
                comp("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
                comp("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                comp("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
            )
            brand.contains("vivo") || brand.contains("iqoo") -> listOf(
                comp("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                comp("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
            )
            brand.contains("oneplus") -> listOf(
                comp("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
            )
            brand.contains("samsung") -> listOf(
                comp("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"),
            )
            else -> emptyList()
        }
    }
}
