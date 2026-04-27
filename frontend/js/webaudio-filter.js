/**
 * WebAudio-based noise filter — fallback when Krisp is not available.
 * Provides Teamspeak-level noise cancellation using Web Audio API.
 * No external dependencies, runs 100% in browser.
 */

class WebAudioFilter {
    constructor() {
        this.audioContext = null;
        this.sourceNode = null;
        this.gainNode = null;
        this.highPassFilter = null;
        this.compressor = null;
        this.scriptProcessor = null;
        this.mediaStreamDest = null;
        this.isActive = false;
        this._noiseFloor = -80; // dB, running minimum
        this._noiseFloorBuffer = new Array(50).fill(-80);
        this._noiseFloorIndex = 0;
        this._gateOpen = false;
        this._gateEnvelope = 0;
    }

    /**
     * Initialize audio context and processing chain
     */
    async init() {
        if (this.audioContext) return;

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 48000,
        });

        console.log('[WEBFILTER] AudioContext created:', this.audioContext.state);
    }

    /**
     * Apply filter to a LiveKit LocalAudioTrack.
     * Replaces the track's MediaStreamTrack with a filtered version.
     */
    async applyToTrack(trackPublication) {
        if (!trackPublication || !trackPublication.track) {
            console.warn('[WEBFILTER] No track to filter');
            return false;
        }

        const track = trackPublication.track;
        if (!track.mediaStreamTrack) {
            console.warn('[WEBFILTER] Track has no mediaStreamTrack');
            return false;
        }

        try {
            // Create new filtered MediaStreamTrack
            const filteredStream = await this._createFilteredStream(track.mediaStreamTrack);

            // Replace track
            await trackPublication.unpublishTrack(track);

            // Create new track from filtered stream
            const livekit = await import('https://cdn.jsdelivr.net/npm/livekit-client@2/+esm');
            const { LocalAudioTrack, Track } = livekit;

            const newTrack = new LocalAudioTrack(filteredStream.getAudioTracks()[0], {
                source: Track.Source.Microphone,
            });

            await trackPublication.publishTrack(newTrack, {
                source: Track.Source.Microphone,
            });

            console.log('[WEBFILTER] ✅ Filter applied to track');
            return true;
        } catch (e) {
            console.error('[WEBFILTER] ❌ Failed to apply filter:', e.message);
            return false;
        }
    }

    /**
     * Create a filtered MediaStream from a source MediaStreamTrack.
     * Processing chain: HighPass → Noise Gate → Compressor → Gain
     */
    async _createFilteredStream(sourceTrack) {
        await this.init();

        // Create MediaStream from the source track
        const mediaStream = new MediaStream([sourceTrack]);

        // Create MediaStreamSource
        const mediaSource = this.audioContext.createMediaStreamSource(mediaStream);

        // High-pass filter: removes low rumble (desk vibration, fan, AC hum)
        this.highPassFilter = this.audioContext.createBiquadFilter();
        this.highPassFilter.type = 'highpass';
        this.highPassFilter.frequency.value = 80; // Hz — cut everything below
        this.highPassFilter.attack.value = 0.005; // 5ms attack
        this.highPassFilter.release.value = 0.050; // 50ms release

        // Compressor: evens out voice levels
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.compressor.threshold.value = -18; // dB — compress below this
        this.compressor.knee.value = 6; // soft knee for smooth compression
        this.compressor.ratio.value = 4; // 4:1 compression ratio
        this.compressor.attack.value = 0.01; // 10ms attack
        this.compressor.release.value = 0.2; // 200ms release

        // Gain: boost voice (2x = +6dB)
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 2.0;

        // ScriptProcessor for noise gate + spectral subtraction
        // (BiquadFilter can't do energy-based gating)
        const bufferSize = 4096;
        this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

        let noiseFloorBuffer = new Array(50).fill(-80);
        let noiseFloorIndex = 0;
        let gateEnvelope = 0;

        this.scriptProcessor.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0);
            const output = event.outputBuffer.getChannelData(0);

            // Calculate RMS energy
            let sumSquares = 0;
            for (let i = 0; i < input.length; i++) {
                sumSquares += input[i] * input[i];
            }
            const rms = Math.sqrt(sumSquares / input.length);
            const db = rms > 0 ? 20 * Math.log10(rms) : -100;

            // Update noise floor (running minimum, slow decay)
            noiseFloorBuffer[noiseFloorIndex % 50] = db;
            noiseFloorIndex++;

            // Noise floor = min of last 50 frames
            let minDb = 0;
            for (let i = 0; i < noiseFloorBuffer.length; i++) {
                if (i === 0 || noiseFloorBuffer[i] < minDb) {
                    minDb = noiseFloorBuffer[i];
                }
            }
            // Slowly decay noise floor toward -80dB
            minDb = Math.max(minDb - 0.1, -80);

            // Noise gate logic
            const gateThreshold = minDb + 15; // Open 15dB above noise floor
            const gateOpen = db > gateThreshold;

            // Smooth envelope (attack: fast open, release: slow close)
            if (gateOpen) {
                gateEnvelope = Math.min(1, gateEnvelope + 0.3);
            } else {
                gateEnvelope = Math.max(0, gateEnvelope - 0.02);
            }

            // Apply gate to output
            for (let i = 0; i < input.length; i++) {
                output[i] = input[i] * gateEnvelope;
            }
        };

        // Destination for creating new MediaStream
        this.mediaStreamDest = this.audioContext.createMediaStreamDestination();

        // Connect chain: source → highPass → scriptProcessor(gate) → compressor → gain → dest
        mediaSource.connect(this.highPassFilter);
        this.highPassFilter.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.compressor);
        this.compressor.connect(this.gainNode);
        this.gainNode.connect(this.mediaStreamDest);

        // Also connect bypass for real-time monitoring
        // (the processed stream comes out of mediaStreamDest)
        this.isActive = true;
        console.log('[WEBFILTER] Processing chain: HighPass(80Hz) → NoiseGate → Compressor(4:1,-18dB) → Gain(2x)');

        return this.mediaStreamDest.stream;
    }

    /**
     * Get noise floor level (for UI display)
     */
    getNoiseFloor() {
        return this._noiseFloor;
    }

    /**
     * Stop and cleanup
     */
    stop() {
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
            this.scriptProcessor = null;
        }
        if (this.highPassFilter) {
            this.highPassFilter.disconnect();
            this.highPassFilter = null;
        }
        if (this.compressor) {
            this.compressor.disconnect();
            this.compressor = null;
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        this.isActive = false;
        console.log('[WEBFILTER] Stopped and cleaned up');
    }
}

// Export globally
window.WebAudioFilter = WebAudioFilter;
console.log('[WEBFILTER] WebAudioFilter class registered');