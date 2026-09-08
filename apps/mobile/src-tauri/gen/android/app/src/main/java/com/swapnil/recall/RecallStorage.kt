package com.swapnil.recall

import android.content.Context
import java.io.File

/**
 * Where the Kotlin side and the Rust side meet on disk.
 *
 * These two halves have to agree on a directory, and they name it in different
 * languages: Rust asks Tauri for `app_local_data_dir()`, Kotlin has `filesDir`,
 * `dataDir` and `noBackupFilesDir` to choose from. On Android that Tauri call
 * resolves to **dataDir**, not the `filesDir` that would be the obvious guess —
 * verified by reading back the path the publish command returns, not assumed.
 *
 * Guessing wrong here fails silently and asymmetrically: the widget still
 * renders, because the snapshot reader searches several locations, while every
 * action taken on the widget is written somewhere nothing drains and is lost
 * without a word. So rather than hard-code the answer, the queue is written
 * beside whichever snapshot was actually found. If Tauri ever moves it, both
 * sides move together.
 */
object RecallStorage {
    const val STATE_FILE = "widget-state.json"
    const val OPS_FILE = "widget-ops.json"

    /**
     * Candidate locations, most likely first.
     *
     * dataDir leads because that is where Tauri writes today; the rest are
     * there so a change of Tauri's mind degrades to "still works" rather than
     * "widget is permanently empty".
     */
    fun searchDirs(context: Context): List<File> = listOfNotNull(
        context.dataDir,
        context.filesDir,
        context.noBackupFilesDir,
        File(context.dataDir, "files"),
    )

    /** The snapshot the app published, wherever it turned out to be. */
    fun stateFile(context: Context): File? =
        searchDirs(context).map { File(it, STATE_FILE) }.firstOrNull { it.isFile }

    /**
     * The directory to write the widget's own queue into.
     *
     * Beside the snapshot when there is one, so the Rust side draining from its
     * own idea of the directory finds it. Before the app has ever run, the
     * best available guess.
     */
    fun writeDir(context: Context): File =
        stateFile(context)?.parentFile ?: context.dataDir

    fun opsFile(context: Context): File = File(writeDir(context), OPS_FILE)
}
