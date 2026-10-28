//! Disposable proof-shell policy, not a filesystem or operating-system sandbox.
use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub struct ProofShell {
    pub executable: PathBuf,
    pub arguments: Vec<String>,
    pub environment: Vec<(&'static str, OsString)>,
}

fn machine_psreadline(roots: &[PathBuf]) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    for root in roots {
        let module = root.join("PSReadLine");
        let bundled = module.join("PSReadLine.psd1");
        if bundled.is_file() {
            candidates.push((vec![0], bundled));
        }
        if let Ok(entries) = std::fs::read_dir(&module) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let Some(name) = name.to_str() else {
                    continue;
                };
                let Ok(version) = name
                    .split('.')
                    .map(str::parse::<u32>)
                    .collect::<Result<Vec<_>, _>>()
                else {
                    continue;
                };
                let manifest = entry.path().join("PSReadLine.psd1");
                if manifest.is_file() {
                    candidates.push((version, manifest));
                }
            }
        }
    }
    candidates
        .into_iter()
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, path)| path)
        .ok_or_else(|| {
            "A machine-wide PSReadLine installation is required; user modules are not searched"
                .into()
        })
}

fn ps_literal(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

fn startup_script(module: &Path, history: &Path) -> String {
    // PSReadLine defers its disk-history initialization until the first ReadLine.
    // Configure both a disposable path and SaveNothing before entering that prompt.
    format!(
        r#"$ErrorActionPreference = 'Stop'; try {{
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false);
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);
$OutputEncoding = [Console]::OutputEncoding;
Import-Module -Name {module} -Force;
Set-PSReadLineOption -HistorySavePath (Join-Path {history} ($PID.ToString() + '.txt')) -HistorySaveStyle SaveNothing;
if ((Get-Command Set-PSReadLineOption).Parameters.ContainsKey('PredictionSource')) {{ Set-PSReadLineOption -PredictionSource None; }}
$ErrorActionPreference = 'Continue';
}} catch {{ [Console]::Error.WriteLine('Proof shell initialization failed: ' + $_.Exception.Message); exit 1; }}"#,
        module = ps_literal(module),
        history = ps_literal(history)
    )
}

fn child_environment(
    profile: &Path,
    windows: &Path,
    module_roots: &[PathBuf],
) -> Result<Vec<(&'static str, OsString)>, String> {
    let shell_root = windows.join("System32/WindowsPowerShell/v1.0");
    let path = std::env::join_paths([
        windows.join("System32"),
        windows.to_path_buf(),
        windows.join("System32/Wbem"),
        shell_root,
    ])
    .map_err(|e| e.to_string())?;
    let modules = std::env::join_paths(module_roots).map_err(|e| e.to_string())?;
    Ok(vec![
        ("SystemRoot", windows.as_os_str().to_owned()),
        ("windir", windows.as_os_str().to_owned()),
        ("ComSpec", windows.join("System32/cmd.exe").into_os_string()),
        ("PATH", path),
        ("PATHEXT", ".COM;.EXE;.BAT;.CMD".into()),
        ("USERPROFILE", profile.join("home").into_os_string()),
        ("HOME", profile.join("home").into_os_string()),
        ("APPDATA", profile.join("appdata/Roaming").into_os_string()),
        (
            "LOCALAPPDATA",
            profile.join("appdata/Local").into_os_string(),
        ),
        ("TEMP", profile.join("temp").into_os_string()),
        ("TMP", profile.join("temp").into_os_string()),
        ("PSModulePath", modules),
        (
            "PSModuleAnalysisCachePath",
            profile
                .join("appdata/Local/module-analysis-cache")
                .into_os_string(),
        ),
        ("TERM", "xterm-256color".into()),
        ("POWERSHELL_TELEMETRY_OPTOUT", "1".into()),
    ])
}

pub fn prepare(profile: &Path) -> Result<ProofShell, String> {
    let windows =
        PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()));
    let program_files = PathBuf::from(
        std::env::var_os("ProgramW6432")
            .or_else(|| std::env::var_os("ProgramFiles"))
            .unwrap_or_else(|| "C:\\Program Files".into()),
    );
    let module_roots = [
        windows.join("System32/WindowsPowerShell/v1.0/Modules"),
        program_files.join("WindowsPowerShell/Modules"),
    ];
    let module = machine_psreadline(&module_roots)?;
    for relative in [
        "home",
        "appdata/Roaming",
        "appdata/Local",
        "temp",
        "history",
    ] {
        std::fs::create_dir_all(profile.join(relative)).map_err(|e| e.to_string())?;
    }
    let arguments = ["-NoLogo", "-NoProfile", "-NoExit", "-Command"]
        .into_iter()
        .map(String::from)
        .chain([startup_script(&module, &profile.join("history"))])
        .collect();
    Ok(ProofShell {
        executable: windows.join("System32/WindowsPowerShell/v1.0/powershell.exe"),
        arguments,
        environment: child_environment(profile, &windows, &module_roots)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_environment_is_an_allowlist_with_disposable_state_paths() {
        let profile = Path::new("C:/proof-run");
        let vars = child_environment(
            profile,
            Path::new("C:/Windows"),
            &[PathBuf::from("C:/machine-modules")],
        )
        .unwrap();
        assert_eq!(vars.len(), 15);
        for key in [
            "USERPROFILE",
            "HOME",
            "APPDATA",
            "LOCALAPPDATA",
            "TEMP",
            "TMP",
            "PSModuleAnalysisCachePath",
        ] {
            let value = &vars.iter().find(|(name, _)| *name == key).unwrap().1;
            assert!(
                Path::new(value).starts_with(profile),
                "non-disposable {key}"
            );
        }
        for key in [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "AWS_SECRET_ACCESS_KEY",
            "SLTERM_PROOF_PARENT_CANARY",
        ] {
            assert!(!vars.iter().any(|(name, _)| *name == key));
        }
    }

    #[test]
    fn startup_disables_disk_history_before_first_interactive_read() {
        let script = startup_script(
            Path::new("C:/machine/PSReadLine.psd1"),
            Path::new("C:/proof's-run/history"),
        );
        assert!(script.contains("-HistorySaveStyle SaveNothing"));
        assert!(script.contains("'C:/proof''s-run/history'"));
        assert!(script.contains("-PredictionSource None"));
        assert!(script.contains("[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)"));
        assert!(script.contains("[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)"));
        assert!(!script.contains("::ReadLine("));
    }
}
