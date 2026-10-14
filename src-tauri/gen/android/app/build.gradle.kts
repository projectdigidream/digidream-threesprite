import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.digidream.threesprite"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.digidream.threesprite"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    /*
     * Signing. `keystore.properties` beside this file (git-ignored) holds a real
     * release key when there is one; see "Signing (Android release)" in the
     * README. Without it a local release build falls back to the standard
     * Android debug key, so the APK still installs on a device and upgrades a
     * debug build in place. That key is for your own devices, never for a store.
     */
    val keystoreProperties = Properties().apply {
        val propFile = rootProject.file("keystore.properties")
        if (propFile.exists()) propFile.inputStream().use { load(it) }
    }
    signingConfigs {
        create("release") {
            if (keystoreProperties.isEmpty) {
                storeFile = File(System.getProperty("user.home"), ".android/debug.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            } else {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

/**
 * Every release APK is also dropped at the root of the repository as
 * `ThreeSprite.apk`, whichever way the build was started, so the newest one is
 * always the same obvious file and never a path six directories deep.
 */
val repoRoot: File = rootProject.projectDir.parentFile.parentFile.parentFile

tasks.whenTaskAdded {
    if (name.startsWith("assemble") && name.endsWith("Release")) {
        doLast {
            val outputs = File(layout.buildDirectory.get().asFile, "outputs/apk")
            val apk = outputs.walkTopDown().filter { it.isFile && it.extension == "apk" }.maxByOrNull { it.lastModified() }
            if (apk == null) {
                logger.lifecycle("no APK to copy to ${repoRoot.path}")
            } else {
                val dest = File(repoRoot, "ThreeSprite.apk")
                apk.copyTo(dest, overwrite = true)
                logger.lifecycle("copied ${apk.name} (${apk.length() / 1024 / 1024} MB) to ${dest.path}")
            }
        }
    }
}

apply(from = "tauri.build.gradle.kts")