package com.dream.smart_androidbot.model

import android.view.accessibility.AccessibilityNodeInfo

data class PhoneState(
    val focusedElement: AccessibilityNodeInfo?,
    val keyboardVisible: Boolean,
    val packageName: String?,
    val appName: String?,
    val isEditable: Boolean,
    val activityName: String?,
    // Navigation stack of Activity names, oldest first; current page is last.
    // Lets the agent know how many "back"s return to a base page.
    val pageStack: List<String> = emptyList()
)
