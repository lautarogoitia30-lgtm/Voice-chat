use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use log::{error, info, trace};
use std::collections::VecDeque;
use std::f32::consts::PI;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// Teamspeak-quality audio processor for microphone input.
/// Processing chain:
///   HighPass(80Hz) → Expander(3:1) → NoiseGate(hysteresis) → Compressor(soft-knee 4:1)
///   → PresenceEQ(2.5kHz +3dB) → Deesser(6kHz band) → AGC(adaptivo -12dB target)
///   → AutoGain(2x fixed) → HardLimiter(-1dBFS)
///
/// Each component is tuned for VOICE — not music. Attack/release times, knee widths,
/// and thresholds are calibrated for speech intelligibility and naturalness.
#[derive(Clone, Copy)]
struct LiveSettings {
    noise_gate_open_db: f32,
    noise_gate_close_db: f32,
    compressor_threshold_db: f32,
    compressor_ratio: f32,
}

pub struct AudioProcessor {
    live_settings: Arc<Mutex<LiveSettings>>,
    error_tx: Option<mpsc::UnboundedSender<String>>,
    buffer: Arc<Mutex<VecDeque<f32>>>,
    is_running: bool,
    stop_tx: Option<std::sync::mpsc::Sender<()>>,
    capture_thread: Option<std::thread::JoinHandle<()>>,
    sample_rate: u32,
    channels: u16,

    // Gate
    noise_gate_open_db: f32,
    noise_gate_close_db: f32,

    // Compressor
    compressor_threshold_db: f32,
    compressor_ratio: f32,

    // Legacy fixed auto-gain (final makeup after AGC)
    auto_gain_level: f32,

    // === Teamspeak-quality components ===
    expander_threshold_db: f32,
    expander_ratio: f32,
    presence_eq_gain_db: f32,
    deesser_threshold_db: f32,
    deesser_ratio: f32,
    agc_target_db: f32,

    // Channel for sending processed audio to frontend
    tx: Option<mpsc::Sender<Vec<f32>>>,
}

impl AudioProcessor {
    pub fn new() -> Self {
        Self {
            live_settings: Arc::new(Mutex::new(LiveSettings {
                noise_gate_open_db: -48.0,
                noise_gate_close_db: -52.0,
                compressor_threshold_db: -18.0,
                compressor_ratio: 4.0,
            })),
            error_tx: None,
            buffer: Arc::new(Mutex::new(VecDeque::new())),
            is_running: false,
            stop_tx: None,
            capture_thread: None,
            sample_rate: 48000,
            channels: 1,

            // Gate: open at -48dB, close at -52dB (4dB hysteresis)
            noise_gate_open_db: -48.0,
            noise_gate_close_db: -52.0,

            // Compressor: soft-knee 4:1 at -18dB
            compressor_threshold_db: -18.0,
            compressor_ratio: 4.0,

            // Fixed makeup gain (applied AFTER AGC as final boost)
            auto_gain_level: 2.0,

            // Teamspeak components
            expander_threshold_db: -50.0,
            expander_ratio: 3.0,
            presence_eq_gain_db: 3.0,
            deesser_threshold_db: -25.0,
            deesser_ratio: 4.0,
            agc_target_db: -12.0,

            tx: None,
        }
    }

    pub fn set_audio_callback(&mut self, tx: mpsc::Sender<Vec<f32>>) {
        self.tx = Some(tx);
    }

    pub fn set_error_callback(&mut self, tx: mpsc::UnboundedSender<String>) {
        self.error_tx = Some(tx);
    }

    fn report_runtime_error(tx: &mpsc::UnboundedSender<String>, message: String) {
        error!("Audio input error: {}", message);
        let _ = tx.send(message);
    }

