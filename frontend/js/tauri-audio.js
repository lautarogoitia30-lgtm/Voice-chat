/**
 * Tauri Audio Bridge - Conecta audio procesado de Rust con LiveKit
 * Recibe audio procesado de Tauri y lo publica como track en LiveKit
 */

class TauriAudioBridge {
    constructor() {
        this.audioContext = null;
        this.isRunning = false;
        this.sampleRate = 48000;
        this.channels = 1;
        this.livekitClient = null;
        this.lastProcessTime = 0;
        
        // Audio buffer for smooth playback
        this.audioBuffer = [];
        this.bufferSize = 480; // 10ms at 48kHz
        
        // Check if running in Tauri
        this.isTauri = typeof window.__TAURI__ !== 'undefined';
    }
    
    /**
     * Initialize - check Tauri availability
     */
    async init() {
        if (!this.isTauri) {
            console.log('[TauriAudio] Not in Tauri - using browser LiveKit native');
            return false;
        }
        
        try {
            const tauri = await import('@tauri-apps/api/core');
            this.tauri = tauri;
            console.log('[TauriAudio] ✅ Tauri API ready');
            return true;
        } catch (e) {
            console.warn('[TauriAudio] Tauri not available:', e);
            return false;
        }
    }
    
    /**
     * Set the LiveKit client to use for publishing
     */
    setLiveKitClient(client) {
        this.livekitClient = client;
        console.log('[TauriAudio] LiveKit client connected');
    }
    
    /**
     * Start the audio pipeline - capture from Rust, process, publish to LiveKit
     */
    async start() {
        if (this.isRunning) {
            console.log('[TauriAudio] Already running');
            return;
        }
        
        if (!this.isTauri) {
            console.log('[TauriAudio] Browser mode - use LiveKit native mic');
            return;
        }
        
        try {
            // Create audio context for processing
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.sampleRate,
            });
            
            // Create MediaStreamDestination for LiveKit track
            this.mediaDest = this.audioContext.createMediaStreamDestination();
            this.mediaDest.channelCount = this.channels;
            
            // Start listening to audio events from Rust
            const { listen } = await import('@tauri-apps/api/event');
            
            this.audioListener = await listen('audio-data', (event) => {
                this.processAudioData(event.payload);
            });
            
            // Start audio processor in Rust
            await this.tauri.invoke('start_audio_processor');
            
            this.isRunning = true;
            console.log('[TauriAudio] ✅ Started - audio pipeline active');
            
            return true;
        } catch (e) {
            console.error('[TauriAudio] Failed to start:', e);
            return false;
        }
    }
    
    /**
     * Process incoming PCM audio data from Rust and feed to LiveKit
     */
    processAudioData(pcmData) {
        if (!this.audioContext) return;
        
        try {
            // Resume audio context if suspended (needed after user gesture)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            
            // Convert PCM 16-bit to Float32
            const numSamples = Math.floor(pcmData.length / 2);
            const floatSamples = new Float32Array(numSamples);
            
            for (let i = 0; i < numSamples; i++) {
                const low = pcmData[i * 2];
                const high = pcmData[i * 2 + 1];
                const signed = (high << 8) | low;
                // Convert to float -1 to 1
                floatSamples[i] = signed > 32767 ? (signed - 65536) / 32768 : signed / 32768;
            }
            
            // Add to buffer
            this.audioBuffer.push(...floatSamples);
            
            // Keep buffer manageable
            while (this.audioBuffer.length > this.sampleRate * 2) {
                this.audioBuffer.shift();
            }
            
            // Create a buffer source and connect to media destination
            const buffer = this.audioContext.createBuffer(
                this.channels,
                floatSamples.length,
                this.sampleRate
            );
            buffer.copyToChannel(floatSamples, 0);
            
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.mediaDest);
            source.start();
            
        } catch (e) {
            // Silently handle errors to avoid flooding console
        }
    }
    
    /**
     * Get the processed audio stream for LiveKit publishing
     */
    getProcessedStream() {
        if (!this.mediaDest) {
            console.warn('[TauriAudio] No media destination - start() not called');
            return null;
        }
        return this.mediaDest.stream;
    }
    
    /**
     * Publish processed audio to LiveKit (replaces native mic)
     */
    async publishToLiveKit() {
        if (!this.livekitClient || !this.mediaDest) {
            console.warn('[TauriAudio] No LiveKit client or no audio stream');
            return false;
        }
        
        try {
            const stream = this.mediaDest.stream;
            const audioTrack = stream.getAudioTracks()[0];
            
            if (!audioTrack) {
                console.error('[TauriAudio] No audio track in stream');
                return false;
            }
            
            // Import LiveKit
            const livekit = await import('https://cdn.jsdelivr.net/npm/livekit-client@2/+esm');
            const { Track } = livekit;
            
            // Create LiveKit audio track from our processed stream
            const localAudioTrack = new livekit.LocalAudioTrack(audioTrack, {
                source: Track.Source.Microphone,
            });
            
            // Unpublish native mic if exists and publish our processed track
            const lp = this.livekitClient.localParticipant;
            
            // Get existing mic track
            const existingPub = lp.getTrackPublication(Track.Source.Microphone);
            if (existingPub) {
                await lp.unpublishTrack(existingPub.track);
            }
            
            // Publish processed track
            await lp.publishTrack(localAudioTrack, {
                source: Track.Source.Microphone,
            });
            
            console.log('[TauriAudio] ✅ Published processed audio to LiveKit');
            return true;
        } catch (e) {
            console.error('[TauriAudio] Failed to publish:', e);
            return false;
        }
    }
    
    /**
     * Stop the audio pipeline
     */
    async stop() {
        if (!this.isRunning) return;
        
        try {
            // Stop listening
            if (this.audioListener) {
                this.audioListener();
            }
            
            // Stop Rust processor
            if (this.isTauri) {
                await this.tauri.invoke('stop_audio_processor');
            }
            
            // Close audio context
            if (this.audioContext) {
                await this.audioContext.close();
            }
            
            this.audioBuffer = [];
            this.isRunning = false;
            console.log('[TauriAudio] Stopped');
        } catch (e) {
            console.error('[TauriAudio] Error stopping:', e);
        }
    }
    
    /**
     * Configure audio processing parameters
     */
    async setNoiseGate(db) {
        if (this.isTauri) {
            await this.tauri.invoke('set_noise_gate', { db });
        }
    }
    
    async setCompressor(thresholdDb, ratio) {
        if (this.isTauri) {
            await this.tauri.invoke('set_compressor', { thresholdDb, ratio });
        }
    }
    
    /**
     * Get audio info from Rust
     */
    async getInfo() {
        if (this.isTauri) {
            return await this.tauri.invoke('get_audio_info');
        }
        return null;
    }
}

// Singleton instance
window.tauriAudioBridge = new TauriAudioBridge();
console.log('[TauriAudio] Bridge initialized');

// Auto-init when module loads
(async () => {
    await window.tauriAudioBridge.init();
})();