package bo.clb.clb_store

import android.os.StatFs
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bo.clb.store/almacenamiento")
            .setMethodCallHandler { call, result ->
                if (call.method == "disponible") result.success(StatFs(filesDir.absolutePath).availableBytes)
                else result.notImplemented()
            }
    }
}
