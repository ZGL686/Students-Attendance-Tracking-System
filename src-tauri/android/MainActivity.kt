package cn.guilu.attendance

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    window.setSoftInputMode(
      (window.attributes.softInputMode and WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST.inv()) or
        WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
    )
    AppWindowInsets.install(findViewById(android.R.id.content))
  }
}
