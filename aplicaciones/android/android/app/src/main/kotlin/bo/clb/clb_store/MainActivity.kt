package bo.clb.clb_store

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.StatFs
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    companion object {
        const val CANAL_AVISOS_ID = "clb_pedidos"
        const val CANAL_AVISOS_NOMBRE = "Avisos de pedidos"
        const val CANAL_METODO = "bo.clb.store/notificaciones_nativas"
    }

    private var canalNotificaciones: MethodChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bo.clb.store/almacenamiento")
            .setMethodCallHandler { call, result ->
                if (call.method == "disponible") result.success(StatFs(filesDir.absolutePath).availableBytes)
                else result.notImplemented()
            }

        crearCanalNotificaciones()

        val canal = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CANAL_METODO)
        canal.setMethodCallHandler { call, result ->
            when (call.method) {
                "mostrar" -> {
                    val titulo = call.argument<String>("titulo") ?: "CLB Store"
                    val cuerpo = call.argument<String>("cuerpo") ?: ""
                    mostrarNotificacionNativa(titulo, cuerpo)
                    result.success(true)
                }
                "comprobarInicio" -> {
                    val abrir = intent.getStringExtra("origen_notificacion") == "pedidos"
                    if (abrir) intent.removeExtra("origen_notificacion")
                    result.success(abrir)
                }
                else -> result.notImplemented()
            }
        }
        canalNotificaciones = canal
    }

    private fun crearCanalNotificaciones() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canal = NotificationChannel(
                CANAL_AVISOS_ID,
                CANAL_AVISOS_NOMBRE,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notificaciones de pedidos confirmados y cancelados"
                enableVibration(true)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(canal)
        }
    }

    private fun mostrarNotificacionNativa(titulo: String, cuerpo: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            addCategory(Intent.CATEGORY_LAUNCHER)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("origen_notificacion", "pedidos")
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            System.currentTimeMillis().toInt(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CANAL_AVISOS_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH)
        }

        val notification = builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(titulo)
            .setContentText(cuerpo)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        manager.notify((System.currentTimeMillis() % 100000).toInt(), notification)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getStringExtra("origen_notificacion") == "pedidos") {
            intent.removeExtra("origen_notificacion")
            canalNotificaciones?.invokeMethod("abrirPedidos", null)
        }
    }
}
