package com.swapnil.recall

import android.net.Uri
import android.text.SpannableString
import android.text.Spanned
import android.text.style.UnderlineSpan

/**
 * The links in a task's text, found the way the rest of Recall finds them.
 *
 * A copy of `packages/ui/src/links.ts`, which the web, desktop and phone apps
 * use: only `http(s)://` and `www.` count, and punctuation that ends the
 * sentence around a link is left out of it. The pattern and the trailing set
 * are pinned by a test against that file, so the widget cannot underline a
 * different part of a task than the app does.
 */
object Links {
    private val PATTERN = Regex("""\b(?:https?://|www\.)[^\s<>"]+""", RegexOption.IGNORE_CASE)
    private const val TRAILING = ".,;:!?'"
    private val CLOSERS = mapOf(')' to '(', ']' to '[', '}' to '{')

    data class Link(val start: Int, val end: Int, val text: String, val href: String)

    fun find(text: String): List<Link> = PATTERN.findAll(text).mapNotNull { match ->
        val raw = trimTrailing(match.value)
        val href = hrefFor(raw) ?: return@mapNotNull null
        Link(match.range.first, match.range.first + raw.length, raw, href)
    }.toList()

    /** The text with each link underlined — the widget's one visual cue for them. */
    fun underlined(text: String): CharSequence {
        val found = find(text)
        if (found.isEmpty()) return text
        return SpannableString(text).apply {
            found.forEach { setSpan(UnderlineSpan(), it.start, it.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        }
    }

    private fun trimTrailing(candidate: String): String {
        var end = candidate.length
        while (end > 0) {
            val last = candidate[end - 1]
            if (last in TRAILING) {
                end -= 1
                continue
            }
            val opener = CLOSERS[last]
            if (opener != null) {
                val body = candidate.substring(0, end)
                if (body.count { it == last } > body.count { it == opener }) {
                    end -= 1
                    continue
                }
            }
            break
        }
        return candidate.substring(0, end)
    }

    /** Only the two web schemes ever reach the browser. */
    private fun hrefFor(raw: String): String? {
        if (raw.isEmpty()) return null
        val absolute = if (raw.startsWith("http://", true) || raw.startsWith("https://", true)) raw else "https://$raw"
        val uri = Uri.parse(absolute)
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return null
        if (uri.host.isNullOrEmpty()) return null
        return absolute
    }
}
