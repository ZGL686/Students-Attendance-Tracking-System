package cn.guilu.attendance

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkerOfflineAssetPolicyTest {
  @Test
  fun permitsOnlyBundledResourcesAtTheAppOrigin() {
    for (url in listOf(
      "http://tauri.localhost/offline/ocr/worker.min.js",
      "https://tauri.localhost/offline/ocr/core/tesseract-core-simd-lstm.wasm",
      "http://tauri.localhost/offline/ocr/lang/chi_sim.traineddata.gz",
      "https://tauri.localhost/offline/pdf/cmaps/UniGB-UTF16-H.bcmap",
      "HTTPS://TAURI.LOCALHOST/offline/pdf/pdf.worker.min.mjs?v=1"
    )) assertTrue(url, WorkerOfflineAssetPolicy.allows(url, "GET"))
  }

  @Test
  fun rejectsOtherOriginsSchemesCredentialsAndPorts() {
    for (url in listOf(
      "https://example.com/offline/ocr/worker.min.js",
      "http://tauri.localhost.evil/offline/ocr/worker.min.js",
      "http://tauri.localhost./offline/ocr/worker.min.js",
      "http://tauri.localhost:80/offline/ocr/worker.min.js",
      "https://tauri.localhost:443/offline/ocr/worker.min.js",
      "http://user@tauri.localhost/offline/ocr/worker.min.js",
      "http://tauri.localhost@evil.test/offline/ocr/worker.min.js",
      "file:///offline/ocr/worker.min.js",
      "content://tauri.localhost/offline/ocr/worker.min.js",
      "blob:http://tauri.localhost/offline/ocr/worker.min.js",
      "javascript:alert(1)",
      "not a valid URI"
    )) assertFalse(url, WorkerOfflineAssetPolicy.allows(url, "GET"))
  }

  @Test
  fun rejectsTraversalEncodedAliasesAndNonResourcePaths() {
    for (url in listOf(
      "http://tauri.localhost/",
      "http://tauri.localhost/offline/",
      "http://tauri.localhost/assets/index.js",
      "http://tauri.localhost/offline/../index.html",
      "http://tauri.localhost/offline/ocr/./worker.min.js",
      "http://tauri.localhost/offline/%2e%2e/index.html",
      "http://tauri.localhost/offline%2focr/worker.min.js",
      "http://tauri.localhost/offline//ocr/worker.min.js",
      "http://tauri.localhost/offline/ocr\\worker.min.js",
      "http://tauri.localhost/offline/ocr/worker.min.js#fragment"
    )) assertFalse(url, WorkerOfflineAssetPolicy.allows(url, "GET"))
  }

  @Test
  fun rejectsNonGetMethods() {
    val url = "http://tauri.localhost/offline/ocr/worker.min.js"
    for (method in listOf("POST", "PUT", "DELETE", "HEAD", "OPTIONS", "get", "")) {
      assertFalse(method, WorkerOfflineAssetPolicy.allows(url, method))
    }
  }
}