    pub fn start(&mut self) -> Result<(), String> {
        if self.is_running { return Ok(()); }
        let settings = self.get_info();
        let live_settings = self.live_settings.clone();
        let error_tx = self.error_tx.clone();
        let tx = self.tx.clone();
        let buffer = self.buffer.clone();
        let (stop_tx, stop_rx) = std::sync::mpsc::channel();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        // CPAL Stream is !Send on some platforms. Create, retain and drop it
        // on this owner thread; the global controller contains only Send handles.
        let worker = std::thread::spawn(move || {
            let mut capture = AudioProcessor::new();
            capture.noise_gate_open_db = settings.noise_gate_open_db;
            capture.noise_gate_close_db = settings.noise_gate_close_db;
            capture.compressor_threshold_db = settings.compressor_threshold_db;
            capture.compressor_ratio = settings.compressor_ratio;
            capture.auto_gain_level = settings.auto_gain;
            capture.expander_threshold_db = settings.expander_threshold_db;
            capture.expander_ratio = settings.expander_ratio;
            capture.presence_eq_gain_db = settings.presence_eq_gain_db;
            capture.deesser_threshold_db = settings.deesser_threshold_db;
            capture.deesser_ratio = settings.deesser_ratio;
            capture.agc_target_db = settings.agc_target_db;
            capture.tx = tx;
            capture.live_settings = live_settings;
            capture.error_tx = error_tx;
            capture.buffer = buffer;
            match capture.start_capture() {
                Ok(stream) => {
                    if ready_tx.send(Ok((capture.sample_rate, capture.channels))).is_ok() {
                        let _ = stop_rx.recv();
                    }
                    drop(stream);
                }
                Err(error) => { let _ = ready_tx.send(Err(error)); }
            }
        });
        match ready_rx.recv() {
            Ok(Ok((sample_rate, channels))) => {
                self.sample_rate = sample_rate;
                self.channels = channels;
                self.stop_tx = Some(stop_tx);
                self.capture_thread = Some(worker);
                self.is_running = true;
                Ok(())
            }
            result => {
                drop(stop_tx);
                let _ = worker.join();
                self.tx = None;
                self.error_tx = None;
                Err(match result {
                    Ok(Err(error)) => error,
                    _ => "Audio capture thread failed to initialize".to_string(),
                })
            }
        }
    }

    fn start_capture(&mut self) -> Result<cpal::Stream, String> {
        info!("=== Starting Teamspeak-quality audio processor ===");
        info!("  High-pass: 80Hz (rumble removal)");
        info!("  Expander: {}dB threshold, {}:1 ratio", self.expander_threshold_db, self.expander_ratio);
        info!("  Noise gate: open={}dB close={}dB (4dB hysteresis)", self.noise_gate_open_db, self.noise_gate_close_db);
        info!("  Compressor: {}dB threshold, {}:1 ratio, soft-knee", self.compressor_threshold_db, self.compressor_ratio);
        info!("  Presence EQ: 2.5kHz, +{}dB, Q=0.7", self.presence_eq_gain_db);
        info!("  Deesser: {}dB threshold, {}:1 ratio @ 6kHz", self.deesser_threshold_db, self.deesser_ratio);
        info!("  AGC: target {}dB RMS (adaptive)", self.agc_target_db);
        info!("  Auto-gain (final makeup): {}x", self.auto_gain_level);
        info!("  Hard limiter: -1dBFS (prevents clipping)");

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

        let auto_gain_level = self.auto_gain_level;
        let channels = self.channels;
        let mut state = ProcessorState::new(
            self.noise_gate_open_db, self.noise_gate_close_db,
            self.compressor_threshold_db, self.compressor_ratio,
            self.expander_threshold_db, self.expander_ratio,
            self.presence_eq_gain_db, self.deesser_threshold_db,
            self.deesser_ratio, self.agc_target_db, self.sample_rate as f32,
        );
        let live_settings = self.live_settings.clone();
        let error_tx = self.error_tx.clone();
        let err_fn = move |err: cpal::StreamError| {
            if let Some(tx) = &error_tx { Self::report_runtime_error(tx, err.to_string()); }
            else { error!("Audio input error: {}", err); }
        };

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    state.update_live_settings(*live_settings.lock().unwrap());
                    Self::process_f32(data, channels, &mut state,
                        &buffer, tx.as_ref(), auto_gain_level);
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let samples: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                    state.update_live_settings(*live_settings.lock().unwrap());
                    Self::process_f32(&samples, channels, &mut state,
                        &buffer, tx.as_ref(), auto_gain_level);
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

        info!("Audio processor started successfully");
        Ok(stream)
    }

