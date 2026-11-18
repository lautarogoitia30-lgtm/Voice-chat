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
        
        // Tauri APIs (set in init)
        this.isTauri = false;
        this.tauri = null;
        this.listenFn = null;
    }
    
/**
 * Initialize Tauri audio - runs early to set up audio pipeline
 */
async init() {
    console.log('[TauriAudio] init() called');
    
    const api = window.__TAURI__ || window.tauri;
    const invoke = api?.core?.invoke || api?.tauri?.invoke || api?.invoke;
    const listen = api?.event?.listen || api?.listen;
    if (typeof invoke === 'function' && typeof listen === 'function') {
        this.tauri = { invoke };
        this.listenFn = listen;
        this.isTauri = true;
        return true;
    }

    // NO Tauri - use Web Audio only
    console.log('[TauriAudio] No Tauri, using Web Audio fallback');
    this.isTauri = false;
    return false;
}
    
/**
 * Set the LiveKit client
 */
setLiveKitClient(client) {
    this.livekitClient = client;
    if (this.outputGain) this.outputGain.gain.value = (client._micVolume ?? 100) / 100;
    console.log('[TauriAudio] LiveKit client connected');
}

/**
 * Start the audio pipeline
 */
async start() {
    console.log('[TauriAudio] start() called, isTauri:', this.isTauri);
    if (this.stopping) await this.stopping;
    
    if (this.isRunning) {
        console.log('[TauriAudio] Already running');
        return true;
    }
    
    if (!this.isTauri) {
        console.log('[TauriAudio] Browser mode - use LiveKit native mic');
        return false;
    }
    
    const selectedDevice = localStorage.getItem('voice_chat_input_device');
    if (selectedDevice && selectedDevice !== 'default') {
        // Browser IDs are opaque; let the browser honor this exact selection.
        return false;
    }

    try {
        this.startupError = null;
        // Create audio context
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: this.sampleRate,
        });
        
        // Create MediaStreamDestination
        this.mediaDest = this.audioContext.createMediaStreamDestination();
        this.mediaDest.channelCount = this.channels;
        this.outputGain = this.audioContext.createGain();
        this.outputGain.gain.value = (this.livekitClient?._micVolume ?? 100) / 100;
        this.outputGain.connect(this.mediaDest);
        
        // Start listening to audio events from Rust
        this.audioListener = await this.listenFn('audio-data', (event) => {
            this.processAudioData(event.payload);
        });
        
        this.errorListener = await this.listenFn('audio-error', (event) => {
            if (!this.isRunning) { this.startupError = event.payload; return; }
            if (!this.recovery) {
                this.recovery = this.handleRuntimeError(event.payload).finally(() => { this.recovery = null; });
            }
        });

        // Start audio processor in Rust
        const result = await this.tauri.invoke('start_audio_processor');
        console.log('[TauriAudio] Rust started:', result);
        
        const info = await this.tauri.invoke('get_audio_info');
        if (!Number.isFinite(info?.sample_rate) || info.sample_rate <= 0) throw new Error('Invalid capture sample rate');
        this.sampleRate = info.sample_rate;
        this.nextPlayTime = 0;
        await this.audioContext.resume();
        if (this.startupError) throw new Error(this.startupError);
        this.isRunning = true;
        return true;
    } catch (e) {
        console.error('[TauriAudio] Failed to start:', e);
        await this.stop();
        return false;
    }
}

async handleRuntimeError(message) {
    const client = this.livekitClient;
    await this.stop();
    if (!client?.room || client.room.state !== 'connected') return;
    try {
        await client.publishMicrophone();
    } catch (error) {
        console.error('[TauriAudio] Microphone recovery failed:', message, error);
        window.dispatchEvent(new CustomEvent('voice-audio-error', {
            detail: 'Se desconectó el micrófono. Revisá el dispositivo de entrada y volvé a unirte a la llamada.',
        }));
    }
}

/**
 * Process incoming PCM audio data from Rust
 */
processAudioData(pcmData) {
    if (!this.isRunning || !this.audioContext || !this.mediaDest) {
        return;
    }
    
    try {
        // Resume audio context if suspended
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        // Convert PCM 16-bit to Float32
        const numSamples = Math.floor(pcmData.length / 2);
        if (!numSamples) return;
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
        source.connect(this.outputGain);
        // Preserve chunk order; a late event resets the queue to current time.
        const startTime = Math.max(this.audioContext.currentTime, this.nextPlayTime || 0);
        source.onended = () => source.disconnect();
        source.start(startTime);
        this.nextPlayTime = startTime + buffer.duration;
        
    } catch (e) {
        console.error('[TauriAudio] processAudioData error:', e);
    }
}

/**
 * Publish processed audio to LiveKit
 */
async publishToLiveKit() {
    console.log('[TauriAudio] publishToLiveKit() called');
    if (this.publication?.track) return true;
    
    if (!this.isRunning || !this.livekitClient || !this.mediaDest) {
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
        const { LocalAudioTrack, Track } = await _getLiveKitModule();
        
        const localAudioTrack = new LocalAudioTrack(audioTrack, {
            name: 'processed-audio',
        });
        
        if (this.livekitClient._isMuted) await localAudioTrack.mute();

        // Get local participant
        const lp = this.livekitClient.localParticipant;
        
        // Unpublish existing mic track
        const existingPubs = Array.from(lp.trackPublications.values());
        for (const pub of existingPubs) {
            if (pub.source === Track.Source.Microphone) {
                await lp.unpublishTrack(pub.track);
            }
        }
        
        // Publish our processed track
        this.localAudioTrack = localAudioTrack;
        this.publishedParticipant = lp;
        const publication = await lp.publishTrack(localAudioTrack, {
            source: Track.Source.Microphone,
        });
        
        if (!publication?.track) throw new Error('Processed microphone was not published');
        this.publication = publication;
        console.log('[TauriAudio] Audio procesado publicado en LiveKit!');
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
    if (this.stopping) return this.stopping;
    this.stopping = this.cleanup();
    try { await this.stopping; } finally { this.stopping = null; }
}

async cleanup() {
    this.isRunning = false;
    const cleanup = async (action) => {
        try { await action(); } catch (e) { console.warn('[TauriAudio] Cleanup failed:', e); }
    };
    if (this.audioListener) await cleanup(() => this.audioListener());
    this.audioListener = null;
    if (this.errorListener) await cleanup(() => this.errorListener());
    this.errorListener = null;
    if (this.localAudioTrack && this.publishedParticipant) {
        await cleanup(() => this.publishedParticipant.unpublishTrack(this.localAudioTrack));
        await cleanup(() => this.localAudioTrack.stop());
    }
    this.localAudioTrack = null;
    this.publication = null;
    this.publishedParticipant = null;
    if (this.isTauri) await cleanup(() => this.tauri.invoke('stop_audio_processor'));
    if (this.mediaDest) {
        for (const track of this.mediaDest.stream.getTracks()) await cleanup(() => track.stop());
    }
    if (this.audioContext) await cleanup(() => this.audioContext.close());
    this.audioContext = null;
    this.mediaDest = null;
    this.outputGain = null;
    this.nextPlayTime = 0;
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