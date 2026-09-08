package com.swapnil.recall

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
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
            ACTION_SYNC -> INTENT_SYNC
            else -> intent.getStringExtra(EXTRA_INTENT) ?: INTENT_ADD
        }

        when (request) {
            INTENT_TOGGLE -> applyToggle()
            INTENT_EDIT -> promptEdit()
            INTENT_SYNC -> openAppToSync()
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
            .showWithKeyboard(input)
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
            .showWithKeyboard(input)
    }

    /**
     * Show the dialog with the keyboard already up.
     *
     * The soft-input mode has to be set on the *dialog's* window, not the
     * activity's — a dialog gets its own, and setting it on the activity
     * produces the exact symptom of a focused-looking field with a blinking
     * cursor that needs a second tap before the keyboard appears.
     *
     * The flag must also be set before the window is shown, so it is applied to
     * the builder's dialog rather than after `show()`.
     */
    private fun AlertDialog.Builder.showWithKeyboard(input: EditText): AlertDialog {
        val dialog = create()
        dialog.window?.setSoftInputMode(
            WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or
                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        )
        dialog.show()
        // Belt and braces: on some launchers the window flag alone is not
        // enough once the activity is transparent, so ask outright too.
        input.requestFocus()
        input.post {
            val manager = getSystemService(InputMethodManager::class.java)
            manager?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        }
        return dialog
    }

    /**
     * Resync.
     *
     * The widget cannot talk to the server itself yet — that needs a native
     * Supabase client with its own copy of the session — so this opens the app,
     * which drains anything the widget queued, syncs, and refreshes the widget
     * on its way out.
     */
    private fun openAppToSync() {
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
        )
        finish()
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

    companion object {
        const val ACTION_ROW = "com.swapnil.recall.WIDGET_ROW"
        const val ACTION_ADD = "com.swapnil.recall.WIDGET_ADD"
        const val ACTION_SYNC = "com.swapnil.recall.WIDGET_SYNC"

        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_TASK_TEXT = "task_text"
        const val EXTRA_COMPLETED = "task_completed"
        const val EXTRA_INTENT = "intent"

        const val INTENT_TOGGLE = "toggle"
        const val INTENT_EDIT = "edit"
        const val INTENT_ADD = "add"
        const val INTENT_SYNC = "sync"
    }
}
