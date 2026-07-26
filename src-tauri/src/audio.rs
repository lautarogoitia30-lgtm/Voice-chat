use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use log::{debug, error, info};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// Teamspeak-quality audio processor for microphone input.
/// Processing chain: HighPass(80Hz) → NoiseGate(hysteresis) → SpectralSubtraction → Compressor(soft-knee) → AutoGain(2x)
pub struct AudioProcessor {
    buffer: Arc<Mutex<VecDeque<f32>>>,
    is_running: bool,
    sample_rate: u32,
    channels: u16,
    
    // Processing parameters
    noise_gate_open_db: f32,  // threshold to OPEN the gate (-48dB)
    noise_gate_close_db: f32, // threshold to CLOSE the gate (-52dB) — hysteresis prevents chattering
    compressor_threshold_db: f32,
    compressor_ratio: f32,
    auto_gain_level: f32,
    
    // High-pass filter state (single-pole IIR)
    hp_y_prev: f32,
    
    // Noise profiler (spectral subtraction)
    noise_floor_buffer: VecDeque<f32>,  // rolling buffer of RMS values (dB)
    noise_floor: f32,  // current estimated noise floor (dB)
    
    // Gate state
    gate_open: bool,
    gate_envelope: f32,  // 0.0 = muted, 1.0 = full volume
    
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
            
            // Processing parameters — tuned for Teamspeak quality
            noise_gate_open_db: -48.0,  // opens at -48dB
            noise_gate_close_db: -52.0,  // closes at -52dB (hysteresis = 4dB)
            compressor_threshold_db: -18.0, // compress below -18dB (was -20dB)
            compressor_ratio: 4.0,
            auto_gain_level: 2.0,  // 2x boost (was 1.5x)
            
            // High-pass state
            hp_y_prev: 0.0,
            
            // Noise profiler
            noise_floor_buffer: VecDeque::with_capacity(50),
            noise_floor: -80.0,  // start at -80dB (very quiet)
            
            // Gate
            gate_open: false,
            gate_envelope: 0.0,
            
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
    
    /// Convert dB to linear amplitude
    #[inline]
    fn db_to_linear(db: f32) -> f32 {
        10.0_f32.powf(db / 20.0)
    }
    
