use log::info;
use std::sync::Arc;
use tokio::sync::mpsc;
use tauri::{AppHandle, Emitter};

mod audio;

use audio::{AudioProcessor, AudioInfo};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    env_logger::init();
    info!("VoiceSpace starting...");
    
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_audio_processor,
            stop_audio_processor,
            get_audio_info,
            set_noise_gate,
            set_compressor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Global audio processor state with sender for audio events
static AUDIO_PROCESSOR: std::sync::OnceLock<tokio::sync::Mutex<AudioProcessor>> = std::sync::OnceLock::new();

fn get_processor() -> &'static tokio::sync::Mutex<AudioProcessor> {
    AUDIO_PROCESSOR.get_or_init(|| tokio::sync::Mutex::new(AudioProcessor::new()))
}

#[tauri::command]
async fn start_audio_processor(app: AppHandle) -> Result<String, String> {
    let (tx, mut rx) = mpsc::channel::<Vec<f32>>(100);
    
    // Clone app handle for the background task
    let app_handle = app.clone();
    
    // Spawn task to forward audio events to frontend
    tokio::spawn(async move {
        while let Some(samples) = rx.recv().await {
            // Convert f32 samples to Vec<u8> (16-bit PCM)
            let pcm_data: Vec<u8> = samples
                .iter()
                .flat_map(|&s| {
                    let sample = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
                    sample.to_le_bytes()
                })
                .collect();
            
            // Emit to frontend
            let _ = app_handle.emit("audio-data", pcm_data);
        }
    });
    
    // Set the sender in the processor
    {
        let mut processor = get_processor().lock().await;
        processor.set_audio_callback(tx);
        processor.start()?;
    }
    
    Ok("Audio processor started with audio streaming".to_string())
}

#[tauri::command]
async fn stop_audio_processor() -> Result<String, String> {
    let mut processor = get_processor().lock().await;
    processor.stop();
    Ok("Audio processor stopped".to_string())
}

#[tauri::command]
async fn get_audio_info() -> Result<AudioInfo, String> {
    let processor = get_processor().lock().await;
    Ok(processor.get_info())
}

#[tauri::command]
async fn set_noise_gate(db: f32) -> Result<String, String> {
    let mut processor = get_processor().lock().await;
    processor.set_noise_gate(db);
    Ok(format!("Noise gate set to {} dB", db))
}

#[tauri::command]
async fn set_compressor(threshold_db: f32, ratio: f32) -> Result<String, String> {
    let mut processor = get_processor().lock().await;
    processor.set_compressor_threshold(threshold_db);
    processor.set_compressor_ratio(ratio);
    Ok(format!("Compressor set to {} dB, {}:1 ratio", threshold_db, ratio))
}