    // ── Callbacks ──────────────────────────────────────────────────────────

    fn process_f32(
        data: &[f32], channels: u16, state: &mut ProcessorState,
        buffer: &Arc<Mutex<VecDeque<f32>>>, tx: Option<&mpsc::Sender<Vec<f32>>>,
        auto_gain_level: f32,
    ) {
        // Device samples are interleaved. Emit mono at the device sample rate.
        let processed: Vec<f32> = data.chunks_exact(channels as usize)
            .map(|frame| {
                let mono = frame.iter().sum::<f32>() / channels as f32;
                (state.process_sample(mono) * auto_gain_level).clamp(-0.891, 0.891)
            }).collect();
        {
            let mut buf = buffer.lock().unwrap();
            buf.extend(processed.iter().copied());
            while buf.len() > 48000 * 2 { buf.pop_front(); }
        }
        // CPAL may deliver callbacks smaller than 480 samples. Never discard them.
        if !processed.is_empty() {
            if let Some(sender) = tx { let _ = sender.try_send(processed); }
        }
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() { let _ = tx.send(()); }
        if let Some(worker) = self.capture_thread.take() { let _ = worker.join(); }
        self.error_tx = None;
        self.tx = None; // closes the event forwarder once capture releases its sender
        self.buffer.lock().unwrap().clear();
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
            expander_threshold_db: self.expander_threshold_db,
            expander_ratio: self.expander_ratio,
            presence_eq_gain_db: self.presence_eq_gain_db,
            deesser_threshold_db: self.deesser_threshold_db,
            deesser_ratio: self.deesser_ratio,
            agc_target_db: self.agc_target_db,
        }
    }

    pub fn set_noise_gate(&mut self, open_db: f32, close_db: f32) {
        self.noise_gate_open_db = open_db;
        self.noise_gate_close_db = close_db;
        let mut settings = self.live_settings.lock().unwrap();
        settings.noise_gate_open_db = open_db;
        settings.noise_gate_close_db = close_db;
        info!("Noise gate set to open={}dB close={}dB", open_db, close_db);
    }

    pub fn set_compressor(&mut self, threshold_db: f32, ratio: f32) {
        self.compressor_threshold_db = threshold_db;
        self.compressor_ratio = ratio;
        let mut settings = self.live_settings.lock().unwrap();
        settings.compressor_threshold_db = threshold_db;
        settings.compressor_ratio = ratio;
        info!("Compressor set to {}dB threshold, {}:1 ratio", threshold_db, ratio);
    }
}

// ── Thread-local processor state ──────────────────────────────────────────

/// Per-thread audio processing state. Created once per audio callback thread.
/// Contains all filter states, envelopes, and coefficients.
struct ProcessorState {
    // Gate & Compressor params
    noise_gate_open_db: f32,
    noise_gate_close_db: f32,
    compressor_threshold_db: f32,
    compressor_ratio: f32,

    // Expander
    expander_threshold_db: f32,
    expander_ratio: f32,
    expander_gain: f32,  // smoothed gain reduction (linear)

    // Noise profiler
    noise_floor_buffer: VecDeque<f32>,
    noise_floor: f32,

    // Gate state
    gate_open: bool,
    gate_envelope: f32,

    // Frame buffer for RMS calculation
    frame_buffer: Vec<f32>,

    // High-pass state
    hp_y_prev: f32,
    hp_x_prev: f32,
    hp_alpha: f32,

    // ── Presence EQ (biquad peaking filter) ──
    // Coefficients (normalized by a0)
    eq_b0: f32, eq_b1: f32, eq_b2: f32,
    eq_a1: f32, eq_a2: f32,
    // Filter state (x[n-1], x[n-2], y[n-1], y[n-2])
    eq_x1: f32, eq_x2: f32,
    eq_y1: f32, eq_y2: f32,

