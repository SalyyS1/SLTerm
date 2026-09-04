use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    // The About modal shows a build time. It was hardcoded to 0, which renders as
    // the Unix epoch — a wrong answer rather than a missing one, and the kind that
    // makes a bug report useless because nobody can tell which build the reporter
    // is running.
    //
    // SOURCE_DATE_EPOCH wins when the environment sets it: that is the
    // reproducible-builds convention, and honouring it means two builds of the
    // same commit produce identical binaries. Otherwise stamp now.
    let build_time = std::env::var("SOURCE_DATE_EPOCH")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0)
        });
    println!("cargo:rustc-env=SLTERM_BUILD_TIME={build_time}");
    println!("cargo:rerun-if-env-changed=SOURCE_DATE_EPOCH");

    tauri_build::build()
}
