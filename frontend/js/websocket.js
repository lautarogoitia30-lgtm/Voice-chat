/**
 * WebSocket client for real-time text chat.
 * Handles connections, messages, and disconnection.
 */

// Get the HTTP base from api.js and convert to WebSocket base
const HTTP_BASE = window.API_BASE || 'http://localhost:3000';
const WS_BASE = HTTP_BASE.replace('http://', 'ws://').replace('https://', 'wss://');

class WebSocketClient {
    constructor() {
        this.ws = null;
        this.channelId = null;
        this.onMessage = null;
        this.onConnect = null;
        this.onDisconnect = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }
    
    /**
     * Connect to a chat channel
     */
    connect(channelId) {
        // Disconnect from previous channel if any
        this.disconnect();
        
        this.channelId = channelId;
        
        // Get token from localStorage
        const token = localStorage.getItem('voice_chat_token') || '';
        console.log('[WS] Token from localStorage:', token ? 'present' : 'missing', 'length:', token.length);
        
        // Build WebSocket URL with token
        const wsUrl = `${WS_BASE}/ws/chat/${channelId}?token=${encodeURIComponent(token)}`;
        console.log('WebSocket URL:', wsUrl);
        
        console.log(`Connecting to WebSocket: ${wsUrl}`);
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected, token present:', token ? 'yes' : 'no');
            this.reconnectAttempts = 0;
            if (this.onConnect) {
                this.onConnect();
            }
        };
        
        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (this.onMessage) {
                    this.onMessage(message);
                }
            } catch (e) {
                console.error('Failed to parse message:', e);
            }
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            if (this.onDisconnect) {
                this.onDisconnect();
            }
            
            // Attempt reconnection
            this.attemptReconnect();
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            console.log('WebSocket readyState:', this.ws?.readyState);
        };
    }
    
    /**
     * Disconnect from current channel
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.channelId = null;
    }
    
    /**
     * Send a message
     */
    send(content) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(content);
            return true;
        }
        return false;
    }
    
    /**
     * Check if connected
     */
    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }
    
    /**
     * Attempt to reconnect
     */
    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts && this.channelId) {
            this.reconnectAttempts++;
            console.log(`Attempting reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(() => {
                if (this.channelId) {
                    this.connect(this.channelId);
                }
            }, 2000 * this.reconnectAttempts);
        }
    }
}

// Create singleton instance
const wsClient = new WebSocketClient();

// Export for use in other scripts
window.wsClient = wsClient;