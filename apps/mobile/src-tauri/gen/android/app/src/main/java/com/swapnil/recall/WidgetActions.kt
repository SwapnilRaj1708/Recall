package com.swapnil.recall

import android.content.Context
import android.util.Log
import java.io.File
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the widget does when you act on it.
 *
 * The widget cannot reach the sync engine — that lives in the webview, which is
 * not running when the home screen is. So an action is appended here as a
 * pending operation, and the list is drawn as the app's snapshot with these
 * laid over the top. The row therefore changes under your finger, with no app
 * launch and no network.
 *
 * Two files, one writer each: the app owns `widget-state.json`, the widget owns
 * `widget-ops.json`. Nothing has to coordinate, and there is no race to lose.
 * When the app next runs it drains these through the engine — which is where
 * they pick up ordering, the outbox, and the same per-field merge every other
 * surface goes through — and republishes, at which point the overlay is empty
 * again because the ops are gone.
 */
object WidgetActions {
    private const val TAG = "RecallWidget"
    const val OP_CAPTURE = "capture"
    const val OP_SET_COMPLETED = "setCompleted"
    const val OP_SET_TEXT = "setText"
    const val OP_REMOVE = "remove"

    /**
     * A cap, so a widget acted on repeatedly while the app never opens cannot
     * grow this without bound. Far beyond any plausible session.
     */
    private const val MAX_OPS = 500

    data class Op(
        val kind: String,
        val id: String,
        val text: String?,
        val completed: Boolean?,
        val at: String,
    )

    private fun file(context: Context) = RecallStorage.opsFile(context)

    fun capture(context: Context, text: String) {
        // The id is generated here, exactly as the engine does for every other
        // surface, so the task has a stable identity from the moment it exists
        // and replaying this op twice cannot create two tasks.
        append(context, Op(OP_CAPTURE, UUID.randomUUID().toString(), text, false, now()))
    }

    fun setCompleted(context: Context, id: String, completed: Boolean) {
        append(context, Op(OP_SET_COMPLETED, id, null, completed, now()))
    }

    fun setText(context: Context, id: String, text: String) {
        append(context, Op(OP_SET_TEXT, id, text, null, now()))
    }

    fun remove(context: Context, id: String) {
        append(context, Op(OP_REMOVE, id, null, null, now()))
    }

    fun read(context: Context): List<Op> {
        val source = file(context)
        if (!source.isFile) return emptyList()
        return try {
            val array = JSONArray(source.readText())
            buildList {
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index) ?: continue
                    val kind = item.optString("kind")
                    val id = item.optString("id")
                    if (kind.isEmpty() || id.isEmpty()) continue
                    add(
                        Op(
                            kind = kind,
                            id = id,
                            text = if (item.has("text")) item.optString("text") else null,
                            completed = if (item.has("completed")) item.optBoolean("completed") else null,
                            at = item.optString("at"),
                        )
                    )
                }
            }
        } catch (error: Exception) {
            // Losing a queued action is bad; rendering a broken list is worse.
            Log.w(TAG, "could not read pending ops", error)
            emptyList()
        }
    }

    private fun append(context: Context, op: Op) {
        val ops = (read(context) + op).takeLast(MAX_OPS)
        val array = JSONArray()
        for (entry in ops) {
            array.put(
                JSONObject().apply {
                    put("kind", entry.kind)
                    put("id", entry.id)
                    entry.text?.let { put("text", it) }
                    entry.completed?.let { put("completed", it) }
                    put("at", entry.at)
                }
            )
        }

        // Written through a temporary file and renamed: this is the only record
        // that the tap happened, and a half-written file would lose it.
        val target = file(context)
        val temporary = File(target.parentFile, "${RecallStorage.OPS_FILE}.tmp")
        try {
            temporary.writeText(array.toString())
            if (!temporary.renameTo(target)) {
                target.writeText(array.toString())
                temporary.delete()
            }
        } catch (error: Exception) {
            Log.e(TAG, "could not record widget action", error)
        }
    }

    /**
     * The list as it should look right now: the app's snapshot with anything
     * the widget has done since laid over it.
     */
    fun overlay(state: WidgetState, ops: List<Op>): List<WidgetTask> {
        val tasks = state.tasks.toMutableList()
        val removed = mutableSetOf<String>()

        for (op in ops) {
            when (op.kind) {
                OP_CAPTURE -> {
                    if (tasks.none { it.id == op.id }) {
                        // Newest first, matching where a capture lands everywhere else.
                        tasks.add(0, WidgetTask(op.id, op.text.orEmpty(), false))
                    }
                }
                OP_SET_COMPLETED -> replace(tasks, op.id) { it.copy(completed = op.completed ?: it.completed) }
                OP_SET_TEXT -> replace(tasks, op.id) { it.copy(text = op.text ?: it.text) }
                OP_REMOVE -> removed.add(op.id)
            }
        }

        return tasks.filterNot { it.id in removed }
    }

    private fun replace(tasks: MutableList<WidgetTask>, id: String, change: (WidgetTask) -> WidgetTask) {
        val index = tasks.indexOfFirst { it.id == id }
        if (index >= 0) tasks[index] = change(tasks[index])
    }

    private fun now(): String =
        java.time.format.DateTimeFormatter.ISO_INSTANT.format(java.time.Instant.now())
}
