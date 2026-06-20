package com.dream.smart_androidbot.ui

import com.journeyapps.barcodescanner.CaptureActivity

/**
 * QR capture screen locked to portrait. The default zxing [CaptureActivity]
 * follows the sensor and tends to open in landscape; pairing this subclass with
 * android:screenOrientation="portrait" in the manifest keeps it upright.
 */
class PortraitCaptureActivity : CaptureActivity()