    // ── Deesser (wideband) ──
    // Sidechain bandpass filter at 6kHz
    ds_b0: f32, ds_b1: f32, ds_b2: f32,
    ds_a1: f32, ds_a2: f32,
    ds_x1: f32, ds_x2: f32,
    ds_y1: f32, ds_y2: f32,
    // Gain reduction envelope
    deesser_threshold_db: f32,
    deesser_ratio: f32,
    deesser_gain: f32,  // smoothed gain (linear, 0.0..1.0)
    ds_frame_buf: Vec<f32>,  // accumulate sidechain RMS per frame

    // ── Adaptive AGC ──
    agc_target_db: f32,
    agc_gain_db: f32,  // smoothed gain (dB)
    // Frame counter for AGC update rate
    agc_frame_count: u32,

    // Sample rate
    sample_rate: f32,
}

impl ProcessorState {
    fn update_live_settings(&mut self, settings: LiveSettings) {
        self.noise_gate_open_db = settings.noise_gate_open_db;
        self.noise_gate_close_db = settings.noise_gate_close_db;
        self.compressor_threshold_db = settings.compressor_threshold_db;
        self.compressor_ratio = settings.compressor_ratio;
    }

    fn new(
        noise_gate_open_db: f32, noise_gate_close_db: f32,
        compressor_threshold_db: f32, compressor_ratio: f32,
        expander_threshold_db: f32, expander_ratio: f32,
        presence_eq_gain_db: f32,
        deesser_threshold_db: f32, deesser_ratio: f32,
        agc_target_db: f32, sample_rate: f32,
    ) -> Self {
        // Pre-calculate biquad coefficients for Presence EQ (2.5kHz peaking)
        let (eq_b0, eq_b1, eq_b2, eq_a1, eq_a2) = Self::calc_peaking_coeffs(
            sample_rate, 2500.0, presence_eq_gain_db, 0.7,
        );

        // Pre-calculate biquad coefficients for Deesser sidechain (6kHz bandpass)
        let (ds_b0, ds_b1, ds_b2, ds_a1, ds_a2) = Self::calc_bandpass_coeffs(
            sample_rate, 6000.0, 0.7,
        );

        Self {
            noise_gate_open_db,
            noise_gate_close_db,
            compressor_threshold_db,
            compressor_ratio,
            expander_threshold_db,
            expander_ratio,
            expander_gain: 1.0,
            noise_floor_buffer: VecDeque::with_capacity(50),
            noise_floor: -80.0,
            gate_open: false,
            gate_envelope: 0.0,
            frame_buffer: Vec::with_capacity(480),
            hp_y_prev: 0.0,
            hp_x_prev: 0.0,
            hp_alpha: sample_rate / (sample_rate + 2.0 * PI * 80.0),
            // Presence EQ coeffs
            eq_b0, eq_b1, eq_b2, eq_a1, eq_a2,
            eq_x1: 0.0, eq_x2: 0.0,
            eq_y1: 0.0, eq_y2: 0.0,
            // Deesser coeffs + state
            ds_b0, ds_b1, ds_b2, ds_a1, ds_a2,
            ds_x1: 0.0, ds_x2: 0.0,
            ds_y1: 0.0, ds_y2: 0.0,
            deesser_threshold_db,
            deesser_ratio,
            deesser_gain: 1.0,
            ds_frame_buf: Vec::with_capacity(480),
            // AGC
            agc_target_db,
            agc_gain_db: 0.0,
            agc_frame_count: 0,
            sample_rate,
        }
    }

    // ── Biquad coefficient helpers ─────────────────────────────────────────

    fn calc_peaking_coeffs(fs: f32, f0: f32, gain_db: f32, q: f32) -> (f32, f32, f32, f32, f32) {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let omega = 2.0 * PI * f0 / fs;
        let alpha = omega.sin() / (2.0 * q);
        let cos_w = omega.cos();
        let a0 = 1.0 + alpha / a;
        (
            (1.0 + alpha * a) / a0,  // b0
            (-2.0 * cos_w) / a0,      // b1
            (1.0 - alpha * a) / a0,   // b2
            (-2.0 * cos_w) / a0,      // a1
            (1.0 - alpha / a) / a0,   // a2
        )
    }

