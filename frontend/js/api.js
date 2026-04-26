/**
 * API wrapper for Voice-Chat backend.
 * Handles all HTTP requests with JWT authentication.
 */

const API_BASE = 'https://voice-chat-production-a794.up.railway.app';

// JWT token storage
let authToken = localStorage.getItem('voice_chat_token');

// For Tauri audio only, not for HTTP
let isTauriAudio = false;
if (window.__TAURI__ || window.tauri) {
    isTauriAudio = true;
}

/**
 * Save authentication token
 */
function setAuthToken(token) {
    authToken = token;
    localStorage.setItem('voice_chat_token', token);
}

/**
 * Clear authentication token
 */
function clearAuthToken() {
    authToken = null;
    localStorage.removeItem('voice_chat_token');
}

/**
 * Get current auth token
 */
function getAuthToken() {
    return authToken;
}

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
    return !!authToken;
}

/**
 * Make an authenticated API request
 */
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    
    let response;
    try {
        // Use native fetch
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }
        
        response = await fetch(url, {
            ...options,
            headers,
        });
    } catch (error) {
        throw new Error('Network error: ' + error.message);
    }
    
    // Handle 401 - unauthorized
    if (response.status === 401) {
        clearAuthToken();
        window.location.reload();
        throw new Error('Unauthorized');
    }
    
    return response;
}

/**
 * API: Authentication
 */
const authAPI = {
    /**
     * Register a new user
     */
    async register(username, email, password) {
        const response = await apiRequest('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, email, password }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            const detail = error.detail;
            if (Array.isArray(detail)) {
                throw new Error(detail.map(e => e.msg).join(', '));
            }
            throw new Error(detail || 'Registration failed');
        }
        
        return response.json();
    },
    
    /**
     * Login with credentials
     */
    async login(username, password) {
        const response = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            const detail = error.detail;
            if (Array.isArray(detail)) {
                throw new Error(detail.map(e => e.msg).join(', '));
            }
            throw new Error(detail || 'Login failed');
        }
        
        return response.json();
    },
};

/**
 * API: Groups
 */
