// Android never calls this: the platform loads the cdylib and enters through
// the mobile entry point in lib.rs. It exists so the crate can also be built
// and run on the desktop, which is a much faster way to check the frontend.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    recall_mobile_lib::run()
}