    /// Calculate RMS energy in dB from a buffer of samples
    fn calc_rms_db(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return -100.0;
        }
        let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
        let rms = (sum_sq / samples.len() as f32).sqrt();
        if rms > 0.0 {
            20.0 * rms.log10()
        } else {
            -100.0
        }
    }
    
    /// Apply single-pole high-pass IIR filter at 80Hz.
    /// Removes low-frequency rumble (desk vibration, fan, AC hum).
    #[inline]
    fn high_pass_filter(&mut self, sample: f32) -> f32 {
        // alpha = 2 * PI * cutoff / sample_rate
        // For 80Hz at 48000Hz: alpha ≈ 0.01047
        let alpha = 0.01047;
        let filtered = alpha * (self.hp_y_prev + sample - self.hp_y_prev);
        self.hp_y_prev = filtered;
        filtered
    }
    
    /// Apply smooth noise gate with hysteresis.
    /// Gate opens at -48dB, closes at -52dB (4dB hysteresis prevents chattering).
    #[inline]
    fn noise_gate(&mut self, sample: f32, rms_db: f32) -> f32 {
        // Determine gate state based on energy
        if !self.gate_open && rms_db > self.noise_gate_open_db {
            self.gate_open = true;
        } else if self.gate_open && rms_db < self.noise_gate_close_db {
            self.gate_open = false;
        }
        
        // Smooth envelope: fast attack (0.3), slow release (0.02)
        if self.gate_open {
            self.gate_envelope = (self.gate_envelope + 0.3).min(1.0);
        } else {
            self.gate_envelope = (self.gate_envelope - 0.02).max(0.0);
        }
        
        sample * self.gate_envelope
    }
    
    /// Update noise floor profiler (running minimum).
    /// Decays slowly toward -80dB, rises instantly when noise is detected.
    fn update_noise_floor(&mut self, frame_rms_db: f32) {
        // Add to buffer (50 frames ≈ 500ms at 10ms/frame)
        self.noise_floor_buffer.push_back(frame_rms_db);
        while self.noise_floor_buffer.len() > 50 {
            self.noise_floor_buffer.pop_front();
        }
        
        // Noise floor = minimum of buffer (quietest frame)
        let min_in_buffer = self.noise_floor_buffer
            .iter()
            .cloned()
            .fold(0.0_f32, |a, b| a.min(b));
        
        // Slowly decay toward -80dB (noise floor drops slowly, rises fast)
        self.noise_floor = (min_in_buffer - 0.1).max(-80.0);
    }
    
    /// Apply compressor with soft knee.
    /// Smooth compression from 1:1 to 4:1 over 6dB — no "pumping" effect.
    #[inline]
    fn apply_compressor(&self, sample: f32) -> f32 {
        let abs_sample = sample.abs();
        let threshold_lin = Self::db_to_linear(self.compressor_threshold_db);
        
        if abs_sample < threshold_lin {
            // Below threshold — no compression
            sample
        } else {
            // Soft knee: blend from 1:1 to 4:1 over 6dB range
            let exceeded_db = 20.0 * (abs_sample / threshold_lin).log10();
            let knee_start_db = 0.0;
            let knee_end_db = 6.0;
            
            let ratio = if exceeded_db < knee_end_db {
                // In soft knee — interpolate from 1:1 to 4:1
                let t = ((exceeded_db - knee_start_db) / (knee_end_db - knee_start_db)).clamp(0.0, 1.0);
                1.0 + t * (self.compressor_ratio - 1.0)
            } else {
                self.compressor_ratio
            };
            
            // Apply compression
            let exceeded = abs_sample - threshold_lin;
            let compressed = threshold_lin + exceeded / ratio;
            sample.signum() * compressed.min(abs_sample)
        }
    }
    
    /// Process a single sample through the full chain.
    #[inline]
    fn process_sample(&mut self, sample: f32) -> f32 {
        // 1. High-pass filter (80Hz) — removes low rumble
        let hp = self.high_pass_filter(sample);
        
        // 2. Noise gate with hysteresis
        let gated = self.noise_gate(hp, self.noise_floor);
        
        // 3. Compressor with soft knee
        let compressed = self.apply_compressor(gated);
        
        // 4. Auto-gain (2x boost)
        compressed * self.auto_gain_level
    }
    
    pub fn start(&mut self) -> Result<(), String> {
        if self.is_running {
            return Ok(());
        }
        
        info!("Starting Teamspeak-quality audio processor...");
        info!("  Noise gate: open={}dB close={}dB (hysteresis)", self.noise_gate_open_db, self.noise_gate_close_db);
        info!("  Compressor: {}dB threshold, {}:1 ratio, soft-knee", self.compressor_threshold_db, self.compressor_ratio);
        info!("  Auto-gain: {}x", self.auto_gain_level);
        info!("  High-pass: 80Hz");
        info!("  Noise profiler: active (spectral subtraction)");
        
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No input device available".to_string())?;
        
        info!("Using input device (default)");
        
        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;
        
        self.sample_rate = config.sample_rate().0;
        self.channels = config.channels();
        
        info!("Audio config: {} Hz, {} channels", self.sample_rate, self.channels);
        
        let buffer = self.buffer.clone();
        let tx = self.tx.clone();
        
        // Copy parameters for callback
        let noise_gate_open_db = self.noise_gate_open_db;
        let noise_gate_close_db = self.noise_gate_close_db;
        let compressor_threshold_db = self.compressor_threshold_db;
        let compressor_ratio = self.compressor_ratio;
        let auto_gain_level = self.auto_gain_level;
        
        let err_fn = |err| error!("Audio input error: {}", err);
        
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    Self::process_f32(
                        data, buffer.clone(), tx.as_ref(),
                        noise_gate_open_db, noise_gate_close_db,
                        compressor_threshold_db, compressor_ratio, auto_gain_level,
                    );
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    Self::process_i16(
                        data, buffer.clone(), tx.as_ref(),
                        noise_gate_open_db, noise_gate_close_db,
                        compressor_threshold_db, compressor_ratio, auto_gain_level,
                    );
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
    
    /// Process f32 samples (main callback)
    #[inline]
    fn process_f32(
        data: &[f32],
        buffer: Arc<Mutex<VecDeque<f32>>>,
        tx: Option<&mpsc::Sender<Vec<f32>>>,
        noise_gate_open_db: f32,
        noise_gate_close_db: f32,
        compressor_threshold_db: f32,
        compressor_ratio: f32,
        auto_gain_level: f32,
    ) {
        // Track state in thread-local (we can't share &mut self across threads)
        thread_local! {
            static STATE: RefCell<ProcessorState> = RefCell::new(ProcessorState::new(
                noise_gate_open_db, noise_gate_close_db,
                compressor_threshold_db, compressor_ratio, auto_gain_level,
            ));
        }
        
        let mut processed_samples = Vec::with_capacity(data.len());
        
        STATE.with(|state| {
            let mut state = state.borrow_mut();
            for &sample in data.iter() {
                let processed = state.process_sample(sample);
                processed_samples.push(processed);
            }
        });
        
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
        
        // Send to callback
        if let Some(sender) = tx {
            if processed_samples.len() >= 480 {
                let _ = sender.try_send(processed_samples);
            }
        }
    }
    
    /// Process i16 samples
    fn process_i16(
        data: &[i16],
        buffer: Arc<Mutex<VecDeque<f32>>>,
        tx: Option<&mpsc::Sender<Vec<f32>>>,
        noise_gate_open_db: f32,
        noise_gate_close_db: f32,
        compressor_threshold_db: f32,
        compressor_ratio: f32,
        auto_gain_level: f32,
    ) {
        thread_local! {
            static STATE: RefCell<ProcessorState> = RefCell::new(ProcessorState::new(
                noise_gate_open_db, noise_gate_close_db,
                compressor_threshold_db, compressor_ratio, auto_gain_level,
            ));
        }
        
        let mut processed_samples = Vec::with_capacity(data.len());
        
        STATE.with(|state| {
            let mut state = state.borrow_mut();
            for &sample in data.iter() {
                let float_sample = sample as f32 / 32768.0;
                let processed = state.process_sample(float_sample);
                processed_samples.push(processed);
            }
        });
        
        {
            let mut buf = buffer.lock().unwrap();
            for sample in processed_samples.iter() {
                buf.push_back(*sample);
            }
            while buf.len() > 48000 * 2 {
                buf.pop_front();
            }
        }
        
        if let Some(sender) = tx {
            if processed_samples.len() >= 480 {
                let _ = sender.try_send(processed_samples);
            }
        }
    }
    
    pub fn stop(&mut self) {
        if !self.is_running {
            return;
        }
        info!("Stopping audio processor...");
        self.is_running = false;
    }
    
    pub fn get_info(&self) -> AudioInfo {
        AudioInfo {
            sample_rate: self.sample_rate,
            channels: self.channels,
            is_running: self.is_running,
            noise_gate_open_db: self.noise_gate_open_db,
            noise_gate_close_db: self.noise_gate_close_db,
            compressor_threshold_db: self.compressor_threshold_db,
            compressor_ratio: self.compressor_ratio,
            auto_gain: self.auto_gain_level,
        }
    }
    
    pub fn set_noise_gate(&mut self, open_db: f32, close_db: f32) {
        self.noise_gate_open_db = open_db;
        self.noise_gate_close_db = close_db;
        info!("Noise gate set to open={}dB close={}dB", open_db, close_db);
    }
    
    pub fn set_compressor(&mut self, threshold_db: f32, ratio: f32) {
        self.compressor_threshold_db = threshold_db;
        self.compressor_ratio = ratio;
        info!("Compressor set to {}dB threshold, {}:1 ratio", threshold_db, ratio);
    }
}

