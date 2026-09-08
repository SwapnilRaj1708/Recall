package com.swapnil.recall

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * The home-screen widget.
 *
 * Renders from the snapshot the app publishes, so it appears immediately with
 * no webview start and no network. The scrolling list comes from
 * [RecallWidgetService]; this class owns the frame around it and the intents
 * its rows and the add strip fire.
 */
class RecallWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        manager: AppWidgetManager,
        widgetIds: IntArray,
    ) {
        for (id in widgetIds) render(context, manager, id)
    }

    /**
     * Re-render on resize.
     *
     * The user can pull this from two cells to most of the screen, and the row
     * count that fits changes with it.
     */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        widgetId: Int,
        newOptions: android.os.Bundle,
    ) {
        render(context, manager, widgetId)
    }

    private fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
        val state = WidgetStateStore.read(context)
        val views = RemoteViews(context.packageName, R.layout.widget_root)

        // The adapter reads the same snapshot. The data URI makes each widget
        // instance's intent distinct: without it Android reuses one adapter
        // across every instance and only the first would ever update.
        val adapter = Intent(context, RecallWidgetService::class.java).apply {
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
        }
        views.setRemoteAdapter(R.id.widget_list, adapter)
        views.setEmptyView(R.id.widget_list, R.id.widget_empty)

        views.setTextViewText(
            R.id.widget_empty,
            context.getString(
                when {
                    !state.present -> R.string.widget_loading
                    !state.signedIn -> R.string.widget_signed_out
                    else -> R.string.widget_empty
                }
            ),
        )

        // One template for every row; each row supplies only the differing
        // extras. A collection widget cannot give its items their own
        // PendingIntents, which is the whole reason this pattern exists.
        views.setPendingIntentTemplate(R.id.widget_list, rowTemplate(context, widgetId))
        views.setOnClickPendingIntent(R.id.widget_add, addIntent(context, widgetId))

        manager.updateAppWidget(widgetId, views)
        // The frame and the adapter's contents are refreshed separately.
        manager.notifyAppWidgetViewDataChanged(widgetId, R.id.widget_list)
    }

    private fun rowTemplate(context: Context, widgetId: Int): PendingIntent {
        val intent = Intent(context, WidgetActionActivity::class.java).apply {
            action = WidgetActionActivity.ACTION_ROW
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            data = Uri.parse("recall://widget/$widgetId/row")
        }
        return PendingIntent.getActivity(
            context,
            widgetId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
    }

    private fun addIntent(context: Context, widgetId: Int): PendingIntent {
        val intent = Intent(context, WidgetActionActivity::class.java).apply {
            action = WidgetActionActivity.ACTION_ADD
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            data = Uri.parse("recall://widget/$widgetId/add")
        }
        return PendingIntent.getActivity(
            context,
            // Distinct from the row template's request code, or the two
            // intents collapse into one and the add strip opens an editor.
            widgetId + ADD_REQUEST_OFFSET,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        private const val ADD_REQUEST_OFFSET = 1_000_000

        /** Repaint every instance. Called after anything changes the list. */
        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context) ?: return
            val ids = manager.getAppWidgetIds(
                ComponentName(context, RecallWidgetProvider::class.java)
            )
            if (ids.isEmpty()) return

            manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list)
            context.sendBroadcast(
                Intent(context, RecallWidgetProvider::class.java).apply {
                    action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
            )
        }
    }
}
