use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};

pub const REQUEST_ID: u64 = 9_000_000;

#[derive(Default)]
pub struct ShutdownReceipt {
    acknowledged: AtomicBool,
    failed: AtomicBool,
}

impl ShutdownReceipt {
    pub fn observe(&self, frame: &Value) {
        if frame["event"].as_str() == Some("transport_error") {
            self.fail();
        }
        if frame["version"].as_u64() == Some(1) && frame["id"].as_u64() == Some(REQUEST_ID) {
            if frame["ok"].as_bool() == Some(true) {
                self.acknowledged.store(true, Ordering::SeqCst);
            } else {
                self.fail();
            }
        }
    }

    pub fn fail(&self) {
        self.failed.store(true, Ordering::SeqCst);
    }

    pub fn confirmed(&self, process_succeeded: bool) -> bool {
        process_succeeded
            && self.acknowledged.load(Ordering::SeqCst)
            && !self.failed.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unrelated_or_incompatible_replies_cannot_confirm_shutdown() {
        let receipt = ShutdownReceipt::default();
        for frame in [
            json!({"version":1,"id":42,"ok":true}),
            json!({"version":2,"id":REQUEST_ID,"ok":true}),
            json!({"version":1,"event":"exit","exit_code":0}),
        ] {
            receipt.observe(&frame);
            assert!(!receipt.confirmed(true));
        }
        receipt.observe(&json!({"version":1,"id":REQUEST_ID,"ok":true}));
        assert!(receipt.confirmed(true));
        assert!(!receipt.confirmed(false));
    }

    #[test]
    fn later_transport_failure_invalidates_an_acknowledged_shutdown() {
        let receipt = ShutdownReceipt::default();
        receipt.observe(&json!({"version":1,"id":REQUEST_ID,"ok":true}));
        receipt.observe(&json!({"version":1,"event":"transport_error"}));
        assert!(!receipt.confirmed(true));
    }

    #[test]
    fn failed_shutdown_response_cannot_be_repaired_by_a_duplicate_success() {
        let receipt = ShutdownReceipt::default();
        receipt.observe(&json!({"version":1,"id":REQUEST_ID,"ok":false}));
        receipt.observe(&json!({"version":1,"id":REQUEST_ID,"ok":true}));
        assert!(!receipt.confirmed(true));
    }
}
