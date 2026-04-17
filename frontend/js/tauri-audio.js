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
        
        // Audio buffer
        this.audioBuffer = new Float32Array(0);
        
        // MediaStream for LiveKit
        this.mediaStream = null;
        
        // Check if running in Tauri
        this.isTauri = typeof window.__TAURI__ !== 'undefined';
    }
    
    /**
     * Initialize - check Tauri availability
     */
    async init() {
        console.log('[TauriAudio] init() called, isTauri:', this.isTauri);
        
        if (!this.isTauri) {
            console.log('[TauriAudio] Not in Tauri - using browser LiveKit native');
            return false;
        }
        
        try {
            const tauri = await import('@tauri-apps/api/core');
            const { listen } = await import('@tauri-apps/api/event');
            this.tauri = tauri;
            this.listenFn = listen;
            console.log('[TauriAudio] ✅ Tauri API ready');
            return true;
        } catch (e) {
            console.error('[TauriAudio] Tauri not available:', e);
            return false;
        }
    }
    
    /**
     * Set the LiveKit client
     */
    setLiveKitClient(client) {
        this.livekitClient = client;
        console.log('[TauriAudio] LiveKit client connected');
    }
    
    /**
     * Start the audio pipeline
     */
    async start() {
        console.log('[TauriAudio] start() called, isRunning:', this.isRunning, 'isTauri:', this.isTauri);
        
        if (this.isRunning) {
            console.log('[TauriAudio] Already running');
            return;
        }
        
        if (!this.isTauri) {
            console.log('[TauriAudio] Browser mode - use LiveKit native mic');
            return;
        }
        
        try {
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.sampleRate,
            });
            
            console.log('[TauriAudio] AudioContext created, state:', this.audioContext.state);
            
            // Create MediaStreamDestination
            this.mediaDest = this.audioContext.createMediaStreamDestination();
            this.mediaDest.channelCount = this.channels;
            console.log('[TauriAudio] MediaStreamDestination created');
            console.log('[TauriAudio] Stream tracks:', this.mediaDest.stream.getAudioTracks().length);
            
            // Start listening to audio events from Rust
            this.audioListener = await this.listenFn('audio-data', (event) => {
                this.processAudioData(event.payload);
            });
            
            console.log('[TauriAudio] Listener registered');
            
            // Start audio processor in Rust
            const result = await this.tauri.invoke('start_audio_processor');
            console.log('[TauriAudio] Rust start result:', result);
            
            this.isRunning = true;
            console.log('[TauriAudio] ✅ Started - audio pipeline active');
            
            return true;
        } catch (e) {
            console.error('[TauriAudio] Failed to start:', e);
            return false;
        }
    }
    
    /**
     * Process incoming PCM audio data from Rust
     */
    processAudioData(pcmData) {
        if (!this.audioContext || !this.mediaDest) {
            console.log('[TauriAudio] processAudioData: no audioContext or mediaDest');
            return;
        }
        
        try {
            // Resume audio context if suspended
            if (this.audioContext.state === 'suspended') {
                console.log('[TauriAudio] Resuming audio context');
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
            
            // Create buffer source and connect to media destination
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
            console.error('[TauriAudio] processAudioData error:', e);
        }
    }
    
    /**
     * Get the processed audio stream
     */
    getProcessedStream() {
        if (!this.mediaDest) {
            console.warn('[TauriAudio] No media destination');
            return null;
        }
        const stream = this.mediaDest.stream;
        console.log('[TauriAudio] getProcessedStream, tracks:', stream.getAudioTracks().length);
        return stream;
    }
    
    /**
     * Publish processed audio to LiveKit
     */
    async publishToLiveKit() {
        console.log('[TauriAudio] publishToLiveKit() called');
        
        if (!this.livekitClient || !this.mediaDest) {
            console.error('[TauriAudio] No LiveKit client or no media destination');
            return false;
        }
        
        try {
            const stream = this.mediaDest.stream;
            const tracks = stream.getAudioTracks();
            console.log('[TauriAudio] Stream has', tracks.length, 'audio tracks');
            
            if (tracks.length === 0) {
                console.error('[TauriAudio] No audio tracks in stream');
                return false;
            }
            
            const audioTrack = tracks[0];
            console.log('[TauriAudio] Using track:', audioTrack.label);
            
            // Create LiveKit audio track
            const { LocalAudioTrack, Track } = await import('livekit-client');
            
            const localAudioTrack = new LocalAudioTrack(audioTrack, {
                name: 'processed-audio',
            });
            
            // Get local participant
            const lp = this.livekitClient.localParticipant;
            console.log('[TauriAudio] Local participant:', lp.identity);
            
            // Unpublish existing mic track
            const existingPubs = lp.trackPublications.values();
            for (const pub of existingPubs) {
                if (pub.source === Track.Source.Microphone) {
                    console.log('[TauriAudio] Unpublishing existing mic track');
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
console.log('[TauriAudio] Bridge instance created');

// Auto-init when module loads
(async () => {
    console.log('[TauriAudio] Auto-init running');
    await window.tauriAudioBridge.init();
})();