    fn calc_bandpass_coeffs(fs: f32, f0: f32, q: f32) -> (f32, f32, f32, f32, f32) {
        let omega = 2.0 * PI * f0 / fs;
        let alpha = omega.sin() / (2.0 * q);
        let cos_w = omega.cos();
        let a0 = 1.0 + alpha;
        (
            alpha / a0,               // b0
            0.0,                       // b1
            (-alpha) / a0,            // b2
            (-2.0 * cos_w) / a0,      // a1
            (1.0 - alpha) / a0,       // a2
        )
    }

    // ── Utility ────────────────────────────────────────────────────────────

    #[inline]
    fn db_to_linear(db: f32) -> f32 {
        10.0_f32.powf(db / 20.0)
    }

    #[inline]
    fn linear_to_db(linear: f32) -> f32 {
        if linear > 0.0 { 20.0 * linear.log10() } else { -100.0 }
    }

    // ── Frame-level processing (called every ~10ms / 480 samples) ──────────

    fn process_frame(&mut self) {
        if self.frame_buffer.is_empty() {
            return;
        }

        let frame_rms_db = {
            let sum_sq: f32 = self.frame_buffer.iter().map(|&s| s * s).sum();
            let rms = (sum_sq / self.frame_buffer.len() as f32).sqrt();
            if rms > 0.0 { 20.0 * rms.log10() } else { -100.0 }
        };

        // 1. Update noise floor (existing)
        self.update_noise_floor(frame_rms_db);

        // 2. Update expander gain
        self.update_expander(frame_rms_db);

        // 3. Update AGC
        self.update_agc(frame_rms_db);

        // 4. Update deesser sidechain
        self.update_deesser();

        self.frame_buffer.clear();
    }

    fn update_noise_floor(&mut self, frame_rms_db: f32) {
        self.noise_floor_buffer.push_back(frame_rms_db);
        while self.noise_floor_buffer.len() > 50 {
            self.noise_floor_buffer.pop_front();
        }
        let min_in_buffer = self.noise_floor_buffer
            .iter()
            .cloned()
            .fold(0.0_f32, |a, b| a.min(b));
        self.noise_floor = (min_in_buffer - 0.1).max(-80.0);
    }

    // ── Expander ───────────────────────────────────────────────────────────

    fn update_expander(&mut self, frame_rms_db: f32) {
        if frame_rms_db > self.expander_threshold_db {
            // Above threshold — smooth back to unity gain
            self.expander_gain += 0.05 * (1.0 - self.expander_gain);
        } else {
            // Below threshold — apply expansion ratio
            let db_below = self.expander_threshold_db - frame_rms_db;
            let reduction_db = db_below * (self.expander_ratio - 1.0);
            let target_gain = Self::db_to_linear(-reduction_db);
            // Smooth toward target
            self.expander_gain += 0.1 * (target_gain - self.expander_gain);
        }
    }

    // ── Deesser ────────────────────────────────────────────────────────────

    fn update_deesser(&mut self) {
        if self.ds_frame_buf.is_empty() {
            return;
        }

        // Measure RMS of sidechain (bandpassed) signal
        let sum_sq: f32 = self.ds_frame_buf.iter().map(|&s| s * s).sum();
        let rms = (sum_sq / self.ds_frame_buf.len() as f32).sqrt();
        let rms_db = if rms > 0.0 { 20.0 * rms.log10() } else { -100.0 };
        self.ds_frame_buf.clear();

        if rms_db > self.deesser_threshold_db {
            // Sibilance detected — reduce gain
            let over = rms_db - self.deesser_threshold_db;
            let gain_db = -over * (1.0 - 1.0 / self.deesser_ratio);
            let target = Self::db_to_linear(gain_db);
            // Fast attack
            self.deesser_gain += 0.5 * (target - self.deesser_gain);
        } else {
            // No sibilance — release smoothly
            self.deesser_gain += 0.05 * (1.0 - self.deesser_gain);
        }
    }

