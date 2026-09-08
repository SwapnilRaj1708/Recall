package com.swapnil.recall

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.widget.EditText
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * What a tap on the widget opens.
 *
 * A widget cannot show a dialog itself — `RemoteViews` has no such affordance —
 * so every interaction that needs input launches this, which is transparent and
 * shows a dialog over whatever is behind it. The home screen stays visible;
 * it does not feel like opening an app.
 *
 * Completing a task needs no input, so it is applied and the activity finishes
 * without ever drawing.
 */
class WidgetActionActivity : AppCompatActivity() {

    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Show over the lock screen's blur and keep the home screen behind.
        window.setFlags(
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
        )

        widgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        )

        // The row template supplies ACTION_ROW; the add strip supplies
        // ACTION_ADD. Which of the two row targets was tapped comes through as
        // an extra, since both share one template.
        val request = when (intent.action) {
            ACTION_ADD -> INTENT_ADD
            else -> intent.getStringExtra(EXTRA_INTENT) ?: INTENT_ADD
        }

        when (request) {
            INTENT_TOGGLE -> applyToggle()
            INTENT_EDIT -> promptEdit()
            else -> promptAdd()
        }
    }

    private fun applyToggle() {
        val id = intent.getStringExtra(EXTRA_TASK_ID)
        if (id == null) {
            finish()
            return
        }
        val completed = intent.getBooleanExtra(EXTRA_COMPLETED, false)
        WidgetActions.setCompleted(this, id, !completed)
        RecallWidgetProvider.refreshAll(this)
        finish()
    }

    private fun promptAdd() {
        val input = focusedInput(existing = null)
        AlertDialog.Builder(this)
            .setTitle(R.string.widget_dialog_add_title)
            .setView(pad(input))
            .setPositiveButton(R.string.widget_dialog_ok) { _, _ ->
                val text = input.text.toString().trim()
                if (text.isNotEmpty()) {
                    WidgetActions.capture(this, text)
                    RecallWidgetProvider.refreshAll(this)
                }
            }
            .setNegativeButton(R.string.widget_dialog_cancel, null)
            // Dismissing any way at all has to finish the activity, or the
            // transparent shell stays on top of the home screen.
            .setOnDismissListener { finish() }
            .show()
    }

    private fun promptEdit() {
        val id = intent.getStringExtra(EXTRA_TASK_ID)
        if (id == null) {
            finish()
            return
        }
        val input = focusedInput(existing = intent.getStringExtra(EXTRA_TASK_TEXT))

        AlertDialog.Builder(this)
            .setTitle(R.string.widget_dialog_edit_title)
            .setView(pad(input))
            .setPositiveButton(R.string.widget_dialog_ok) { _, _ ->
                val text = input.text.toString().trim()
                if (text.isNotEmpty()) {
                    WidgetActions.setText(this, id, text)
                    RecallWidgetProvider.refreshAll(this)
                }
            }
            .setNegativeButton(R.string.widget_dialog_cancel, null)
            // Delete belongs here because the editor is already open; making
            // the user go to the app to remove something they are looking at
            // would be the wrong trade.
            .setNeutralButton(R.string.widget_dialog_delete) { _, _ ->
                WidgetActions.remove(this, id)
                RecallWidgetProvider.refreshAll(this)
            }
            .setOnDismissListener { finish() }
            .show()
    }

    /** An input that is already focused, with the keyboard already up. */
    private fun focusedInput(existing: String?): EditText =
        EditText(this).apply {
            setSingleLine(false)
            maxLines = 4
            hint = getString(R.string.widget_dialog_hint)
            existing?.let {
                setText(it)
                setSelection(it.length)
            }
            requestFocus()
        }

    private fun pad(view: android.view.View) =
        android.widget.FrameLayout(this).apply {
            val horizontal = (24 * resources.displayMetrics.density).toInt()
            val vertical = (8 * resources.displayMetrics.density).toInt()
            setPadding(horizontal, vertical, horizontal, 0)
            addView(view)
        }

    override fun onResume() {
        super.onResume()
        // Ask for the keyboard once the window is actually attached; requesting
        // it during onCreate is too early and it silently does not appear.
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
    }

    companion object {
        const val ACTION_ROW = "com.swapnil.recall.WIDGET_ROW"
        const val ACTION_ADD = "com.swapnil.recall.WIDGET_ADD"

        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_TASK_TEXT = "task_text"
        const val EXTRA_COMPLETED = "task_completed"
        const val EXTRA_INTENT = "intent"

        const val INTENT_TOGGLE = "toggle"
        const val INTENT_EDIT = "edit"
        const val INTENT_ADD = "add"
    }
}
