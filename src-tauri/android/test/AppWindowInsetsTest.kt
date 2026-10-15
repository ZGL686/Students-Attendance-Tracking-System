package cn.guilu.attendance

import androidx.core.graphics.Insets
import org.junit.Assert.assertEquals
import org.junit.Test

class AppWindowInsetsTest {
  @Test
  fun threeButtonAndGestureNavigationUseTheirReportedInsets() {
    assertEquals(Insets.of(0, 90, 0, 144), AppWindowInsets.paddingFor(Insets.NONE, Insets.of(0, 90, 0, 144), Insets.NONE))
    assertEquals(Insets.of(0, 90, 0, 54), AppWindowInsets.paddingFor(Insets.NONE, Insets.of(0, 90, 0, 54), Insets.NONE))
  }

  @Test
  fun landscapeNavigationAndCutoutKeepBothSidesClear() {
    assertEquals(Insets.of(110, 0, 144, 0), AppWindowInsets.paddingFor(Insets.NONE, Insets.of(110, 0, 144, 0), Insets.NONE))
  }

  @Test
  fun keyboardAndNavigationOverlapInsteadOfAddingTheirHeights() {
    val bars = Insets.of(0, 90, 0, 144)
    assertEquals(Insets.of(0, 90, 0, 960), AppWindowInsets.paddingFor(Insets.NONE, bars, Insets.of(0, 0, 0, 960)))
    assertEquals(bars, AppWindowInsets.paddingFor(Insets.NONE, bars, Insets.NONE))
  }

  @Test
  fun updatesPreserveBasePaddingWithoutAccumulatingPreviousInsets() {
    val base = Insets.of(2, 3, 4, 5)
    val bars = Insets.of(0, 90, 0, 144)
    val expected = Insets.of(2, 93, 4, 149)
    assertEquals(expected, AppWindowInsets.paddingFor(base, bars, Insets.NONE))
    assertEquals(expected, AppWindowInsets.paddingFor(base, bars, Insets.NONE))
    assertEquals(base, AppWindowInsets.paddingFor(base, Insets.NONE, Insets.NONE))
  }
}
