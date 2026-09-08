// Windows subsystem in release builds, so launching Recall does not flash a
// console window. Debug builds keep the console for `eprintln!` diagnostics.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    recall_lib::run()
}
