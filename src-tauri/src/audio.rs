use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use log::{error, info};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// Audio processor for microphone input with Teamspeak-like processing
pub struct AudioProcessor {
    buffer: Arc<Mutex<VecDeque<f32>>>,
    is_running: bool,
    sample_rate: u32,
    channels: u16,
    noise_gate_threshold: f32,
    compressor_threshold: f32,
    compressor_ratio: f32,
    auto_gain_level: f32,
    // Channel for sending processed audio to frontend
    tx: Option<mpsc::Sender<Vec<f32>>>,
}

impl AudioProcessor {
    pub fn new() -> Self {
        Self {
            buffer: Arc::new(Mutex::new(VecDeque::new())),
            is_running: false,
            sample_rate: 48000,
            channels: 1,
            noise_gate_threshold: -45.0,
            compressor_threshold: -20.0,
            compressor_ratio: 4.0,
            auto_gain_level: 0.5,
            tx: None,
        }
    }

    /// Set the audio callback channel for processed samples
    pub fn set_audio_callback(&mut self, tx: mpsc::Sender<Vec<f32>>) {
        self.tx = Some(tx);
    }

    /// Get the processed audio buffer (for external use)
    pub fn get_buffer(&self) -> Arc<Mutex<VecDeque<f32>>> {
        self.buffer.clone()
    }

    pub fn start(&mut self) -> Result<(), String> {
        if self.is_running {
            return Ok(());
        }

        info!("Starting audio processor...");

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No input device available".to_string())?;

        info!("Using input device (default) - audio processing enabled");

        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        self.sample_rate = config.sample_rate().0;
        self.channels = config.channels();

        info!(
            "Audio config: {} Hz, {} channels",
            self.sample_rate, self.channels
        );

        let buffer = self.buffer.clone();
        let tx = self.tx.clone();
        let noise_gate_threshold = self.noise_gate_threshold;
        let compressor_threshold = self.compressor_threshold;
        let compressor_ratio = self.compressor_ratio;
        let err_fn = |err| error!("Audio input error: {}", err);

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    // Process samples with audio chain
                    let noise_gate_lin = 10.0_f32.powf(noise_gate_threshold / 20.0);
                    let compressor_thr_lin = 10.0_f32.powf(compressor_threshold / 20.0);

                    let mut processed_samples = Vec::with_capacity(data.len());

                    for &sample in data.iter() {
                        // Noise gate
                        let gated = if sample.abs() < noise_gate_lin {
                            0.0
                        } else {
                            sample
                        };

                        // Compressor
                        let compressed = {
                            let abs_sample = gated.abs();
                            if abs_sample < compressor_thr_lin {
                                gated
                            } else {
                                let exceeded = abs_sample - compressor_thr_lin;
                                let compressed = compressor_thr_lin + exceeded / compressor_ratio;
                                gated.signum() * compressed.min(abs_sample)
                            }
                        };

                        // Auto-gain (1.5x boost like Teamspeak)
                        let processed = compressed * 1.5;

                        processed_samples.push(processed);
                    }

                    // Store in buffer
                    {
                        let mut buf = buffer.lock().unwrap();
                        for sample in processed_samples.iter() {
                            buf.push_back(*sample);
                        }
                        while buf.len() > 48000 * 2 {
                            buf.pop_front();
                        }
                    }

                    // Send to callback if available (in chunks to avoid overwhelming)
                    if let Some(sender) = &tx {
                        if processed_samples.len() >= 480 {
                            // 10ms chunks at 48kHz
                            let _ = sender.try_send(processed_samples);
                        }
                    }
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    // Process samples with audio chain
                    let noise_gate_lin = 10.0_f32.powf(noise_gate_threshold / 20.0);
                    let compressor_thr_lin = 10.0_f32.powf(compressor_threshold / 20.0);

                    let mut processed_samples = Vec::with_capacity(data.len());

                    for &sample in data.iter() {
                        // Convert to float
                        let float_sample = sample as f32 / 32768.0;

                        // Noise gate
                        let gated = if float_sample.abs() < noise_gate_lin {
                            0.0
                        } else {
                            float_sample
                        };

                        // Compressor
                        let compressed = {
                            let abs_sample = gated.abs();
                            if abs_sample < compressor_thr_lin {
                                gated
                            } else {
                                let exceeded = abs_sample - compressor_thr_lin;
                                let compressed = compressor_thr_lin + exceeded / compressor_ratio;
                                gated.signum() * compressed.min(abs_sample)
                            }
                        };

                        // Auto-gain (1.5x boost like Teamspeak)
                        let processed = compressed * 1.5;

                        processed_samples.push(processed);
                    }

                    // Store in buffer
                    {
                        let mut buf = buffer.lock().unwrap();
                        for sample in processed_samples.iter() {
                            buf.push_back(*sample);
                        }
                        while buf.len() > 48000 * 2 {
                            buf.pop_front();
                        }
                    }

                    // Send to callback if available (in chunks)
                    if let Some(sender) = &tx {
                        if processed_samples.len() >= 480 {
                            let _ = sender.try_send(processed_samples);
                        }
                    }
                },
                err_fn,
                None,
            ),
            _ => return Err("Unsupported sample format".to_string()),
        }
        .map_err(|e| format!("Failed to build input stream: {}", e))?;

        stream
            .play()
            .map_err(|e| format!("Failed to start stream: {}", e))?;

        self.is_running = true;
        info!("Audio processor started successfully");
        Ok(())
    }

    pub fn stop(&mut self) {
        if !self.is_running {
            return;
        }
        info!("Stopping audio processor...");
        self.is_running = false;
    }

    pub fn process_sample(&mut self, sample: f32) -> f32 {
        // Noise gate
        let gated = if sample.abs() < self.noise_gate_to_linear() {
            0.0
        } else {
            sample
        };

        // Compressor
        let compressed = self.apply_compressor(gated);

        // Auto-gain
        compressed * 1.5
    }

    fn noise_gate_to_linear(&self) -> f32 {
        10.0_f32.powf(self.noise_gate_threshold / 20.0)
    }

    fn apply_compressor(&self, sample: f32) -> f32 {
        let abs_sample = sample.abs();
        let threshold = 10.0_f32.powf(self.compressor_threshold / 20.0);

        if abs_sample < threshold {
            sample
        } else {
            let exceeded = abs_sample - threshold;
            let compressed = threshold + exceeded / self.compressor_ratio;
            sample.signum() * compressed.min(abs_sample)
        }
    }

    pub fn get_info(&self) -> AudioInfo {
        AudioInfo {
            sample_rate: self.sample_rate,
            channels: self.channels,
            is_running: self.is_running,
            noise_gate_db: self.noise_gate_threshold,
            compressor_threshold_db: self.compressor_threshold,
            compressor_ratio: self.compressor_ratio,
        }
    }

    pub fn set_noise_gate(&mut self, db: f32) {
        self.noise_gate_threshold = db;
        info!("Noise gate set to {} dB", db);
    }

    pub fn set_compressor_threshold(&mut self, db: f32) {
        self.compressor_threshold = db;
        info!("Compressor threshold set to {} dB", db);
    }

    pub fn set_compressor_ratio(&mut self, ratio: f32) {
        self.compressor_ratio = ratio;
        info!("Compressor ratio set to {}:1", ratio);
    }
}

#[derive(serde::Serialize)]
pub struct AudioInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub is_running: bool,
    pub noise_gate_db: f32,
    pub compressor_threshold_db: f32,
    pub compressor_ratio: f32,
}
