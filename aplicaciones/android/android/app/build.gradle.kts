import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Push (FCM): se aplica abajo solo si existe google-services.json; sin él la app compila y funciona sin push.
    id("com.google.gms.google-services") apply false
}

val archivoFirma = rootProject.file("key.properties")
val propiedadesFirma = Properties().apply {
    if (archivoFirma.exists()) archivoFirma.inputStream().use { load(it) }
}

android {
    namespace = "bo.clb.clb_store"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = providers.gradleProperty("clbNdkVersion").getOrElse(flutter.ndkVersion)

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // El esquema de redirección OIDC registrado en Keycloak para el cliente clb-android es bo.clb.store.
        applicationId = "bo.clb.store"
        // Android 8: sqflite, Keystore para los tokens y LiteRT (TensorFlow Lite).
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["appAuthRedirectScheme"] = "bo.clb.store"
    }

    signingConfigs {
        if (archivoFirma.exists()) {
            create("publicacion") {
                keyAlias = propiedadesFirma.getProperty("keyAlias")
                keyPassword = propiedadesFirma.getProperty("keyPassword")
                storeFile = file(propiedadesFirma.getProperty("storeFile"))
                storePassword = propiedadesFirma.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (archivoFirma.exists()) signingConfigs.getByName("publicacion") else signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

// google-services.json es configuración local (no se versiona). `--android-project-arg=clbSinFirebase=true` permite
// compilar y probar el camino sin Firebase aunque el archivo exista.
if (file("google-services.json").exists() && !project.hasProperty("clbSinFirebase")) {
    apply(plugin = "com.google.gms.google-services")
}
