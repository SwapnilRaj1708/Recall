# The home-screen widget's classes are reached by name, not by call.
#
# The launcher inflates the widget in its own process from names in the
# manifest and in the RemoteViews the app hands it. R8 sees no caller for any
# of them and is free to rename or remove them — at which point the widget
# silently stops appearing in a release build while working perfectly in debug.
-keep class com.swapnil.recall.RecallWidgetProvider { *; }
-keep class com.swapnil.recall.RecallWidgetService { *; }
-keep class com.swapnil.recall.WidgetActionActivity { *; }
-keep class com.swapnil.recall.MainActivity { *; }

# RemoteViews.setInt(id, "setPaintFlags", n) resolves that setter reflectively
# at render time, in a process that has never loaded this app's code.
-keepclassmembers class * extends android.view.View {
    void set*(***);
    *** get*();
}

# Tauri's bridge between Rust and the webview is likewise resolved by name.
-keep class app.tauri.** { *; }
-keep class com.swapnil.recall.generated.** { *; }
