package cn.guilu.attendance

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewFeature

// WebViewClient does not receive Chromium worker subresource requests. Forward
// only bundled offline resources through the same Rust handler as the page.
internal object WorkerOfflineAssets {
  private val lock = Any()
  private var sequence = 0L
  private var owner: Long? = null

  @SuppressLint("RequiresFeature")
  fun install(webViewId: String, documentStartScriptEnabled: Boolean): Long? {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) ||
      !WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)
    ) return null

    synchronized(lock) {
      val token = ++sequence
      val client = object : ServiceWorkerClientCompat() {
        override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? {
          if (!WorkerOfflineAssetPolicy.allows(request.url.toString(), request.method)) return null
          // Keep destruction and requests mutually exclusive: an old activity
          // cannot remove a new registration or call Rust after its view dies.
          return synchronized(lock) {
            if (owner != token) null
            else Rust.handleRequest(webViewId, request, documentStartScriptEnabled)
          }
        }
      }
      ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(client)
      owner = token
      return token
    }
  }

  @SuppressLint("RequiresFeature")
  fun remove(token: Long) {
    synchronized(lock) {
      if (owner != token) return
      ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(null)
      owner = null
    }
  }
}