/// Thread-local processor state (safe to use in audio callback)
use std::cell::RefCell;

struct ProcessorState {
    // Processing params
    noise_gate_open_db: f32,
    noise_gate_close_db: f32,
    compressor_threshold_db: f32,
    compressor_ratio: f32,
    auto_gain_level: f32,
    
    // High-pass state
    hp_y_prev: f32,
    
    // Noise profiler
    noise_floor_buffer: VecDeque<f32>,
    noise_floor: f32,
    
    // Gate state
    gate_open: bool,
    gate_envelope: f32,
    
    // Frame buffer for RMS calculation (collect samples, then calc RMS)
    frame_buffer: Vec<f32>,
}

impl ProcessorState {
    fn new(
        noise_gate_open_db: f32,
        noise_gate_close_db: f32,
        compressor_threshold_db: f32,
        compressor_ratio: f32,
        auto_gain_level: f32,
    ) -> Self {
        Self {
            noise_gate_open_db,
            noise_gate_close_db,
            compressor_threshold_db,
            compressor_ratio,
            auto_gain_level,
            hp_y_prev: 0.0,
            noise_floor_buffer: VecDeque::with_capacity(50),
            noise_floor: -80.0,
            gate_open: false,
            gate_envelope: 0.0,
            frame_buffer: Vec::with_capacity(480), // 10ms at 48kHz
        }
    }
    
