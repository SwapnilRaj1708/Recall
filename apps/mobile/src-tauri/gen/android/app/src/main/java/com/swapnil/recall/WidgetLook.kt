package com.swapnil.recall

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt

/**
 * The account's synced settings, as far as the widget is concerned.
 *
 * The app publishes them inside the snapshot, beside the tasks, because the
 * widget cannot reach the settings store any more than it can reach the task
 * list. Every value is validated here again rather than trusted: a malformed
 * colour must fall back to the default, not crash the launcher's render.
 *
 * `null` means "the widget's own default", exactly as in the app.
 */
data class WidgetLook(
    val addToBottom: Boolean = false,
    val autoClearCompleted: Boolean = false,
    /** Opaque RGB, or null for the theme's surface colour. */
    val background: Int? = null,
    val opacity: Float = DEFAULT_OPACITY,
    /** Opaque RGB, or null for no border (the phone widget's default). */
    val border: Int? = null,
    val corners: String? = null,
    val fontSizeSp: Float? = null,
    val color: Int? = null,
    val completedColor: Int? = null,
    val typeface: String = "system",
    val weight: String = "regular",
    val italic: Boolean = false,
    /** Left, top, right, bottom, in dp. */
    val margins: List<Int> = listOf(0, 0, 0, 0),
) {
    companion object {
        /** The `#D1` alpha the widget surface always had, as a fraction. */
        const val DEFAULT_OPACITY = 0.82f
        val DEFAULT = WidgetLook()

        fun parse(json: JSONObject?): WidgetLook {
            if (json == null) return DEFAULT
            val margins = json.optJSONObject("taskMargins")
            fun side(name: String) = (margins?.optInt(name, 0) ?: 0).coerceIn(0, 24)
            return WidgetLook(
                addToBottom = json.optBoolean("addToBottom", false),
                autoClearCompleted = json.optBoolean("autoClearCompleted", false),
                background = colour(json.opt("widgetBackground")),
                opacity = json.optDouble("widgetOpacity", DEFAULT_OPACITY.toDouble())
                    .toFloat()
                    .let { if (it.isNaN()) DEFAULT_OPACITY else it.coerceIn(0f, 1f) },
                // 'none' and the default are the same thing on the phone: the
                // widget has never had a border of its own.
                border = colour(json.opt("widgetBorder")),
                corners = json.optString("widgetCorners").takeIf {
                    it in listOf("none", "small", "medium", "large")
                },
                fontSizeSp = json.optDouble("taskFontSize").takeIf { !it.isNaN() }
                    ?.toFloat()?.coerceIn(10f, 24f),
                color = colour(json.opt("taskColor")),
                completedColor = colour(json.opt("taskCompletedColor")),
                typeface = json.optString("taskTypeface", "system")
                    .takeIf { it in listOf("system", "serif", "mono", "condensed") } ?: "system",
                weight = json.optString("taskWeight", "regular")
                    .takeIf { it in listOf("regular", "medium", "bold") } ?: "regular",
                italic = json.optBoolean("taskItalic", false),
                margins = listOf(side("left"), side("top"), side("right"), side("bottom")),
            )
        }

        private val HEX = Regex("^#[0-9a-fA-F]{6}$")

        private fun colour(value: Any?): Int? =
            (value as? String)?.takeIf { HEX.matches(it) }?.let { Color.parseColor(it) }
    }

    /** Corner radius in dp. The default is the 20dp the widget always had. */
    val cornerRadiusDp: Int
        get() = when (corners) {
            "none" -> 0
            "small" -> 6
            "medium" -> 12
            else -> 20
        }

    /** The background as ARGB: the chosen or theme colour at the chosen opacity. */
    fun backgroundArgb(context: Context): Int {
        val rgb = (background ?: context.getColor(R.color.widget_surface)) and 0xFFFFFF
        val alpha = (opacity * 255).roundToInt().coerceIn(0, 255)
        return (alpha shl 24) or rgb
    }

    fun textColor(context: Context, completed: Boolean): Int =
        if (completed) completedColor ?: context.getColor(R.color.widget_text_done)
        else color ?: context.getColor(R.color.widget_text)

    /**
     * Typeface, weight and italic, applied as spans.
     *
     * Spans rather than a Typeface object, because spans are what survive the
     * trip to the launcher's process; a TypefaceSpan only carries a family
     * name across. Android ships a medium cut only of its sans-serif families,
     * so a medium serif or mono falls back to regular rather than faking it.
     */
    fun styled(text: CharSequence): CharSequence {
        val family = when (typeface) {
            "serif" -> "serif"
            "mono" -> "monospace"
            "condensed" -> if (weight == "medium") "sans-serif-condensed-medium" else "sans-serif-condensed"
            else -> if (weight == "medium") "sans-serif-medium" else null
        }
        val style = when {
            weight == "bold" && italic -> Typeface.BOLD_ITALIC
            weight == "bold" -> Typeface.BOLD
            italic -> Typeface.ITALIC
            else -> null
        }
        if (family == null && style == null) return text
        return SpannableString(text).apply {
            if (family != null) setSpan(TypefaceSpan(family), 0, length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
            if (style != null) setSpan(StyleSpan(style), 0, length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
        }
    }

    /**
     * Whether the end-of-day clear-out has already claimed this task.
     *
     * The app deletes these at midnight, but only when it runs; until then the
     * widget would keep showing yesterday's finished work. Applying the same
     * rule here keeps the home screen honest in the meantime.
     */
    fun clearedOvernight(task: WidgetTask): Boolean {
        if (!autoClearCompleted || !task.completed) return false
        val completedAt = task.completedAt ?: return false
        val startOfToday = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant()
        return try {
            java.time.Instant.parse(completedAt).isBefore(startOfToday)
        } catch (_: Exception) {
            false
        }
    }
}
