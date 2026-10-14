package cn.guilu.attendance

import java.net.URI
import java.net.URISyntaxException

internal object WorkerOfflineAssetPolicy {
  private val resourcePath = Regex("^/offline/[A-Za-z0-9._/-]+$")

  fun allows(url: String, method: String): Boolean {
    if (method != "GET") return false
    val uri = try {
      URI(url)
    } catch (_: URISyntaxException) {
      return false
    }
    if (!(uri.scheme.equals("http", ignoreCase = true) ||
        uri.scheme.equals("https", ignoreCase = true)) ||
      !uri.rawAuthority.equals("tauri.localhost", ignoreCase = true) ||
      uri.port != -1 || uri.rawUserInfo != null || uri.fragment != null
    ) return false

    val pathname = uri.rawPath ?: return false
    if (pathname != uri.path || !resourcePath.matches(pathname)) return false
    return pathname.split('/').drop(1).none { it.isEmpty() || it == "." || it == ".." }
  }
}