    // ── Adaptive AGC ───────────────────────────────────────────────────────

    fn update_agc(&mut self, frame_rms_db: f32) {
        // Don't react to silence or extremely quiet frames
        if frame_rms_db < -70.0 {
            return;
        }

        // Desired gain to reach target
        let desired_db = (self.agc_target_db - frame_rms_db).clamp(-24.0, 24.0);

        // Smooth with asymmetric attack/release
        // Attack: 50ms, Release: 500ms
        // Frame size = 480 samples, so frame_rate = sample_rate / 480
        let frame_rate = self.sample_rate / 480.0;

        let coeff = if desired_db > self.agc_gain_db {
            // Attack: need to increase gain (someone is speaking quietly)
            1.0 - (-1.0 / (0.050 * frame_rate)).exp()
        } else {
            // Release: need to decrease gain (someone got louder)
            1.0 - (-1.0 / (0.500 * frame_rate)).exp()
        };

        self.agc_gain_db += coeff * (desired_db - self.agc_gain_db);

        // Increment frame counter for logging
        self.agc_frame_count += 1;
        if self.agc_frame_count % 100 == 0 {
            trace!("AGC: frame_rms={:.1}dB, gain={:.1}dB", frame_rms_db, self.agc_gain_db);
        }
    }

    fn get_agc_gain_linear(&self) -> f32 {
        let gain = Self::db_to_linear(self.agc_gain_db);
        gain.clamp(0.5, 8.0)
    }

    // ── Per-sample processing ──────────────────────────────────────────────

    #[inline]
    fn process_sample(&mut self, sample: f32) -> f32 {
        // Collect for frame-level processing (expander, AGC, deesser RMS, noise floor)
        self.frame_buffer.push(sample);
        if self.frame_buffer.len() >= 480 {
            self.process_frame();
        }

        // 1. High-pass filter (80Hz) — removes low rumble
        let hp = self.apply_high_pass(sample);

        // 2. Expander gain reduction (smoothed, applied per sample)
        let expanded = hp * self.expander_gain;

        // 3. Noise gate with hysteresis
        let gated = self.apply_noise_gate(expanded);

        // 4. Compressor with soft knee
        let compressed = self.apply_compressor(gated);

        // 5. Presence EQ (biquad peaking at 2.5kHz)
        let eq_out = self.apply_presence_eq(compressed);

        // 6. Deesser (wideband gain reduction based on sidechain)
        let deessed = eq_out * self.deesser_gain;

        // Run sidechain signal through bandpass filter for deesser RMS
        let ds_sample = self.apply_deesser_sidechain(deessed);
        self.ds_frame_buf.push(ds_sample);

        // 7. Adaptive AGC gain
        let agc_gain = self.get_agc_gain_linear();
        let gained = deessed * agc_gain;

        // 8. Hard limiter (-1dBFS) — final safety net
        gained.clamp(-0.891, 0.891)
    }

    #[inline]
    fn apply_high_pass(&mut self, sample: f32) -> f32 {
        let out = self.hp_alpha * (self.hp_y_prev + sample - self.hp_x_prev);
        self.hp_x_prev = sample;
        self.hp_y_prev = out;
        out
    }

    // ── Individual processing stages ───────────────────────────────────────

