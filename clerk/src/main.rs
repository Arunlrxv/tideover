//! The clerk's entry point on OutLayer: read a request, answer on stdout.
//!
//! `PROTECTED_CLERK_SEED` is generated inside the enclave and stored against this
//! build's sha256, so only this exact code can ever read it. `NEAR_AI_API_KEY` pays
//! for the model.

use serde_json::{json, Value};
use std::io::{self, Read, Write};
use tideover_clerk::{handle, view_request, view_result, Net, MODEL_URL, RPC_URL};

// The manifest sits in a custom section, so it is covered by the build's sha256. It
// limits this program to two outbound hosts, and OutLayer's worker enforces that.
#[cfg(target_os = "wasi")]
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!("../manifest.json").len()] =
    *include_bytes!("../manifest.json");

struct Live;

impl Net for Live {
    fn view(&self, account: &str, method: &str, args: &Value) -> Result<Value, String> {
        view_result(&post(RPC_URL, &view_request(account, method, args), None)?)
    }

    fn model(&self, body: &str) -> Result<String, String> {
        let key = std::env::var("NEAR_AI_API_KEY").map_err(|_| "the clerk has no model key")?;
        post(MODEL_URL, body, Some(&key))
    }
}

#[cfg(target_os = "wasi")]
fn post(url: &str, body: &str, bearer: Option<&str>) -> Result<String, String> {
    use std::time::Duration;
    let mut request = wasi_http_client::Client::new()
        .post(url)
        .header("Content-Type", "application/json")
        .connect_timeout(Duration::from_secs(20));
    if let Some(key) = bearer {
        request = request.header("Authorization", format!("Bearer {key}"));
    }
    let response = request
        .body(body.as_bytes())
        .send()
        .map_err(|_| "a request from the clerk failed")?;
    let status = response.status();
    if !(200..300).contains(&status) {
        return Err(format!("a request from the clerk answered {status}"));
    }
    let bytes = response
        .body()
        .map_err(|_| "an answer to the clerk was cut off")?;
    String::from_utf8(bytes).map_err(|_| "an answer to the clerk is not text".to_string())
}

#[cfg(not(target_os = "wasi"))]
fn post(_url: &str, _body: &str, _bearer: Option<&str>) -> Result<String, String> {
    Err("this build has no network; run it on OutLayer".to_string())
}

fn seed() -> Result<Vec<u8>, ()> {
    let value = std::env::var("PROTECTED_CLERK_SEED").map_err(|_| ())?;
    let bytes = hex::decode(value.trim()).map_err(|_| ())?;
    if bytes.len() == 32 {
        Ok(bytes)
    } else {
        Err(())
    }
}

fn main() {
    let mut raw = String::new();
    let output = match (io::stdin().read_to_string(&mut raw), seed()) {
        (Ok(_), Ok(seed)) => handle(&raw, &seed, &Live),
        _ => json!({ "error": "the clerk is not set up" }),
    };
    print!("{output}");
    let _ = io::stdout().flush();
}
