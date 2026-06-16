package com.dream.smart_androidbot.keepalive

class KeepAliveStartupException(
    val reason: String,
    cause: Throwable? = null,
) : RuntimeException(reason, cause)
