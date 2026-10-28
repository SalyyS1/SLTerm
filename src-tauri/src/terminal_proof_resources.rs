#[path = "terminal_proof_processes.rs"]
mod processes;
use std::collections::{HashMap, HashSet};
use std::time::Instant;

pub struct ProcessUsage {
    pub pid: u32, pub name: String, pub category: &'static str,
    pub working: u64, pub private: u64,
}
pub struct Sample {
    pub items: Vec<ProcessUsage>, pub missing: usize, pub cpu_percent: Option<f64>,
    pub logical_cpus: usize, pub elapsed_ms: Option<u128>,
}
#[derive(Default)]
pub struct Sampler { previous: HashMap<(u32, u64), u64>, at: Option<Instant> }

fn category(name: &str) -> &'static str {
    match name.to_ascii_lowercase().as_str() {
        "slterm.exe" => "application",
        "slterm-core-proof.exe" => "backend",
        "msedgewebview2.exe" => "webview",
        "conhost.exe" | "openconsole.exe" => "console",
        "powershell.exe" | "pwsh.exe" | "cmd.exe" | "bash.exe" | "wsl.exe" => "shell",
        "codex.exe" | "claude.exe" | "codex" | "claude" => "provider",
        _ => "other",
    }
}

impl Sampler {
    pub fn sample(&mut self) -> Result<Sample, String> {
        let root = std::process::id();
        let root_usage = processes::counters(root).ok_or("Cannot sample SLTerm process")?;
        let (captured, mut pending) = processes::inventory()?;
        let mut identities = HashMap::from([(root, root_usage.created)]);
        let mut current = HashMap::from([((root, root_usage.created), root_usage.cpu_ticks)]);
        let mut items = vec![ProcessUsage { pid: root, name: "slterm.exe".into(), category: "application", working: root_usage.working, private: root_usage.private }];
        let mut missing = HashSet::new();
        // Follow only children whose creation follows a verified parent's birth.
        // A recycled parent PID must not draw unrelated processes into the tree.
        loop {
            let mut grew = false;
            pending.retain(|entry| {
                if entry.pid == root { return false; }
                let Some(parent_birth) = identities.get(&entry.parent) else { return true; };
                let Some(usage) = processes::counters(entry.pid) else { missing.insert(entry.pid); return false; };
                if usage.created >= *parent_birth && usage.created <= captured && !identities.contains_key(&entry.pid) {
                    identities.insert(entry.pid, usage.created);
                    current.insert((entry.pid, usage.created), usage.cpu_ticks);
                    items.push(ProcessUsage { pid: entry.pid, name: entry.name.clone(), category: category(&entry.name), working: usage.working, private: usage.private });
                    grew = true;
                }
                false
            });
            if !grew { break; }
        }
        let now = Instant::now();
        let logical_cpus = std::thread::available_parallelism().map(usize::from).unwrap_or(1);
        let elapsed = self.at.map(|at| now.duration_since(at));
        // First sample and gaps over 15s are deliberately not CPU estimates.
        let cpu_percent = elapsed.filter(|duration| !duration.is_zero() && duration.as_secs() < 15).map(|duration| {
            let ticks: u64 = current.iter().filter_map(|(identity, ticks)| self.previous.get(identity).map(|old| ticks.saturating_sub(*old))).sum();
            ticks as f64 / 10_000_000.0 / duration.as_secs_f64() / logical_cpus as f64 * 100.0
        });
        self.previous = current; self.at = Some(now);
        Ok(Sample { items, missing: missing.len(), cpu_percent, logical_cpus, elapsed_ms: elapsed.map(|value| value.as_millis()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn samples_current_process_without_claiming_first_cpu_interval() {
        let mut sampler = Sampler::default();
        let first = sampler.sample().unwrap();
        assert_eq!(first.cpu_percent, None);
        let own = first.items.iter().find(|item| item.pid == std::process::id()).unwrap();
        assert!(own.working > 0 && own.private > 0);
        let second = sampler.sample().unwrap();
        assert!(second.cpu_percent.unwrap() >= 0.0);
        assert!(second.logical_cpus > 0);
    }
    #[test]
    fn groups_known_processes_without_inferring_unknown_providers() {
        assert_eq!(category("MSedgeWebView2.exe"), "webview");
        assert_eq!(category("node.exe"), "other");
        assert_eq!(category("wsl.exe"), "shell");
    }
}
