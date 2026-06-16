package com.dream.smart_androidbot.keepalive

import java.util.UUID

object KeepAliveProcessSession {
    val currentSessionId: String = UUID.randomUUID().toString()
}
