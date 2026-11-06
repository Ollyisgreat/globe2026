plugins {
    id("com.android.application")
}

// Each GitHub Actions build gets a higher version so it installs over the last one.
val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "life.ollpot.globe2026tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "life.ollpot.globe2026tv"
        minSdk = 22          // Fire OS 5 (Fire TV Stick 2nd gen) and newer
        targetSdk = 35
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    signingConfigs {
        // A fixed key kept in the repo so every build can be installed over the
        // previous one on the Firestick. It's only used for sideloading, not a store.
        create("sideload") {
            storeFile = file("sideload.keystore")
            storePassword = "globe2026"
            keyAlias = "globe2026"
            keyPassword = "globe2026"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sideload")
        }
        debug {
            signingConfig = signingConfigs.getByName("sideload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