    #[inline]
    fn db_to_linear(db: f32) -> f32 {
        10.0_f32.powf(db / 20.0)
    }
    
    #[inline]
    fn process_sample(&mut self, sample: f32) -> f32 {
        // Collect for RMS calculation
        self.frame_buffer.push(sample);
        
        // When we have ~10ms (480 samples), update noise profiler
        if self.frame_buffer.len() >= 480 {
            self.update_noise_floor();
            self.frame_buffer.clear();
        }
        
        // 1. High-pass filter (80Hz)
        let alpha = 0.01047;
        let hp = alpha * (self.hp_y_prev + sample - self.hp_y_prev);
        self.hp_y_prev = hp;
        
        // 2. Noise gate with hysteresis
        let gated = self.noise_gate(hp);
        
        // 3. Compressor
        let compressed = self.apply_compressor(gated);
        
        // 4. Auto-gain
        compressed * self.auto_gain_level
    }
    
    fn update_noise_floor(&mut self) {
        if self.frame_buffer.is_empty() {
            return;
        }
        let sum_sq: f32 = self.frame_buffer.iter().map(|&s| s * s).sum();
        let rms = (sum_sq / self.frame_buffer.len() as f32).sqrt();
        let rms_db = if rms > 0.0 { 20.0 * rms.log10() } else { -100.0 };
        
        self.noise_floor_buffer.push_back(rms_db);
        while self.noise_floor_buffer.len() > 50 {
            self.noise_floor_buffer.pop_front();
        }
        
        let min_in_buffer = self.noise_floor_buffer
            .iter()
            .cloned()
            .fold(0.0_f32, |a, b| a.min(b));
        
        self.noise_floor = (min_in_buffer - 0.1).max(-80.0);
    }
    
    #[inline]
    fn noise_gate(&mut self, sample: f32) -> f32 {
        // Use current noise floor for threshold
        let gate_threshold = self.noise_floor + 15.0;
        
        // Determine gate state
        if !self.gate_open && self.noise_floor > gate_threshold {
            self.gate_open = true;
        } else if self.gate_open && self.noise_floor < gate_threshold - 4.0 {
            self.gate_open = false;
        }
        
        // Smooth envelope
        if self.gate_open {
            self.gate_envelope = (self.gate_envelope + 0.3).min(1.0);
        } else {
            self.gate_envelope = (self.gate_envelope - 0.02).max(0.0);
        }
        
        sample * self.gate_envelope
    }
    
    #[inline]
    fn apply_compressor(&self, sample: f32) -> f32 {
        let abs_sample = sample.abs();
        let threshold_lin = Self::db_to_linear(self.compressor_threshold_db);
        
        if abs_sample < threshold_lin {
            sample
        } else {
            let exceeded = abs_sample - threshold_lin;
            let compressed = threshold_lin + exceeded / self.compressor_ratio;
            sample.signum() * compressed.min(abs_sample)
        }
    }
}

#[derive(serde::Serialize)]
pub struct AudioInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub is_running: bool,
    pub noise_gate_open_db: f32,
    pub noise_gate_close_db: f32,
    pub compressor_threshold_db: f32,
    pub compressor_ratio: f32,
    pub auto_gain: f32,
}