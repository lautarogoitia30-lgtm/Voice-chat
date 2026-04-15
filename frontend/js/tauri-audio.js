/**
 * Tauri Audio Bridge - Conecta audio procesado de Rust con LiveKit
 * Recibe audio procesado de Rust y lo publica como track en LiveKit
 */

class TauriAudioBridge {
    constructor() {
        this.audioContext = null;
        this.isRunning = false;
        this.sampleRate = 48000;
        this.channels = 1;
        this.livekitClient = null;
        
        // Audio buffer for continuous stream
        this.audioBuffer = new Float32Array(0);
        this.bufferCapacity = 48000 * 2; // 2 seconds max
        
        // MediaStream for LiveKit
        this.mediaStream = null;
        
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
            
            // Create MediaStream with a hidden audio element that feeds continuous audio
            // This is the proper way to create a stream for LiveKit
            this.mediaStream = new MediaStream();
            
            // Create an AudioElement and connect its capture stream
            this.audioElement = document.createElement('audio');
            this.audioElement.autoplay = true;
            this.audioElement.muted = true;
            this.audioElement.style.display = 'none';
            document.body.appendChild(this.audioElement);
            
            // Use MediaStreamDestination for capturing
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
     * Uses AudioWorklet or ScriptProcessor for continuous audio
     */
    processAudioData(pcmData) {
        if (!this.audioContext || !this.mediaDest) return;
        
        try {
            // Resume audio context if suspended
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
                floatSamples[i] = signed > 32767 ? (signed - 65536) / 32768 : signed / 32768;
            }
            
            // Create buffer source and play immediately
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
            // Silent to avoid console spam
        }
    }
    
    /**
     * Get the processed audio stream for LiveKit publishing
     */
    getProcessedStream() {
        if (!this.mediaDest) {
            console.warn('[TauriAudio] No media destination');
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
            
            // Import LiveKit client
            const { LocalAudioTrack, Track } = await import('livekit-client');
            
            // Create LiveKit audio track from our processed stream
            const localAudioTrack = new LocalAudioTrack(audioTrack, {
                name: 'processed-audio',
            });
            
            // Get local participant
            const lp = this.livekitClient.localParticipant;
            
            // Unpublish existing mic track
            const existingPubs = lp.trackPublications.values();
            for (const pub of existingPubs) {
                if (pub.source === Track.Source.Microphone) {
                    await lp.unpublishTrack(pub.track);
                }
            }
            
            // Publish our processed track
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
            
            // Remove audio element
            if (this.audioElement && this.audioElement.parentNode) {
                this.audioElement.parentNode.removeChild(this.audioElement);
            }
            
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