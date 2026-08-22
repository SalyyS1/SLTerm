// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    slterm_lib::run()
}
