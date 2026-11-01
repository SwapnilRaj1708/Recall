package com.swapnil.recall

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Sending a capture straight to the server, without the app.
 *
 * Best effort by design. The capture is already safe in the queue the app
 * drains before this is called, so a failure here costs nothing but time: the
 * link reaches the server when the app next opens instead of now.
 *
 * It acts as the user with the access token the app last published — never
 * a refresh token, which rotates and must have a single holder. So this works
 * while that token is still valid, an hour after the app last refreshed it,
 * and quietly does nothing after that.
 *
 * The row goes through `push_tasks`, the same merge every client uses, under
 * the id the queue entry carries. When the app later replays the capture it
 * converges on this same row rather than creating a second one.
 */
object DirectSync {
    private const val TAG = "RecallShare"
    private const val CREDENTIALS_FILE = "sync-credentials.json"
    /** Leave this much of the token's life unused, for clock skew and the request itself. */
    private const val EXPIRY_MARGIN_SECONDS = 60L
    private const val TIMEOUT_MS = 10_000

    private data class Credentials(
        val supabaseUrl: String,
        val anonKey: String,
        val accessToken: String,
        val expiresAt: Long,
    )

    fun pushCapture(context: Context, id: String, text: String) {
        val credentials = read(context) ?: return
        if (credentials.expiresAt - EXPIRY_MARGIN_SECONDS <= System.currentTimeMillis() / 1000) {
            Log.i(TAG, "access token expired; the app will send this when it opens")
            return
        }

        val state = WidgetStateStore.read(context)
        val positions = state.positions ?: return
        val position = if (state.look.addToBottom) positions.second else positions.first

        // Off the main thread; the activity that called this has already gone.
        Thread {
            try {
                val status = post(credentials, row(id, text, position))
                Log.i(TAG, "sent shared capture: HTTP $status")
            } catch (error: Exception) {
                Log.w(TAG, "could not send shared capture; it stays queued", error)
            }
        }.start()
    }

    private fun read(context: Context): Credentials? {
        val file = File(RecallStorage.writeDir(context), CREDENTIALS_FILE)
        if (!file.isFile) return null
        return try {
            val json = JSONObject(file.readText())
            Credentials(
                supabaseUrl = json.getString("supabaseUrl").trimEnd('/'),
                anonKey = json.getString("anonKey"),
                accessToken = json.getString("accessToken"),
                expiresAt = json.getLong("expiresAt"),
            ).takeIf { it.supabaseUrl.startsWith("https://") }
        } catch (error: Exception) {
            Log.w(TAG, "unreadable credentials", error)
            null
        }
    }

    /** A new task in the shape `push_tasks` takes, every clock set to now. */
    private fun row(id: String, text: String, position: String): JSONObject {
        val now = java.time.format.DateTimeFormatter.ISO_INSTANT.format(java.time.Instant.now())
        return JSONObject()
            .put("id", id)
            .put("text", text)
            .put("completed", false)
            .put("completed_at", JSONObject.NULL)
            .put("position", position)
            .put("deleted_at", JSONObject.NULL)
            .put("created_at", now)
            .put("text_updated_at", now)
            .put("completed_updated_at", now)
            .put("position_updated_at", now)
            .put("deleted_updated_at", now)
            .put("updated_at", now)
    }

    private fun post(credentials: Credentials, row: JSONObject): Int {
        val connection = URL("${credentials.supabaseUrl}/rest/v1/rpc/push_tasks")
            .openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("apikey", credentials.anonKey)
            connection.setRequestProperty("Authorization", "Bearer ${credentials.accessToken}")
            connection.setRequestProperty("Content-Type", "application/json")
            val body = JSONObject().put("batch", JSONArray().put(row)).toString()
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            return connection.responseCode
        } finally {
            connection.disconnect()
        }
    }
}
