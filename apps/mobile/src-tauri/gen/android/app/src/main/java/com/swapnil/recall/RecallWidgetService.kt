package com.swapnil.recall

import android.content.Intent
import android.graphics.Paint
import android.util.TypedValue
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/**
 * Backs the widget's scrolling list.
 *
 * A `ListView` inside `RemoteViews` is driven by a service in the app's process
 * rather than by an adapter the launcher can see. Android calls
 * [RemoteViewsFactory.onDataSetChanged] before reading rows, which is where the
 * snapshot is re-read — so the list is never drawn from data older than the
 * moment the refresh was requested.
 */
class RecallWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        RecallWidgetFactory(applicationContext)
}

private class RecallWidgetFactory(
    private val context: android.content.Context,
) : RemoteViewsService.RemoteViewsFactory {

    private var tasks: List<WidgetTask> = emptyList()
    private var look: WidgetLook = WidgetLook.DEFAULT

    override fun onCreate() {
        refresh()
    }

    /** Called on every refresh, before the rows are read. */
    override fun onDataSetChanged() {
        refresh()
    }

    /**
     * The app's snapshot with anything tapped on the widget laid over it,
     * so a row reflects the tap immediately rather than when the app next runs.
     */
    private fun refresh() {
        val state = WidgetStateStore.read(context)
        look = state.look
        tasks = WidgetActions.overlay(state, WidgetActions.read(context))
    }

    override fun onDestroy() {
        tasks = emptyList()
    }

    override fun getCount(): Int = tasks.size

    override fun getViewAt(position: Int): RemoteViews {
        // Android can ask for a position that has just been removed.
        val task = tasks.getOrNull(position) ?: return RemoteViews(
            context.packageName,
            R.layout.widget_loading,
        )

        val views = RemoteViews(context.packageName, R.layout.widget_item)
        // Links are underlined, as in the app. They cannot be tapped on the
        // widget itself — a collection row has one tap target per child, and
        // the text's is the editor — so the editor offers to open them.
        views.setTextViewText(R.id.item_text, look.styled(Links.underlined(task.text)))
        // Set every time, default included: the launcher reuses row views, so
        // a value set on one row would otherwise linger on the next.
        views.setTextViewTextSize(R.id.item_text, TypedValue.COMPLEX_UNIT_SP, look.fontSizeSp ?: 14f)
        val density = context.resources.displayMetrics.density
        val (left, top, right, bottom) = look.margins.map { (it * density).toInt() }
        views.setViewPadding(R.id.item_root, left, top, right, bottom)

        // A completed task reads as done three ways at once: the dot loses its
        // colour, the text greys out, and it is struck through. On a panel
        // glanced at rather than read, one signal is easy to miss.
        views.setImageViewResource(
            R.id.item_dot,
            if (task.completed) R.drawable.ic_widget_dot_done else R.drawable.ic_widget_dot,
        )
        views.setTextColor(R.id.item_text, look.textColor(context, task.completed))
        // RemoteViews has no strikethrough setter; setting the paint flags
        // directly is the supported way to reach it from another process.
        views.setInt(
            R.id.item_text,
            "setPaintFlags",
            if (task.completed) {
                Paint.STRIKE_THRU_TEXT_FLAG or Paint.ANTI_ALIAS_FLAG
            } else {
                Paint.ANTI_ALIAS_FLAG
            },
        )

        // Two targets in one row. The template lives on the ListView; each row
        // contributes only what distinguishes it, and the two children carry
        // different actions — which is how tapping the box completes while
        // tapping the text edits.
        views.setOnClickFillInIntent(
            R.id.item_toggle,
            Intent().apply {
                putExtra(WidgetActionActivity.EXTRA_TASK_ID, task.id)
                putExtra(WidgetActionActivity.EXTRA_TASK_TEXT, task.text)
                putExtra(WidgetActionActivity.EXTRA_COMPLETED, task.completed)
                putExtra(WidgetActionActivity.EXTRA_INTENT, WidgetActionActivity.INTENT_TOGGLE)
            },
        )
        views.setOnClickFillInIntent(
            R.id.item_text,
            Intent().apply {
                putExtra(WidgetActionActivity.EXTRA_TASK_ID, task.id)
                putExtra(WidgetActionActivity.EXTRA_TASK_TEXT, task.text)
                putExtra(WidgetActionActivity.EXTRA_COMPLETED, task.completed)
                putExtra(WidgetActionActivity.EXTRA_INTENT, WidgetActionActivity.INTENT_EDIT)
            },
        )

        return views
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 1

    override fun getItemId(position: Int): Long =
        tasks.getOrNull(position)?.id?.hashCode()?.toLong() ?: position.toLong()

    /** Ids are derived from task ids, which are stable across refreshes. */
    override fun hasStableIds(): Boolean = true
}
