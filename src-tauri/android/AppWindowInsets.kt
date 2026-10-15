package cn.guilu.attendance

import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.max

internal object AppWindowInsets {
  fun install(content: View) {
    // Tauri replaces this container's children when attaching the WebView. Keep
    // the listener on the stable parent so the complete web viewport is fitted.
    val base = Insets.of(content.paddingLeft, content.paddingTop, content.paddingRight, content.paddingBottom)
    val bars = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    val ime = WindowInsetsCompat.Type.ime()
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val padding = paddingFor(base, insets.getInsets(bars), insets.getInsets(ime))
      view.setPadding(padding.left, padding.top, padding.right, padding.bottom)
      // Continue dispatching zero values for handled types. CONSUMED would stop
      // keyboard-hide updates and can leave old WebView safe-area padding behind.
      WindowInsetsCompat.Builder(insets)
        .setInsets(bars or ime, Insets.NONE)
        .build()
    }
    content.post { ViewCompat.requestApplyInsets(content) }
  }

  internal fun paddingFor(base: Insets, bars: Insets, ime: Insets): Insets = Insets.of(
    base.left + max(bars.left, ime.left),
    base.top + max(bars.top, ime.top),
    base.right + max(bars.right, ime.right),
    base.bottom + max(bars.bottom, ime.bottom)
  )
}
