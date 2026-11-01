package com.swapnil.recall

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * What the home-screen widget draws.
 *
 * The widget renders `RemoteViews` in this process but outside the webview, so
 * it cannot reach the IndexedDB mirror that holds the tasks. The app writes a
 * snapshot to app-private storage instead, and this reads it. That indirection
 * is also what lets the widget paint immediately: no webview start, no network.
 */
data class WidgetTask(
    val id: String,
    val text: String,
    val completed: Boolean,
    /** ISO instant, for the end-of-day clear-out; null when not known. */
    val completedAt: String? = null,
)

data class WidgetState(
    val signedIn: Boolean,
    val tasks: List<WidgetTask>,
    /** False when no snapshot has been written yet — a first run, not an empty list. */
    val present: Boolean,
    /** The account's settings, as far as the widget uses them. */
    val look: WidgetLook = WidgetLook.DEFAULT,
    /**
     * Positions for a new task at the top and at the bottom, as of the
     * snapshot. The share receiver needs one to send a task to the server.
     */
    val positions: Pair<String, String>? = null,
) {
    companion object {
        val MISSING = WidgetState(signedIn = false, tasks = emptyList(), present = false)
    }
}

object WidgetStateStore {
    private const val TAG = "RecallWidget"
    /** The shape the Rust side writes. A newer one is not safe to guess at. */
    private const val SUPPORTED_VERSION = 1

    fun read(context: Context): WidgetState {
        val file = RecallStorage.stateFile(context) ?: run {
            Log.i(TAG, "no snapshot yet under ${RecallStorage.searchDirs(context).first()}")
            return WidgetState.MISSING
        }

        return try {
            parse(file.readText())
        } catch (error: Exception) {
            // A half-written or corrupt file must not be shown as an empty
            // list. Reporting "missing" keeps the previous view instead.
            Log.w(TAG, "could not read snapshot at ${file.path}", error)
            WidgetState.MISSING
        }
    }

    fun parse(raw: String): WidgetState {
        val root = JSONObject(raw)

        val version = root.optInt("version", 0)
        if (version != SUPPORTED_VERSION) {
            Log.w(TAG, "snapshot version $version is not $SUPPORTED_VERSION; ignoring")
            return WidgetState.MISSING
        }

        val array = root.optJSONArray("tasks")
        val tasks = buildList {
            for (index in 0 until (array?.length() ?: 0)) {
                val item = array!!.optJSONObject(index) ?: continue
                val id = item.optString("id")
                val text = item.optString("text")
                if (id.isEmpty() || text.isEmpty()) continue
                add(
                    WidgetTask(
                        id = id,
                        text = text,
                        completed = item.optBoolean("completed"),
                        completedAt = item.optString("completedAt").takeIf { it.isNotEmpty() && it != "null" },
                    )
                )
            }
        }

        return WidgetState(
            signedIn = root.optBoolean("signedIn"),
            tasks = tasks,
            present = true,
            // Absent from snapshots written before settings existed; the
            // defaults are exactly how the widget looked then.
            look = WidgetLook.parse(root.optJSONObject("settings")),
            positions = root.optJSONObject("positions")?.let { positions ->
                val top = positions.optString("top")
                val bottom = positions.optString("bottom")
                if (top.isEmpty() || bottom.isEmpty()) null else top to bottom
            },
        )
    }
}
