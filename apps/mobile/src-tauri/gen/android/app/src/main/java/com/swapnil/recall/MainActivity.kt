package com.swapnil.recall

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * Refresh the home-screen widget on the way out.
   *
   * This is the moment it matters: the user has just added or completed
   * something and is heading back to the home screen, where the widget is about
   * to be visible. The app republishes its snapshot as the list changes, but
   * nothing has told the widget to repaint — the webview cannot reach the
   * AppWidgetManager, and this is the cheapest place that can.
   */
  override fun onStop() {
    super.onStop()
    RecallWidgetProvider.refreshAll(this)
  }
}
