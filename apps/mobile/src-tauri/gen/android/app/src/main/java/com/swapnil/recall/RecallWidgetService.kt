package com.swapnil.recall

import android.content.Intent
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

    override fun onCreate() {
        tasks = current()
    }

    /** Called on every refresh, before the rows are read. */
    override fun onDataSetChanged() {
        tasks = current()
    }

    /**
     * The app's snapshot with anything tapped on the widget laid over it,
     * so a row reflects the tap immediately rather than when the app next runs.
     */
    private fun current(): List<WidgetTask> =
        WidgetActions.overlay(WidgetStateStore.read(context), WidgetActions.read(context))

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
        views.setTextViewText(R.id.item_text, task.text)
        views.setImageViewResource(
            R.id.item_check,
            if (task.completed) R.drawable.ic_widget_checked else R.drawable.ic_widget_unchecked,
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
