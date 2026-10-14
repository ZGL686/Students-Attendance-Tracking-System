package cn.guilu.attendance

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var workerAssetsOwner: Long? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val rustWebView = webView as? RustWebView ?: return
    workerAssetsOwner?.let { WorkerOfflineAssets.remove(it) }
    workerAssetsOwner = WorkerOfflineAssets.install(
      rustWebView.id,
      rustWebView.isDocumentStartScriptEnabled
    )
  }

  override fun onDestroy() {
    workerAssetsOwner?.let { WorkerOfflineAssets.remove(it) }
    workerAssetsOwner = null
    super.onDestroy()
  }
}