    #[inline]
    fn apply_noise_gate(&mut self, sample: f32) -> f32 {
        // Determine gate state (energy-based)
        let rms_db = Self::linear_to_db(sample.abs());
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

    #[inline]
    fn apply_compressor(&self, sample: f32) -> f32 {
        let abs_sample = sample.abs();
        let threshold_lin = Self::db_to_linear(self.compressor_threshold_db);

        if abs_sample < threshold_lin {
            sample
        } else {
            // Soft knee: blend from 1:1 to 4:1 over 6dB
            let exceeded_db = 20.0 * (abs_sample / threshold_lin).log10();
            let knee_end_db = 6.0;

            let ratio = if exceeded_db < knee_end_db {
                let t = (exceeded_db / knee_end_db).clamp(0.0, 1.0);
                1.0 + t * (self.compressor_ratio - 1.0)
            } else {
                self.compressor_ratio
            };

            let exceeded = abs_sample - threshold_lin;
            let compressed = threshold_lin + exceeded / ratio;
            sample.signum() * compressed.min(abs_sample)
        }
    }

    #[inline]
    fn apply_presence_eq(&mut self, sample: f32) -> f32 {
        let out = self.eq_b0 * sample
            + self.eq_b1 * self.eq_x1
            + self.eq_b2 * self.eq_x2
            - self.eq_a1 * self.eq_y1
            - self.eq_a2 * self.eq_y2;

        // Shift state
        self.eq_x2 = self.eq_x1;
        self.eq_x1 = sample;
        self.eq_y2 = self.eq_y1;
        self.eq_y1 = out;

        out
    }

    #[inline]
    fn apply_deesser_sidechain(&mut self, sample: f32) -> f32 {
        // Bandpass filter for sibilance detection
        let out = self.ds_b0 * sample
            + self.ds_b1 * self.ds_x1
            + self.ds_b2 * self.ds_x2
            - self.ds_a1 * self.ds_y1
            - self.ds_a2 * self.ds_y2;

        self.ds_x2 = self.ds_x1;
        self.ds_x1 = sample;
        self.ds_y2 = self.ds_y1;
        self.ds_y1 = out;

        out
    }
}

// ── AudioInfo ──────────────────────────────────────────────────────────────

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
    pub expander_threshold_db: f32,
    pub expander_ratio: f32,
    pub presence_eq_gain_db: f32,
    pub deesser_threshold_db: f32,
    pub deesser_ratio: f32,
    pub agc_target_db: f32,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state(rate: f32) -> ProcessorState {
        ProcessorState::new(-48.0, -52.0, -18.0, 4.0, -50.0, 3.0, 3.0, -25.0, 4.0, -12.0, rate)
    }
    #[test]
    fn high_pass_rejects_dc_and_preserves_speech_at_device_rates() {
        for rate in [44100.0, 48000.0] {
            let mut filter = state(rate);
            let mut dc = 0.0;
            for _ in 0..48000 { dc = filter.apply_high_pass(1.0); }
            assert!(dc.abs() < 0.001);
            let mut filter = state(rate);
            let mut power = 0.0;
            for n in 0..48000 {
                let input = (2.0 * PI * 1000.0 * n as f32 / rate).sin();
                let output = filter.apply_high_pass(input);
                if n >= 24000 { power += output * output; }
            }
            assert!((power / 24000.0).sqrt() > 0.65);
        }
    }
    #[test]
    fn short_stereo_callbacks_are_downmixed_and_forwarded() {
        let (tx, mut rx) = mpsc::channel(2);
        let buffer = Arc::new(Mutex::new(VecDeque::new()));
        AudioProcessor::process_f32(&[0.5, -0.5, 0.25, -0.25], 2, &mut state(44100.0), &buffer, Some(&tx), 1.0);
        let samples = rx.try_recv().unwrap();
        assert_eq!(samples, vec![0.0, 0.0]);
    }
    #[test]
    fn active_configuration_updates_existing_callback_state() {
        let mut processor = AudioProcessor::new();
        let shared = processor.live_settings.clone();
        let mut callback_state = state(48000.0);
        processor.set_noise_gate(-35.0, -39.0);
        processor.set_compressor(-12.0, 2.0);
        callback_state.update_live_settings(*shared.lock().unwrap());
        assert_eq!(callback_state.noise_gate_open_db, -35.0);
        assert_eq!(callback_state.noise_gate_close_db, -39.0);
        assert_eq!(callback_state.compressor_threshold_db, -12.0);
        assert_eq!(callback_state.compressor_ratio, 2.0);
    }
    #[test]
    fn runtime_capture_errors_reach_error_forwarder() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        AudioProcessor::report_runtime_error(&tx, "device disconnected".to_string());
        assert_eq!(rx.try_recv().unwrap(), "device disconnected");
    }

}
