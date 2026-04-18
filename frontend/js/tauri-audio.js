/**
 * Tauri Audio Bridge - Conecta audio procesado de Rust con LiveKit
 * Recibe audio procesado de Rust y lo publica como track en LiveKit
 */

alert('🎵 Tauri-audio.js CARGANDO...');

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
        
        // Tauri APIs (set in init)
        this.isTauri = false;
        this.tauri = null;
        this.listenFn = null;
    }
    
    /**
     * Initialize - try to load Tauri APIs
     */
    async init() {
        alert('[TauriAudio] Intentando cargar Tauri...');
        
        // Check if Tauri API is available globally (loaded from script)
        alert('🔍 Buscando window.tauri...');
        if (window.tauri) {
            alert('✅ window.tauri ENCONTRADO!');
            this.tauri = window.tauri;
            this.listenFn = window.tauri.listen;
            this.isTauri = true;
            alert('✅ Tauri detectado correctamente! API lista');
            console.log('[TauriAudio] ✅ Tauri API ready');
            return true;
        } else {
            alert('❌ window.tauri NO ENCONTRADO!');
        }
        
        // Fallback: try dynamic import
        try {
            this.tauri = await import('@tauri-apps/api/core');
            const eventModule = await import('@tauri-apps/api/event');
            this.listenFn = eventModule.listen;
            
            this.isTauri = true;
            alert('✅ Tauri detectado correctamente! API lista');
            console.log('[TauriAudio] ✅ Tauri API ready');
            return true;
        } catch (e) {
            alert('❌ Tauri no disponible: ' + e.message);
            console.log('[TauriAudio] Tauri not available:', e);
            this.isTauri = false;
            return false;
        }
    }
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
        alert('[TauriAudio] start() llamado, isTauri: ' + this.isTauri);
        
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
            
            alert('[TauriAudio] AudioContext creado');
            
            // Create MediaStreamDestination
            this.mediaDest = this.audioContext.createMediaStreamDestination();
            this.mediaDest.channelCount = this.channels;
            alert('[TauriAudio] MediaStreamDestination creado');
            
            // Start listening to audio events from Rust
            this.audioListener = await this.listenFn('audio-data', (event) => {
                this.processAudioData(event.payload);
            });
            
            alert('[TauriAudio] Listener registrado');
            
            // Start audio processor in Rust
            const result = await this.tauri.invoke('start_audio_processor');
            alert('[TauriAudio] Rust iniciado: ' + result);
            
            this.isRunning = true;
            alert('[TauriAudio] ✅ Audio pipeline ACTIVO!');
            
            return true;
        } catch (e) {
            alert('[TauriAudio] Error: ' + e.message);
            console.error('[TauriAudio] Failed to start:', e);
            return false;
        }
    }
    
    /**
     * Process incoming PCM audio data from Rust
     */
    processAudioData(pcmData) {
        if (!this.audioContext || !this.mediaDest) {
            return;
        }
        
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
            
            if (tracks.length === 0) {
                console.error('[TauriAudio] No audio tracks in stream');
                return false;
            }
            
            const audioTrack = tracks[0];
            
            // Create LiveKit audio track
            const { LocalAudioTrack, Track } = await import('livekit-client');
            
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
            
            alert('[TauriAudio] ✅ Audio procesado publicado en LiveKit!');
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
            if (this.audioListener) {
                this.audioListener();
            }
            
            if (this.isTauri) {
                await this.tauri.invoke('stop_audio_processor');
            }
            
            if (this.audioContext) {
                await this.audioContext.close();
            }
            
            this.isRunning = false;
            alert('[TauriAudio] Detenido');
        } catch (e) {
            console.error('[TauriAudio] Error stopping:', e);
        }
    }
}

// Singleton instance
window.tauriAudioBridge = new TauriAudioBridge();
console.log('[TauriAudio] Bridge instance created');
alert('[TauriAudio] Instancia creada');

// Auto-init when module loads
(async () => {
    console.log('[TauriAudio] Auto-init running');
    await window.tauriAudioBridge.init();
})();