package com.swapnil.recall

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast

/**
 * Recall in the share sheet.
 *
 * Share a video from YouTube or a reel from Instagram, pick Recall, and the
 * link is saved and you are back where you were — no screen opens. This
 * activity has no window at all (Theme.NoDisplay): it saves, raises a toast,
 * and finishes inside onCreate, which is what that theme requires and also why
 * the app you shared from never leaves the screen.
 *
 * The link goes into the same queue the home-screen widget writes, so it
 * appears on the widget at once and the app replays it the next time it
 * opens — durable before anything touches the network. If the app has been
 * used within the last hour, it is also sent straight to the server in the
 * background, so it reaches the desktop without waiting for that.
 */
class ShareReceiverActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val text = sharedText(intent)
        if (text == null) {
            toast(R.string.share_nothing)
        } else {
            val id = WidgetActions.capture(this, text)
            RecallWidgetProvider.refreshAll(this)
            toast(if (Links.find(text).isEmpty()) R.string.share_saved else R.string.share_link_saved)
            DirectSync.pushCapture(applicationContext, id, text)
        }

        // Before onResume, as Theme.NoDisplay requires.
        finish()
    }

    /**
     * What was shared, as a task.
     *
     * Apps disagree about what they put where: most send just the link as
     * text, some add a title as the subject, some send "Check this out:
     * https://…". The text is what the app chose to share, so it is kept as it
     * is, tidied the way every capture is; the subject is used only when there
     * is no text at all.
     */
    private fun sharedText(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_SEND) return null
        val raw = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            ?: intent.getStringExtra(Intent.EXTRA_SUBJECT)
            ?: return null
        return normalize(raw).takeIf { it.isNotEmpty() }
    }

    /** `normalizeText` from the app, so the task reads the same however it arrived. */
    private fun normalize(raw: String): String =
        raw.replace(WHITESPACE, " ").trim().take(MAX_TEXT_LENGTH)

    private fun toast(message: Int) {
        // The application context, because this activity is gone a moment later.
        Toast.makeText(applicationContext, message, Toast.LENGTH_SHORT).show()
    }

    companion object {
        private val WHITESPACE = Regex("\\s+")
        private const val MAX_TEXT_LENGTH = 2000
    }
}
