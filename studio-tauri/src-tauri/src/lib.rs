use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::time::Duration;

use tauri::{WebviewUrl, WebviewWindowBuilder};

const DAEMON_HOST: &str = "127.0.0.1:4949";
const DAEMON_URL: &str = "http://127.0.0.1:4949";
const POLL_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_millis(500);

// ponytail: hand-rolled TCP probe instead of an HTTP client dependency — this only
// needs "did something answer on the socket", not real response parsing.
fn daemon_is_up() -> bool {
    let addr = match DAEMON_HOST.parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1000)));
    let req = "GET /api/state HTTP/1.1\r\nHost: 127.0.0.1:4949\r\nConnection: close\r\n\r\n";
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 32];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => String::from_utf8_lossy(&buf[..n]).starts_with("HTTP/"),
        _ => false,
    }
}

fn studio_root() -> String {
    std::env::var("VOIDARCH_STUDIO_ROOT")
        .unwrap_or_else(|_| "/Users/davidpapp/Dev/Claude_Workflow_Plugin/dev-flow-control".into())
}

// Spawns the daemon detached from this process; we never kill it, so it survives app exit.
fn spawn_daemon() -> std::io::Result<()> {
    let log_dir = dirs_home().join(".voidarch-studio");
    std::fs::create_dir_all(&log_dir)?;
    let log_path = log_dir.join("daemon.log");
    let log_out = OpenOptions::new().create(true).append(true).open(&log_path)?;
    let log_err = log_out.try_clone()?;

    Command::new("pnpm")
        .args(["dfc:dashboard"])
        .current_dir(studio_root())
        .stdout(Stdio::from(log_out))
        .stderr(Stdio::from(log_err))
        .spawn()?;
    Ok(())
}

fn dirs_home() -> std::path::PathBuf {
    std::env::var("HOME").map(std::path::PathBuf::from).unwrap_or_else(|_| "/tmp".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if !daemon_is_up() {
                    if let Err(e) = spawn_daemon() {
                        log::error!("failed to spawn Voidarch Studio daemon: {e}");
                    }
                }

                let deadline = std::time::Instant::now() + POLL_TIMEOUT;
                let mut up = daemon_is_up();
                while !up && std::time::Instant::now() < deadline {
                    std::thread::sleep(POLL_INTERVAL);
                    up = daemon_is_up();
                }

                let url = if up {
                    WebviewUrl::External(DAEMON_URL.parse().expect("valid daemon url"))
                } else {
                    log::error!("Voidarch Studio daemon did not respond within {POLL_TIMEOUT:?}");
                    WebviewUrl::App("index.html".into())
                };

                WebviewWindowBuilder::new(&handle, "main", url)
                    .title("Voidarch Studio")
                    .inner_size(1200.0, 800.0)
                    .build()
                    .expect("failed to create main window");
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