const groupsAPI = {
    /**
     * Get all groups for current user
     */
    async list() {
        const response = await apiRequest('/groups');
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch groups');
        }
        
        return response.json();
    },
    
    /**
     * Create a new group
     */
    async create(name) {
        const response = await apiRequest('/groups', {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create group');
        }
        
        return response.json();
    },
    
    /**
     * Delete a group
     */
    async delete(groupId) {
        const response = await apiRequest(`/groups/${groupId}`, {
            method: 'DELETE',
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to delete group');
        }
        
        return response.json();
    },
    
    /**
     * Get all members of a group
     */
    async getMembers(groupId) {
        const response = await apiRequest(`/groups/${groupId}/members`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch members');
        }
        
        return response.json();
    },
    
    /**
     * Get all channels in a group
     */
    async getChannels(groupId) {
        const response = await apiRequest(`/groups/${groupId}/channels`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch channels');
        }
        
        return response.json();
    },
    
    /**
     * Create a channel
     */
    async createChannel(groupId, name, type = 'text') {
        const response = await apiRequest(`/groups/${groupId}/channels`, {
            method: 'POST',
            body: JSON.stringify({ name, channel_type: type }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create channel');
        }
        
        return response.json();
    },
    
    /**
     * Delete a channel
     */
    async deleteChannel(groupId, channelId) {
        const response = await apiRequest(`/groups/${groupId}/channels/${channelId}`, {
            method: 'DELETE',
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to delete channel');
        }
        
        return response.json();
    },
    
    /**
     * Update a member's role
     */
    async updateMemberRole(groupId, userId, role) {
        const response = await apiRequest(`/groups/${groupId}/members/${userId}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to update role');
        }
        
        return response.json();
    },
    
    /**
     * Kick a member from group
     */
    async kickMember(groupId, userId) {
        const response = await apiRequest(`/groups/${groupId}/members/${userId}`, {
            method: 'DELETE',
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to kick member');
        }
        
        return response.json();
    },
    
    /**
     * Update a group (name)
     */
    async update(groupId, data) {
        const response = await apiRequest(`/groups/${groupId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to update group');
        }
        
        return response.json();
    },
};

/**
 * API: Channels
 */
const channelsAPI = {
    /**
     * List all channels in a group
     */
    async list(groupId) {
        const response = await apiRequest(`/groups/${groupId}/channels`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch channels');
        }
        
        return response.json();
    },
    
    /**
     * Create a new channel
     */
    async create(groupId, name, type = 'text') {
        const response = await apiRequest(`/groups/${groupId}/channels`, {
            method: 'POST',
            body: JSON.stringify({ name, channel_type: type }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create channel');
        }
        
        return response.json();
    },
    
    /**
     * Get a single channel
     */
    async get(channelId) {
        const response = await apiRequest(`/channels/${channelId}`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch channel');
        }
        
        return response.json();
    },
    
    /**
     * Join a voice channel
     */
    async joinVoice(channelId) {
        const response = await apiRequest(`/channels/${channelId}/voice/join`, {
            method: 'POST',
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to join voice');
        }
        
        return response.json();
    },
    
    /**
     * Leave a voice channel
     */
    async leaveVoice(channelId) {
        const response = await apiRequest(`/channels/${channelId}/voice/leave`, {
            method: 'POST',
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to leave voice');
        }
        
        return response.json();
    },
    
    /**
     * Get voice participants in a channel
     */
    async getVoiceParticipants(channelId) {
        const response = await apiRequest(`/channels/${channelId}/voice/participants`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch voice participants');
        }
        
        return response.json();
    },
    
    /**
     * Delete a channel
     */
    async delete(channelId) {
        const response = await apiRequest(`/channels/${channelId}`, {
            method: 'DELETE',
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to delete channel');
        }
        
        return response.json();
    },
    
    /**
     * Update a channel
     */
    async update(channelId, data) {
        const response = await apiRequest(`/channels/${channelId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to update channel');
        }
        
        return response.json();
    },
};

/**
 * API: LiveKit
 */
const livekitAPI = {
    /**
     * Get LiveKit token for voice chat (uses POST with JSON body)
     */
    async getToken(channelId) {
        const response = await apiRequest('/livekit/token', {
            method: 'POST',
            body: JSON.stringify({ channel_id: channelId }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to get voice token');
        }
        
        return response.json();
    },
};

/**
 * API: Messages
 */
const messagesAPI = {
    /**
     * Get messages from a channel
     */
    async list(groupId, channelId) {
        const response = await apiRequest(`/groups/${groupId}/channels/${channelId}/messages`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch messages');
        }
        
        return response.json();
    },
    
    /**
     * Send a message
     */
    async send(groupId, channelId, content) {
        const response = await apiRequest(`/groups/${groupId}/channels/${channelId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to send message');
        }
        
        return response.json();
    },
};

/**
 * API: Users
 */
const usersAPI = {
    /**
     * Get current user
     */
    async me() {
        const response = await apiRequest('/users/me');
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch user');
        }
        
        return response.json();
    },
    
    /**
     * Update user profile
     */
    async updateProfile(data) {
        const response = await apiRequest('/users/me', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to update profile');
        }
        
        return response.json();
    },
    
    /**
     * Upload avatar
     */
    async uploadAvatar(formData) {
        const response = await fetch(`${API_BASE}/users/me/avatar`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
            },
            body: formData,
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to upload avatar');
        }
        
        return response.json();
    },
};

/**
 * API: Voice
 */
const voiceAPI = {
    /**
     * Get Voice Server for a channel
     */
    async getVoiceServer(groupId, channelId) {
        const response = await apiRequest(`/groups/${groupId}/channels/${channelId}/voice`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to get voice server');
        }
        
        return response.json();
    },
};

/**
 * API: Files
 */
const filesAPI = {
    /**
     * Upload a file
     */
    async upload(groupId, channelId, formData) {
        const response = await fetch(`${API_BASE}/groups/${groupId}/channels/${channelId}/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
            },
            body: formData,
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to upload file');
        }
        
        return response.json();
    },
};

/**
 * API: Invite
 */
const inviteAPI = {
    /**
     * Generate invite link
     */
    async create(groupId) {
        const response = await apiRequest(`/groups/${groupId}/invite`, {
            method: 'POST',
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create invite');
        }
        
        return response.json();
    },
};

/**
 * API: Direct Messages
 */
const dmAPI = {
    /**
     * List all DM conversations
     */
    async listConversations() {
        const response = await apiRequest('/dm/conversations');
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch conversations');
        }
        
        return response.json();
    },
    
    /**
     * Start a new DM conversation
     */
    async startConversation(username) {
        const response = await apiRequest('/dm/conversations', {
            method: 'POST',
            body: JSON.stringify({ username }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to start conversation');
        }
        
        return response.json();
    },
    
    /**
     * Get messages from a conversation
     */
    async getMessages(conversationId) {
        const response = await apiRequest(`/dm/conversations/${conversationId}/messages`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch messages');
        }
        
        return response.json();
    },
    
    /**
     * Send a message in a DM conversation
     */
    async sendMessage(conversationId, content) {
        const response = await apiRequest(`/dm/conversations/${conversationId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to send message');
        }
        
        return response.json();
    },
};

/**
 * Combined API
 */
const API = {
    auth: authAPI,
    groups: groupsAPI,
    channels: channelsAPI,
    messages: messagesAPI,
    users: usersAPI,
    voice: voiceAPI,
    files: filesAPI,
    invite: inviteAPI,
    livekit: livekitAPI,
    dm: dmAPI,
    
    // Auth helpers
    setAuthToken,
    clearAuthToken,
    getAuthToken,
    isAuthenticated,
};