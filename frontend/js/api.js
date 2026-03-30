/**
 * API wrapper for Voice-Chat backend.
 * Handles all HTTP requests with JWT authentication.
 */

const API_BASE = 'https://voice-chat-production-a794.up.railway.app';

// JWT token storage
let authToken = localStorage.getItem('voice_chat_token');

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
    
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    
    // Add auth token if available
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(url, {
        ...options,
        headers,
    });
    
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
            throw new Error(error.detail || 'Registration failed');
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
            throw new Error(error.detail || 'Login failed');
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
     * Invite a user to a group
     */
    async invite(groupId, username) {
        const response = await apiRequest(`/groups/${groupId}/invite`, {
            method: 'POST',
            body: JSON.stringify({ username }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to invite user');
        }
        
        return response.json();
    },
    
    /**
     * Get group members
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
     * Get group details
     */
    async get(groupId) {
        const response = await apiRequest(`/groups/${groupId}`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch group');
        }
        
        return response.json();
    },
    
    /**
     * Update a group
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
};

/**
 * API: Channels
 */
const channelsAPI = {
    /**
     * Get all channels in a group
     */
    async list(groupId) {
        const response = await apiRequest(`/channels/groups/${groupId}/channels`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch channels');
        }
        
        return response.json();
    },
    
    /**
     * Create a new channel in a group
     */
    async create(groupId, name, type) {
        const response = await apiRequest(`/channels/groups/${groupId}/channels`, {
            method: 'POST',
            body: JSON.stringify({ name, type }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create channel');
        }
        
        return response.json();
    },
    
    /**
     * Join a voice channel (register in database)
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
     * Leave a voice channel (remove from database)
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
     * Get voice participants (who's in the voice channel)
     */
    async getVoiceParticipants(channelId) {
        const response = await apiRequest(`/channels/${channelId}/voice/participants`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to get voice participants');
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
};

/**
 * API: LiveKit
 */
const livekitAPI = {
    /**
     * Get LiveKit token for voice channel
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
 * API: Users
 */
const usersAPI = {
    /**
     * Get current user profile
     */
    async getMe() {
        const response = await apiRequest('/users/me');
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to get profile');
        }
        
        return response.json();
    },
    
    /**
     * Update current user profile
     */
    async updateMe(data) {
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
    async uploadAvatar(file) {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch(`${API_BASE}/users/me/avatar`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to upload avatar');
        }
        
        return response.json();
    },
};

// Export for use in other scripts
window.API = {
    auth: authAPI,
    groups: groupsAPI,
    channels: channelsAPI,
    livekit: livekitAPI,
    users: usersAPI,
    setAuthToken,
    clearAuthToken,
    getAuthToken,
    isAuthenticated,
};