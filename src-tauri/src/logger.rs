use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn get_log_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("VoiceSpace");
    fs::create_dir_all(&path).ok();
    path.push("voicespace.log");
    path
}

pub fn write_log(msg: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(get_log_path())
    {
        let _ = writeln!(file, "{}", msg);
    }
}

pub fn write_log_timestamp(msg: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    write_log(&format!("[{}] {}", timestamp, msg));
}
