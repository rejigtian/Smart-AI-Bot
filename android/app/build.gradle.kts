plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.dream.smart_androidbot"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dream.smart_androidbot"
        minSdk = 30
        targetSdk = 35
        versionCode = 7
        versionName = "1.1.3"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        // Shared debug keystore (checked into the repo). A debug keystore is not
        // a secret — pinning it gives every machine the SAME signature, so the
        // distributed APK installs/updates across environments without the
        // "signatures do not match" error from per-machine ~/.android keys.
        getByName("debug") {
            storeFile = rootProject.file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
        }
    }
    buildFeatures {
        viewBinding = true
    }
}

// ── Archive the built debug APK as SmartAgent-<version>.apk ──────────────────
// Copies into backend/data/apk/ (served by the backend for QR download) and
// overwrites any previously archived APK so only the latest remains.
tasks.register<Copy>("archiveApk") {
    val apkDir = rootProject.file("../backend/data/apk")
    doFirst {
        apkDir.mkdirs()
        apkDir.listFiles { f -> f.extension == "apk" }?.forEach { it.delete() }
    }
    from(layout.buildDirectory.dir("outputs/apk/debug"))
    include("*.apk")
    into(apkDir)
    rename { "SmartAgent-${android.defaultConfig.versionName}.apk" }
}

afterEvaluate {
    tasks.named("assembleDebug") { finalizedBy("archiveApk") }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.coroutines.android)
    implementation(libs.java.websocket)
    implementation(libs.okhttp)
    implementation(libs.gson)
    implementation(libs.zxing.android.embedded)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
