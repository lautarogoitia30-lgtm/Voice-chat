// DEBUG: Check if this file is loading
console.log('app.js loading...');

/**
 * Main application logic for Voice-Chat.
 * Handles UI interactions, navigation, and state management.
 */

// Application state
// Initialize state from localStorage
const savedUsername = localStorage.getItem('voice_chat_username');
const savedUserId = localStorage.getItem('voice_chat_user_id');
const savedAvatarUrl = localStorage.getItem('voice_chat_avatar_url');

console.log('=== APP LOADING ===');
console.log('savedUsername:', savedUsername, typeof savedUsername);
console.log('savedUserId:', savedUserId, typeof savedUserId);
console.log('savedAvatarUrl:', savedAvatarUrl, typeof savedAvatarUrl);

// Convert user_id to number if it exists
const userIdNum = savedUserId ? parseInt(savedUserId, 10) : null;
console.log('userIdNum:', userIdNum, typeof userIdNum);

const state = {
    currentUser: (savedUsername && savedUserId) ? { username: savedUsername, user_id: userIdNum, avatar_url: savedAvatarUrl || null } : null,
    groups: [],
    selectedGroup: null,
    selectedChannel: null,
    isInVoice: false,
    isMuted: false,
    isDeafened: false,
    leftVoice: false, // Track if user explicitly left the voice channel
};

// Expose state globally so livekit.js can check observer mode
window.appState = state;

console.log('Initial state:', state);

// DOM Elements - use function to get them when DOM is ready
function getElements() {
    return {
        authView: document.getElementById('auth-view'),
        appView: document.getElementById('app-view'),
        loginTab: document.getElementById('login-tab'),
        registerTab: document.getElementById('register-tab'),
        loginForm: document.getElementById('login-form'),
        registerForm: document.getElementById('register-form'),
        loginError: document.getElementById('login-error'),
        registerError: document.getElementById('register-error'),
        loginUsername: document.getElementById('login-username'),
        loginPassword: document.getElementById('login-password'),
        registerUsername: document.getElementById('register-username'),
        registerEmail: document.getElementById('register-email'),
        registerPassword: document.getElementById('register-password'),
        groupsList: document.getElementById('groups-list'),
        createGroupBtn: document.getElementById('create-group-btn'),
        selectedGroupName: document.getElementById('selected-group-name'),
        channelsList: document.getElementById('channels-list'),
        createChannelBtn: document.getElementById('create-channel-btn'),
        selectedChannelName: document.getElementById('selected-channel-name'),
        textChat: document.getElementById('text-chat'),
        voiceChat: document.getElementById('voice-chat'),
        messagesList: document.getElementById('messages-list'),
        messageForm: document.getElementById('message-form'),
        messageInput: document.getElementById('message-input'),
        voiceControls: document.getElementById('voice-controls'),
        joinVoiceBtn: document.getElementById('join-voice-btn'),
        leaveVoiceBtn: document.getElementById('leave-voice-btn'),
        participantsList: document.getElementById('participants-list'),
        createGroupModal: document.getElementById('create-group-modal'),
        createGroupForm: document.getElementById('create-group-form'),
        groupNameInput: document.getElementById('group-name-input'),
        cancelCreateGroup: document.getElementById('cancel-create-group'),
        createChannelModal: document.getElementById('create-channel-modal'),
        createChannelForm: document.getElementById('create-channel-form'),
        channelNameInput: document.getElementById('channel-name-input'),
        channelTypeInput: document.getElementById('channel-type-input'),
        cancelCreateChannel: document.getElementById('cancel-create-channel'),
    };
}

// Initialize app
function init() {
    const elements = getElements();
    console.log('init called, isAuthenticated:', API.isAuthenticated());
    
    // If authenticated, ensure currentUser is set from localStorage
    if (API.isAuthenticated()) {
        const savedUsername = localStorage.getItem('voice_chat_username');
        const savedUserId = localStorage.getItem('voice_chat_user_id');
        const savedAvatarUrl = localStorage.getItem('voice_chat_avatar_url');
        if (savedUsername && savedUserId) {
            state.currentUser = { 
                username: savedUsername, 
                user_id: parseInt(savedUserId, 10),
                avatar_url: savedAvatarUrl || null
            };
            console.log('Restored user from localStorage:', state.currentUser);
        }
        console.log('User is authenticated, showing app view');
        showAppView();
    } else {
        console.log('User not authenticated, showing auth view');
        showAuthView();
    }
    setupEventListeners(elements);
}

// Setup event listeners
function setupEventListeners(elements) {
    // Auth forms
    if (elements.loginTab) elements.loginTab.addEventListener('click', () => showLoginForm(elements));
    if (elements.registerTab) elements.registerTab.addEventListener('click', () => showRegisterForm(elements));
    if (elements.loginForm) elements.loginForm.addEventListener('submit', (e) => handleLoginSubmit(e, elements));
    if (elements.registerForm) elements.registerForm.addEventListener('submit', (e) => handleRegisterSubmit(e, elements));
    
    // Group/Channel modals
    if (elements.createGroupBtn) elements.createGroupBtn.addEventListener('click', () => showCreateGroupModal());
    document.getElementById('cancel-create-group')?.addEventListener('click', () => hideCreateGroupModal());
    if (elements.createGroupForm) elements.createGroupForm.addEventListener('submit', (e) => handleCreateGroup(e));
    
    // Edit group form
    document.getElementById('edit-group-form')?.addEventListener('submit', (e) => handleEditGroup(e));
    
    // Invite user button
    elements.inviteUserBtn = document.getElementById('invite-user-btn');
    if (elements.inviteUserBtn) {
        elements.inviteUserBtn.addEventListener('click', handleInviteUser);
    }
    if (elements.createChannelBtn) elements.createChannelBtn.addEventListener('click', () => showCreateChannelModal());
    document.getElementById('cancel-create-channel')?.addEventListener('click', () => hideCreateChannelModal());
    if (elements.createChannelForm) elements.createChannelForm.addEventListener('submit', (e) => handleCreateChannel(e));
    
    // Edit channel form
    document.getElementById('edit-channel-form')?.addEventListener('submit', (e) => handleEditChannel(e));
    
    // Chat
    if (elements.messageForm) elements.messageForm.addEventListener('submit', (e) => handleMessageSubmit(e, elements));
    if (elements.joinVoiceBtn) elements.joinVoiceBtn.addEventListener('click', handleJoinVoice);
    if (elements.leaveVoiceBtn) elements.leaveVoiceBtn.addEventListener('click', handleLeaveVoice);
    
    // Voice controls - mute/deafen - get directly from DOM
    document.getElementById('mute-mic-btn')?.addEventListener('click', () => {
        console.log('Mute button clicked');
        handleToggleMute();
    });
    document.getElementById('deaf-btn')?.addEventListener('click', () => {
        console.log('Deaf button clicked');
        handleToggleDeaf();
    });
    
    window.wsClient.onMessage = handleWebSocketMessage;
    window.wsClient.onConnect = () => console.log('WebSocket connected');
    window.wsClient.onDisconnect = () => console.log('WebSocket disconnected');
    
    // LiveKit events - connecting to LiveKit's internal events
    // These will be called from livekit.js
    window.livekitCallbacks = window.livekitCallbacks || {};
    window.livekitCallbacks.onParticipantConnected = handleParticipantConnected;
    window.livekitCallbacks.onParticipantDisconnected = handleParticipantDisconnected;
    window.livekitCallbacks.onActiveSpeakersChanged = handleActiveSpeakersChanged;
}

// Show/hide views
function showAuthView() {
    const elements = getElements();
    elements.authView.classList.remove('hidden');
    elements.appView.classList.add('hidden');
}

function showAppView() {
    console.log('showAppView called');
    const elements = getElements();
    elements.authView.classList.add('hidden');
    elements.appView.classList.remove('hidden');
    loadGroups();
    
    // Auto-refresh groups every 30 seconds to detect new invites
    setInterval(() => {
        if (state.currentUser) {
            loadGroups();
        }
    }, 30000);
}

// GLOBAL FUNCTIONS FOR ONCLICK
window.showLoginForm = function() {
    const elements = getElements();
    elements.loginForm.classList.remove('hidden');
    elements.registerForm.classList.add('hidden');
    elements.loginTab.classList.add('border-indigo-500', 'text-indigo-400');
    elements.loginTab.classList.remove('text-gray-400');
    elements.registerTab.classList.remove('border-indigo-500', 'text-indigo-400');
    elements.registerTab.classList.add('text-gray-400');
};

window.showRegisterForm = function() {
    const elements = getElements();
    elements.loginForm.classList.add('hidden');
    elements.registerForm.classList.remove('hidden');
    elements.registerTab.classList.add('border-indigo-500', 'text-indigo-400');
    elements.registerTab.classList.remove('text-gray-400');
    elements.loginTab.classList.remove('border-indigo-500', 'text-indigo-400');
    elements.loginTab.classList.add('text-gray-400');
};

// Auth handlers
async function handleLoginSubmit(e, elements) {
    e.preventDefault();
    const username = elements.loginUsername.value;
    const password = elements.loginPassword.value;
    try {
        console.log('=== LOGIN SUBMIT ===');
        console.log('Username from form:', username);
        console.log('Password:', password ? 'provided' : 'empty');
        
        const response = await API.auth.login(username, password);
        console.log('=== LOGIN RESPONSE ===');
        console.log('Full response:', response);
        console.log('Response.user_id:', response.user_id, typeof response.user_id);
        console.log('Response.username:', response.username, typeof response.username);
        
        // Save token and username
        API.setAuthToken(response.access_token);
        
        // DEBUG: Verify we're getting the correct user_id
        const loginUserId = response.user_id;
        const loginUsername = response.username || username;
        
        console.log('=== SETTING STATE ===');
        console.log('Setting user_id:', loginUserId, 'type:', typeof loginUserId);
        console.log('Setting username:', loginUsername);
        
        // Use the username from the form since response might not have it
        state.currentUser = { username: loginUsername, user_id: loginUserId };
        
        // Also save to localStorage for persistence
        localStorage.setItem('voice_chat_username', loginUsername);
        localStorage.setItem('voice_chat_user_id', String(loginUserId));
        
        // Fetch user profile to get avatar
        try {
            const profileResponse = await fetch('https://voice-chat-production-a794.up.railway.app/users/me', {
                headers: { 'Authorization': 'Bearer ' + response.access_token }
            });
            if (profileResponse.ok) {
                const profile = await profileResponse.json();
                state.currentUser.avatar_url = profile.avatar_url;
                if (profile.avatar_url) {
                    localStorage.setItem('voice_chat_avatar_url', profile.avatar_url);
                }
            }
        } catch (e) {
            console.log('Could not fetch profile:', e);
        }
        
        console.log('localStorage voice_chat_user_id:', localStorage.getItem('voice_chat_user_id'));
        console.log('Token saved, localStorage voice_chat_token:', localStorage.getItem('voice_chat_token') ? 'present' : 'missing');
        console.log('User logged in:', state.currentUser);
        
        // Force show app view - DON'T go back even if there's an error
        console.log('Calling showAppView...');
        showAppView();
        
        // Prevent going back to auth view
        console.log('Login complete, staying on app view');
        
    } catch (error) {
        console.error('Login error:', error);
        elements.loginError.textContent = error.message;
        elements.loginError.classList.remove('hidden');
    }
}

async function handleRegisterSubmit(e, elements) {
    e.preventDefault();
    const username = elements.registerUsername.value;
    const email = elements.registerEmail.value;
    const password = elements.registerPassword.value;
    try {
        await API.auth.register(username, email, password);
        const response = await API.auth.login(username, password);
        API.setAuthToken(response.access_token);
        state.currentUser = { username: username, user_id: response.user_id };
        showAppView();
    } catch (error) {
        elements.registerError.textContent = error.message;
        elements.registerError.classList.remove('hidden');
    }
}

// Load groups
async function loadGroups() {
    console.log('=== loadGroups() called ===');
    try {
        console.log('Loading groups...');
        const groups = await API.groups.list();
        console.log('Groups loaded:', groups);
        state.groups = groups;
        console.log('Calling renderGroups()...');
        renderGroups();
    } catch (error) {
        console.error('Failed to load groups:', error);
        
        // Show error on screen so we can see it
        const elements = getElements();
        const errorDiv = document.createElement('div');
        errorDiv.className = 'p-4 bg-red-600 text-white';
        errorDiv.textContent = 'Error loading groups: ' + error.message;
        elements.appView.appendChild(errorDiv);
        
        // Still show the app view - don't go back to auth
    }
}

// Render groups - update server icon
function renderGroups() {
    const serverIcon = document.querySelector('.server-icon');
    const groupsList = document.getElementById('groups-list');
    
    // Render groups list
    if (groupsList) {
        groupsList.innerHTML = '';
        state.groups.forEach(group => {
            const div = document.createElement('div');
            div.className = 'channel-item' + (state.selectedGroup?.id === group.id ? ' active' : '');
            div.innerHTML = '<span class="channel-icon">📁</span><span class="channel-name">' + group.name + '</span>';
            div.onclick = () => selectGroup(group);
            groupsList.appendChild(div);
        });
    }
    
    if (state.groups.length > 0) {
        // Always select the first group when loading
        if (!state.selectedGroup || !state.groups.find(g => g.id === state.selectedGroup.id)) {
            console.log('Selecting first group:', state.groups[0]);
            selectGroup(state.groups[0]);
        }
        
        // Update server icon if exists
        if (serverIcon) {
            // Get initial of first group
            const initial = state.selectedGroup?.name?.charAt(0).toUpperCase() || 'V';
            serverIcon.innerHTML = initial;
            serverIcon.title = state.selectedGroup?.name || 'Voice-Chat';
        }
    } else {
        if (serverIcon) {
            serverIcon.innerHTML = '💬';
            serverIcon.title = 'Sin grupos';
        }
    }
}

// Render members list
function renderMembers(members) {
    const membersSection = document.getElementById('members-section');
    const membersList = document.getElementById('members-list');
    
    if (!membersSection || !membersList) return;
    
    // Show members section
    membersSection.classList.remove('hidden');
    
    // Clear and render members
    membersList.innerHTML = '';
    
    members.forEach(member => {
        const div = document.createElement('div');
        div.className = 'member-item';
        
        // Check if member has avatar
        const initial = member.username.charAt(0).toUpperCase();
        let avatarHtml = '';
        
        if (member.avatar_url) {
            // Use avatar image
            const avatarSrc = member.avatar_url.startsWith('http') ? member.avatar_url : 'https://voice-chat-production-a794.up.railway.app' + member.avatar_url;
            avatarHtml = `<img src="${avatarSrc}" alt="${member.username}" class="member-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="member-avatar" style="display:none">${initial}</div>`;
        } else {
            avatarHtml = `<div class="member-avatar">${initial}</div>`;
        }
        
        // Check if it's the current user
        const isCurrentUser = member.id === state.currentUser?.user_id;
        const nameDisplay = isCurrentUser ? member.username + ' (tú)' : member.username;
        
        div.innerHTML = `
            <div class="member-avatar-container">${avatarHtml}</div>
            <div class="member-info">
                <div class="member-name">${nameDisplay}</div>
                <div class="member-status">
                    <span>🟢 Online</span>
                </div>
            </div>
        `;
        
        membersList.appendChild(div);
    });
    
    console.log('Members rendered:', members.length);
}

// Select group
async function selectGroup(group) {
    state.selectedGroup = group;
    state.selectedChannel = null;
    const elements = getElements();
    elements.selectedGroupName.textContent = group.name;
    elements.createChannelBtn.classList.remove('hidden');
    
    // Show invite button if user is owner (we'll check via API later)
    const inviteBtn = document.getElementById('invite-user-btn');
    if (inviteBtn) {
        inviteBtn.classList.remove('hidden');
    }
    
    // Load members for this group
    console.log('Loading members for group:', group.id);
    console.log('API:', API);
    console.log('API.groups:', API?.groups);
    console.log('getMembers:', API?.groups?.getMembers);
    try {
        if (API?.groups?.getMembers) {
            const members = await API.groups.getMembers(group.id);
            console.log('Members loaded:', members);
            renderMembers(members);
        } else {
            console.warn('API.groups.getMembers not available');
        }
    } catch (error) {
        console.error('Failed to load members:', error);
    }
    
    try {
        const channels = await API.channels.list(group.id);
        renderChannels(channels);
    } catch (error) {
        console.error('Failed to load channels:', error);
    }
    elements.selectedChannelName.textContent = 'Selecciona un canal';
    elements.textChat.classList.add('hidden');
    elements.voiceChat.classList.add('hidden');
    elements.voiceControls.classList.add('hidden');
    renderGroups();
}

// Render channels
function renderChannels(channels) {
    console.log('Rendering channels:', channels);
    const elements = getElements();
    elements.channelsList.innerHTML = '';
    
    if (!channels || channels.length === 0) {
        console.log('No channels to render');
        elements.channelsList.innerHTML = '<div class="text-gray-500 text-sm p-2">No hay canales</div>';
        return;
    }
    
    // Separate voice and text channels
    const voiceChannels = channels.filter(c => c.type === 'voice');
    const textChannels = channels.filter(c => c.type === 'text');
    
    // Render voice channels
    if (voiceChannels.length > 0) {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'channel-category';
        categoryDiv.innerHTML = '<div class="channel-category-title">🔊 Canales de Voz</div>';
        
        voiceChannels.forEach(channel => {
            const div = document.createElement('div');
            div.className = 'channel-item ' + (state.selectedChannel?.id === channel.id ? 'active' : '');
            div.innerHTML = '<span class="channel-icon">🎤</span><span class="channel-name">' + channel.name + '</span>';
            div.addEventListener('click', () => selectChannel(channel));
            div.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showEditChannelModal(channel);
            });
            categoryDiv.appendChild(div);
        });
        
        elements.channelsList.appendChild(categoryDiv);
    }
    
    // Render text channels
    if (textChannels.length > 0) {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'channel-category';
        categoryDiv.innerHTML = '<div class="channel-category-title">💬 Canales de Texto</div>';
        
        textChannels.forEach(channel => {
            const div = document.createElement('div');
            div.className = 'channel-item ' + (state.selectedChannel?.id === channel.id ? 'active' : '');
            div.innerHTML = '<span class="channel-icon">💬</span><span class="channel-name">' + channel.name + '</span>';
            div.addEventListener('click', () => selectChannel(channel));
            div.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showEditChannelModal(channel);
            });
            categoryDiv.appendChild(div);
        });
        
        elements.channelsList.appendChild(categoryDiv);
    }
}

// Select channel
async function selectChannel(channel) {
    state.selectedChannel = channel;
    const elements = getElements();
    elements.selectedChannelName.textContent = channel.name;
    if (channel.type === 'text') {
        elements.textChat.classList.remove('hidden');
        elements.voiceChat.classList.add('hidden');
        elements.voiceControls.classList.add('hidden');
        window.wsClient.connect(channel.id);
    } else {
        elements.textChat.classList.add('hidden');
        elements.voiceChat.classList.remove('hidden');
        elements.voiceControls.classList.remove('hidden');
        elements.joinVoiceBtn.classList.remove('hidden');
        elements.leaveVoiceBtn.classList.add('hidden');
        
        // Show voice participants from database (even if not in voice)
        updateVoiceParticipantsDisplay();
        
        // Update voice participants every 2 seconds (from database)
        if (window.voiceParticipantsInterval) {
            clearInterval(window.voiceParticipantsInterval);
        }
        window.voiceParticipantsInterval = setInterval(() => {
            if (state.selectedChannel && state.selectedChannel.type === 'voice') {
                updateVoiceParticipantsDisplay();
            }
        }, 2000);
    }
}

// Group operations
async function handleCreateGroup(e) {
    e.preventDefault();
    const name = document.getElementById('group-name-input').value;
    try {
        await API.groups.create(name);
        hideCreateGroupModal();
        document.getElementById('group-name-input').value = '';
        await loadGroups();
    } catch (error) {
        console.error('Failed to create group:', error);
    }
}

// Invite user to group
async function handleInviteUser() {
    if (!state.selectedGroup) {
        alert('Selecciona un grupo primero');
        return;
    }
    
    const username = prompt('Ingresa el nombre de usuario a invitar:');
    if (!username) return;
    
    try {
        // DEBUG: Log what's being sent
        const token = API.getAuthToken();
        console.log('[INVITE] Sending invite request:');
        console.log('  - Group ID:', state.selectedGroup.id);
        console.log('  - Username to invite:', username);
        console.log('  - Token:', token ? token.substring(0, 20) + '...' : 'NO TOKEN');
        
        const response = await fetch(`https://voice-chat-production-a794.up.railway.app/groups/${state.selectedGroup.id}/invite`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ username })
        });
        
        if (!response.ok) {
            const error = await response.json();
            console.error('[INVITE] Error response:', error);
            throw new Error(error.detail || 'Failed to invite');
        }
        
        const result = await response.json();
        console.log('[INVITE] Success:', result);
        alert('Usuario convidado! La otra cuenta debe hacer click en 🔄 para ver los canales.');
    } catch (error) {
        alert('Error al convidar: ' + error.message);
    }
}

// Channel operations
async function handleCreateChannel(e) {
    e.preventDefault();
    const name = document.getElementById('channel-name-input').value;
    const type = document.getElementById('channel-type-input').value;
    try {
        await API.channels.create(state.selectedGroup.id, name, type);
        hideCreateChannelModal();
        document.getElementById('channel-name-input').value = '';
        const channels = await API.channels.list(state.selectedGroup.id);
        state.selectedGroup.channels = channels;
        renderChannels(channels);
    } catch (error) {
        console.error('Failed to create channel:', error);
    }
}

// Message operations
async function handleMessageSubmit(e, elements) {
    e.preventDefault();
    const content = elements.messageInput.value.trim();
    if (!content) return;
    
    // Include sender info with message
    const message = {
        channel_id: state.selectedChannel.id,
        content: content,
        sender_id: state.currentUser?.user_id || parseInt(localStorage.getItem('voice_chat_user_id') || '0'),
        sender_username: state.currentUser?.username || localStorage.getItem('voice_chat_username') || "Anonymous"
    };
    
    console.log('Sending message:', message);
    
    window.wsClient.send(JSON.stringify(message));
    elements.messageInput.value = '';
}

// File upload handler
async function handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return;
    
    console.log('Uploading file:', file.name, 'size:', file.size);
    
    // Check if in a channel
    if (!state.selectedChannel || state.selectedChannel.type !== 'text') {
        alert('Entrá a un canal de texto para subir archivos');
        return;
    }
    
    // Check file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
        alert('El archivo es muy grande. Máximo 10MB');
        return;
    }
    
    // Create FormData
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        // Upload file
        const response = await fetch('https://voice-chat-production-a794.up.railway.app/files/upload', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + API.getAuthToken()
            },
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            alert('Error uploading: ' + (error.detail || 'Failed to upload'));
            return;
        }
        
        const fileInfo = await response.json();
        console.log('File uploaded:', fileInfo);
        
        // Send file message via WebSocket
        const message = {
            channel_id: state.selectedChannel.id,
            content: '[FILE:' + JSON.stringify(fileInfo) + ']',
            sender_id: state.currentUser?.user_id || parseInt(localStorage.getItem('voice_chat_user_id') || '0'),
            sender_username: state.currentUser?.username || localStorage.getItem('voice_chat_username') || "Anonymous",
            is_file: true,
            file_info: fileInfo
        };
        
        window.wsClient.send(JSON.stringify(message));
        
        // Also display file directly in chat
        renderFileMessage(message);
        
    } catch (error) {
        console.error('Error uploading file:', error);
        alert('Error al subir archivo');
    }
    
    // Reset input
    input.value = '';
}

// Render file message in chat
function renderFileMessage(message) {
    const elements = getElements();
    if (!elements.messagesList) return;
    
    const fileInfo = message.file_info;
    if (!fileInfo) return;
    
    const div = document.createElement('div');
    div.className = 'message other';
    
    // Determine icon based on file type
    let icon = '📄';
    let isImage = false;
    if (fileInfo.category === 'image') {
        icon = '🖼️';
        isImage = true;
    } else if (fileInfo.category === 'audio') {
        icon = '🎵';
    } else if (fileInfo.category === 'video') {
        icon = '🎬';
    }
    
    // Format file size
    const sizeStr = formatFileSize(fileInfo.size);
    
    // Build file HTML
    let fileHtml = '';
    if (isImage) {
        fileHtml = `
            <div class="message-file">
                <img src="https://voice-chat-production-a794.up.railway.app${fileInfo.url}" alt="${fileInfo.filename}" onclick="window.open(this.src, '_blank')">
                <div class="message-file-info">
                    <div class="message-file-name">${fileInfo.filename}</div>
                    <div class="message-file-size">${sizeStr}</div>
                </div>
                <a href="https://voice-chat-production-a794.up.railway.app${fileInfo.url}" target="_blank" class="message-file-download">Abrir</a>
            </div>
        `;
    } else {
        fileHtml = `
            <div class="message-file">
                <div class="message-file-icon">${icon}</div>
                <div class="message-file-info">
                    <div class="message-file-name">${fileInfo.filename}</div>
                    <div class="message-file-size">${sizeStr}</div>
                </div>
                <a href="https://voice-chat-production-a794.up.railway.app${fileInfo.url}" target="_blank" class="message-file-download">Descargar</a>
            </div>
        `;
    }
    
    div.innerHTML = `
        <div class="message-sender">${message.sender_username}</div>
        ${fileHtml}
        <div class="message-time">${new Date().toLocaleTimeString()}</div>
    `;
    
    elements.messagesList.appendChild(div);
    elements.messagesList.scrollTop = elements.messagesList.scrollHeight;
}

// Format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// WebSocket message handler
function handleWebSocketMessage(message) {
    const elements = getElements();
    
    console.log('[WS] Message received:', message);
    
    // Check if we should show a notification for this message
    const currentUsername = state.currentUser?.username || localStorage.getItem('voice_chat_username');
    const currentUserId = state.currentUser?.user_id || parseInt(localStorage.getItem('voice_chat_user_id') || '0');
    const isOurMessage = message.sender_id === currentUserId || message.sender_username === currentUsername;
    
    console.log('[NOTIFICATION] Current user:', currentUsername, 'ID:', currentUserId, 'Is our message:', isOurMessage);
    
    // Only show notification if:
    // 1. It's not our own message
    // 2. We're on the same channel (or it doesn't matter)
    if (!isOurMessage && shouldNotifyForMessage(message.content, currentUsername)) {
        console.log('[NOTIFICATION] Should notify, showing...');
        showBrowserNotification(
            message.sender_username + ' te mencionó',
            message.content.substring(0, 100) + (message.content.length > 100 ? '...' : ''),
            null
        );
    } else {
        console.log('[NOTIFICATION] Not showing notification. isOurMessage:', isOurMessage, 'shouldNotify:', shouldNotifyForMessage(message.content, currentUsername));
    }
    
    // Check if this is a file message
    if (message.is_file && message.file_info) {
        renderFileMessage(message);
        return;
    }
    
    // Check if content is a file (legacy format)
    if (message.content && message.content.startsWith('[FILE:')) {
        try {
            const fileInfo = JSON.parse(message.content.substring(6));
            message.file_info = fileInfo;
            message.is_file = true;
            renderFileMessage(message);
            return;
        } catch (e) {
            console.log('Error parsing file info:', e);
        }
    }
    
    const div = document.createElement('div');
    div.className = 'message other';
    div.innerHTML = '<div class="message-sender">' + (message.sender_username || 'Unknown') + '</div><div class="message-content">' + message.content + '</div><div class="message-time">' + new Date(message.timestamp).toLocaleTimeString() + '</div>';
    elements.messagesList.appendChild(div);
    elements.messagesList.scrollTop = elements.messagesList.scrollHeight;
}

// Voice operations
async function handleJoinVoice() {
    try {
        console.log('=== JOINING VOICE ===');
        console.log('Channel ID:', state.selectedChannel.id);
        console.log('Current user:', state.currentUser);
        
        // Register in database first
        console.log('[JOIN] Calling joinVoice API...');
        await API.channels.joinVoice(state.selectedChannel.id);
        console.log('[JOIN] Registered in database');
        
        // Get token from API
        console.log('[JOIN] Getting LiveKit token...');
        const tokenData = await API.livekit.getToken(state.selectedChannel.id);
        console.log('[JOIN] Token received, URL:', tokenData.url, 'Room:', tokenData.room_name);
        console.log('[JOIN] Token starts with:', tokenData.token.substring(0, 50) + '...');
        
        // Connect to LiveKit
        console.log('[JOIN] Connecting to LiveKit...');
        await window.livekitClient.connect(tokenData.url, tokenData.token);
        console.log('[JOIN] Connected to LiveKit!');
        
        // Check room state
        const room = window.livekitClient.room;
        console.log('[JOIN] Room state:', room?.state);
        console.log('[JOIN] Room name:', room?.name);
        console.log('[JOIN] Local participant identity:', room?.localParticipant?.identity);
        console.log('[JOIN] Local participant name:', room?.localParticipant?.name);
        
        // Try to publish microphone
        try {
            console.log('[JOIN] Publishing microphone...');
            await window.livekitClient.publishMicrophone();
            console.log('[JOIN] Microphone published!');
        } catch (micError) {
            console.warn('[JOIN] Microphone access error:', micError.message);
        }
        
        // Update state
        state.isInVoice = true;
        state.isMuted = false;
        state.isDeafened = false;
        state.leftVoice = false; // Reset the flag when joining
        window.appState = state; // Update global reference for livekit.js

        console.log('[JOIN] State updated, calling updateVoiceControlsUI');
        
        // Update UI - show all voice controls
        updateVoiceControlsUI();
        
        // Update participants list
        updateParticipantsList();
        
        // Start periodic update for speaking detection
        startParticipantsUpdateInterval();
        
        console.log('[JOIN] Join complete! You should see yourself in the list.');
        
        // Update the channel list to show voice participants
        updateVoiceParticipantsDisplay();
        
    } catch (error) {
        console.error('[JOIN] Voice connection error:', error);
        alert('No se pudo unir a voz: ' + error.message);
    }
}

// Handle when active speakers change
function handleActiveSpeakersChanged(speakers) {
    console.log('Active speakers changed, speakers:', speakers);
    
    // Update the participants list to show who's speaking
    updateParticipantsList();
}

// Update participants list periodically to detect speaking state
let participantsUpdateInterval = null;
let previousParticipants = []; // Track previous participants to detect when someone leaves

function startParticipantsUpdateInterval() {
    console.log('[INTERVAL] Starting participants update interval');
    previousParticipants = []; // Reset when starting
    
    // Clear known participants in LiveKit when starting fresh
    if (window.livekitClient) {
        window.livekitClient.knownParticipants = [];
    }
    
    // Update every 100ms to detect speaking state changes
    if (participantsUpdateInterval) clearInterval(participantsUpdateInterval);
    
    participantsUpdateInterval = setInterval(() => {
        // Keep updating even if left voice - to see who's still there
        if (state.isInVoice) {
            // Get current participants
            let currentParticipants = [];
            
            if (window.livekitClient && window.livekitClient.room) {
                // Try to get from room directly
                const remoteParticipants = window.livekitClient.getParticipants();
                console.log('[INTERVAL] Room has', remoteParticipants.length, 'remote participants');
                
                // Update knownParticipants with current room state
                if (remoteParticipants.length > 0) {
                    window.livekitClient.knownParticipants = remoteParticipants;
                    currentParticipants = remoteParticipants;
                }
            }
            updateParticipantsList();
        }
    }, 100);
}

function stopParticipantsUpdateInterval() {
    if (participantsUpdateInterval) {
        clearInterval(participantsUpdateInterval);
        participantsUpdateInterval = null;
    }
}

function handleLeaveVoice() {
    console.log('[LEAVE] handleLeaveVoice CLICKED! - Observer mode');
    
    // MODO OBSERVER: Nos desconectamos del audio pero seguimos en el room
    // para ver quién está conectado
    
    const lc = window.livekitClient;
    console.log('[LEAVE] livekitClient:', lc);
    console.log('[LEAVE] livekitClient.room:', lc?.room);
    
    try {
        if (lc && lc.localParticipant) {
            console.log('[LEAVE] Has localParticipant');
            
            // Usar setMicrophoneEnabled(false) para dejar de publicar
            lc.localParticipant.setMicrophoneEnabled(false).then(() => {
                console.log('[LEAVE] Microphone disabled');
            }).catch(e => {
                console.log('[LEAVE] setMicrophoneEnabled error:', e);
            });
            
            // Unpublish todos los audio tracks
            if (lc.localParticipant.audioPublications) {
                lc.localParticipant.audioPublications.forEach(pub => {
                    if (pub.track) {
                        lc.localParticipant.unpublishTrack(pub.track);
                        pub.track.stop();
                    }
                });
            }
            
            // Silenciar TODOS los audio elements del DOM - método 1
            console.log('[LEAVE] Silencing all audio elements - method 1...');
            const allAudio = document.querySelectorAll('audio');
            console.log('[LEAVE] Found audio elements:', allAudio.length);
            allAudio.forEach(audio => {
                console.log('[LEAVE] Silencing audio element');
                audio.pause();
                audio.volume = 0;
                audio.muted = true;
                if (audio.srcObject) {
                    audio.srcObject.getTracks().forEach(track => track.stop());
                    audio.srcObject = null;
                }
                audio.remove();
            });
            
            // Unsubscribe del audio de los demás - método 2 (usar array)
            console.log('[LEAVE] Unsubscribing from remote audio...');
            if (lc.room && lc.room.remoteParticipants) {
                // Convert Map to Array
                const participants = Array.from(lc.room.remoteParticipants.values());
                console.log('[LEAVE] Remote participants:', participants.length);
                
                participants.forEach(p => {
                    console.log('[LEAVE] Processing participant:', p.identity);
                    if (p.audioPublications) {
                        p.audioPublications.forEach(pub => {
                            if (pub.track && pub.track.kind === 'audio') {
                                pub.setSubscribed(false);
                                console.log('[LEAVE] Unsubscribed from audio:', p.identity);
                            }
                        });
                    }
                });
            }
        }
    } catch(e) {
        console.log('[LEAVE] Error stopping audio:', e);
    }
    
    // DESCONEXIÓN COMPLETA del room
    // Esto hace que:
    // 1. Mr.porteño NO te vea más
    // 2. Vos NO ves a Mr.porteño
    // 3. Ambas personas tienen que reconectarse para volver a hablar
    
    // Silenciar todos los audios primero
    if (lc && lc.silenceAllAudio) {
        lc.silenceAllAudio();
    }
    
    // Desconectar completamente del room
    if (lc && lc.disconnect) {
        lc.disconnect();
    }
    
    // Also remove from database
    if (state.selectedChannel) {
        API.channels.leaveVoice(state.selectedChannel.id).catch(e => {
            console.log('[LEAVE] Error removing from database:', e);
        });
    }
    
    // Detener el intervalo de actualización
    stopParticipantsUpdateInterval();
    
    // Resetear estados
    state.isInVoice = false;
    state.leftVoice = false;
    state.isMuted = false;
    state.isDeafened = false;
    window.appState = state;
    
    // Update the channel list to show voice participants
    updateVoiceParticipantsDisplay();
    
    // Update UI - mostrar botón para unirse
    const elements = getElements();
    if (elements.joinVoiceBtn) {
        elements.joinVoiceBtn.classList.remove('hidden');
        elements.joinVoiceBtn.innerHTML = '🎤 Unirse';
        elements.joinVoiceBtn.title = 'Unirse al canal de voz';
    }
    if (elements.leaveVoiceBtn) elements.leaveVoiceBtn.classList.add('hidden');
    if (document.getElementById('mute-mic-btn')) document.getElementById('mute-mic-btn').classList.add('hidden');
    if (document.getElementById('deaf-btn')) document.getElementById('deaf-btn').classList.add('hidden');
    
    // Limpiar lista de participantes
    const partsList = document.getElementById('participants-list');
    if (partsList) partsList.innerHTML = '<div class="text-gray-400 p-2">No participants</div>';
    
    console.log('[LEAVE] Completely disconnected from voice');
    if (elements.leaveVoiceBtn) elements.leaveVoiceBtn.classList.add('hidden');
    if (elements.muteMicBtn) elements.muteMicBtn.classList.add('hidden');
    if (elements.deafBtn) elements.deafBtn.classList.add('hidden');
    
    // Actualizar lista inmediatamente para quitarnos
    updateParticipantsList();
    
    console.log('[LEAVE] Observer mode - can see participants, you are hidden');
}

// Update voice participants display from database (shows who's in voice channel)
async function updateVoiceParticipantsDisplay() {
    if (!state.selectedChannel || state.selectedChannel.type !== 'voice') return;
    
    try {
        // Get voice participants from database
        const participants = await API.channels.getVoiceParticipants(state.selectedChannel.id);
        console.log('[VOICE DB] Participants from database:', participants);
        
        const partsList = document.getElementById('participants-list');
        if (!partsList) return;
        
        partsList.innerHTML = '';
        
        if (participants.length === 0) {
            partsList.innerHTML = '<div class="text-gray-400 p-2">No hay nadie en voz</div>';
            return;
        }
        
        // Render each participant
        participants.forEach(p => {
            const div = document.createElement('div');
            div.className = 'member-item';
            
            // Check if it's the current user
            const isCurrentUser = p.user_id === state.currentUser?.user_id;
            const initial = p.username.charAt(0).toUpperCase();
            const nameDisplay = isCurrentUser ? p.username + ' (vos)' : p.username;
            
            // Check if participant has avatar
            let avatarHtml = '';
            if (p.avatar_url) {
                const avatarSrc = p.avatar_url.startsWith('http') ? p.avatar_url : 'https://voice-chat-production-a794.up.railway.app' + p.avatar_url;
                avatarHtml = `<img src="${avatarSrc}" alt="${p.username}" class="member-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="member-avatar" style="display:none">${initial}</div>`;
            } else {
                avatarHtml = `<div class="member-avatar">${initial}</div>`;
            }
            
            div.innerHTML = `
                <div class="member-avatar-container">${avatarHtml}</div>
                <div class="member-info">
                    <div class="member-name">${nameDisplay}</div>
                    <div class="member-status">
                        <span>🎤</span>
                        <span>En voz</span>
                    </div>
                </div>
            `;
            
            partsList.appendChild(div);
        });
        
    } catch (e) {
        console.log('[VOICE DB] Error getting participants:', e);
    }
}

// Toggle mute microphone
function handleToggleMute() {
    console.log('handleToggleMute called, isInVoice:', state.isInVoice);
    
    if (!state.isInVoice) {
        alert('No estás en un canal de voz');
        return;
    }
    
    state.isMuted = !state.isMuted;
    console.log('Mute toggled:', state.isMuted);
    
    // Call LiveKit to mute/unmute
    if (window.livekitClient && window.livekitClient.setMuted) {
        window.livekitClient.setMuted(state.isMuted);
    }
    
    updateVoiceControlsUI();
}

// Toggle deafen (mute speakers)
function handleToggleDeaf() {
    console.log('handleToggleDeaf called, isInVoice:', state.isInVoice);
    
    if (!state.isInVoice) {
        alert('No estás en un canal de voz');
        return;
    }
    
    state.isDeafened = !state.isDeafened;
    console.log('Deafen toggled:', state.isDeafened);
    
    // Call LiveKit to mute/unmute audio
    if (window.livekitClient && window.livekitClient.setDeafened) {
        window.livekitClient.setDeafened(state.isDeafened);
    }
    
    updateVoiceControlsUI();
}

// Update voice controls UI based on state
function updateVoiceControlsUI() {
    console.log('updateVoiceControlsUI called, isInVoice:', state.isInVoice);
    
    const muteBtn = document.getElementById('mute-mic-btn');
    const deafBtn = document.getElementById('deaf-btn');
    const joinBtn = document.getElementById('join-voice-btn');
    const leaveBtn = document.getElementById('leave-voice-btn');
    
    if (!muteBtn || !deafBtn || !joinBtn || !leaveBtn) {
        console.warn('Voice control buttons not found in DOM');
        return;
    }
    
    if (state.isInVoice) {
        // Show controls when in voice
        joinBtn.classList.add('hidden');
        leaveBtn.classList.remove('hidden');
        muteBtn.classList.remove('hidden');
        deafBtn.classList.remove('hidden');
        
        // Update mute button style - using .active class
        if (state.isMuted) {
            muteBtn.classList.add('active');
            muteBtn.innerHTML = '🔇';
            muteBtn.title = 'Activar micrófono';
        } else {
            muteBtn.classList.remove('active');
            muteBtn.innerHTML = '🎤';
            muteBtn.title = 'Silenciar micrófono';
        }
        
        // Update deafen button style
        if (state.isDeafened) {
            deafBtn.classList.add('active');
            deafBtn.innerHTML = '🔇';
            deafBtn.title = 'Activar sonido';
        } else {
            deafBtn.classList.remove('active');
            deafBtn.innerHTML = '🔊';
            deafBtn.title = 'Silenciar sonido';
        }
        
        console.log('Voice controls updated - in voice mode');
    } else {
        // Show join button when not in voice
        joinBtn.classList.remove('hidden');
        leaveBtn.classList.add('hidden');
        muteBtn.classList.add('hidden');
        deafBtn.classList.add('hidden');
        
        console.log('Voice controls updated - not in voice mode');
    }
}

function handleParticipantConnected(participant) {
    console.log('Participant connected event:', participant);
    
    // Get participant info - LiveKit participant object has identity (user_id) and name (username)
    const identity = participant.identity || 'Unknown';  // This is user_id as string
    const name = participant.name || identity;  // This is the username
    
    // Don't show notification for ourselves - compare user_id
    const localUserId = String(state.currentUser?.user_id || '');
    const localUsername = state.currentUser?.username || '';
    
    // Check by both identity (user_id) and name (username)
    if (identity === localUserId || name === localUsername) {
        console.log('Ignoring own connection event');
    } else {
        console.log('Participant joined:', name, '(identity:', identity, ')');
        showVoiceNotification(name + ' se unió al canal');
    }
    
    // Update participants list
    updateParticipantsList();
}

function handleParticipantDisconnected(participant) {
    console.log('[DISCONNECT] Participant disconnected event:', participant);
    
    // Get participant info
    const identity = participant.identity || 'Unknown';
    const name = participant.name || identity;
    
    console.log('[DISCONNECT] identity:', identity, 'name:', name);
    
    // Don't show notification for ourselves
    const localUserId = String(state.currentUser?.user_id || '');
    const localUsername = state.currentUser?.username || '';
    
    console.log('[DISCONNECT] localUserId:', localUserId, 'localUsername:', localUsername);
    
    if (identity === localUserId || name === localUsername) {
        console.log('[DISCONNECT] Ignoring own disconnect event');
    } else {
        console.log('[DISCONNECT] Participant left:', name, '(identity:', identity, ')');
        showVoiceNotification(name + ' salió del canal');
    }
    
    // Update participants list
    updateParticipantsList();
}

// Show voice notification
function showVoiceNotification(message) {
    const notifArea = document.getElementById('voice-notifications');
    if (!notifArea) return;
    
    // Create notification element
    const div = document.createElement('div');
    div.className = 'p-2 bg-gray-700 rounded mb-1 text-green-400 text-sm animate-pulse';
    div.textContent = '🔔 ' + message;
    
    // Add to notifications area
    notifArea.appendChild(div);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (div.parentNode) {
            div.parentNode.removeChild(div);
        }
    }, 5000);
    
    console.log('Notification shown:', message);
}

function updateParticipantsList() {
    const elements = getElements();
    if (!elements.participantsList) return;
    
    try {
        const lc = window.livekitClient;
        
        console.log('[PARTICIPANTS] Updating list...');
        
        // Get local participant - need to get REAL-TIME state from room
        let localIsSpeaking = false;
        let localIdentity = null;
        let localName = null;
        
        // Try to get local participant from different sources
        if (lc) {
            if (lc.room && lc.room.localParticipant) {
                const localP = lc.room.localParticipant;
                localIsSpeaking = localP.isSpeaking;
                localIdentity = localP.identity;
                localName = localP.name || localP.identity;
            } else if (lc.localParticipant) {
                // Fallback to client property
                const localP = lc.localParticipant;
                localIsSpeaking = localP.isSpeaking;
                localIdentity = localP.identity;
                localName = localP.name || localP.identity;
            }
        }
        
        console.log('[PARTICIPANTS] Local participant:', localIdentity, localName);
        
        // Get remote participants from the room directly
        console.log('[PARTICIPANTS] lc.room:', lc?.room);
        console.log('[PARTICIPANTS] room.remoteParticipants:', lc?.room?.remoteParticipants);
        console.log('[PARTICIPANTS] room.participants:', lc?.room?.participants);
        
        const remoteParticipants = lc && lc.getParticipants ? lc.getParticipants() : [];
        console.log('[PARTICIPANTS] Remote count:', remoteParticipants.length);
        remoteParticipants.forEach(p => {
            console.log('[PARTICIPANTS] Remote:', p.identity, p.name);
        });
        
        elements.participantsList.innerHTML = '';
        
        const allParts = [];
        
        // Get current user info - try to get from LiveKit if state is null
        let currentUserId = String(state.currentUser?.user_id || '');
        let currentUsername = state.currentUser?.username || '';
        
        // If state.currentUser is null, try to get from LiveKit token
        if (!currentUsername && window.livekitClient && window.livekitClient.room && window.livekitClient.room.localParticipant) {
            const lp = window.livekitClient.room.localParticipant;
            currentUsername = lp.name || lp.identity || '';
            currentUserId = lp.identity || '';
        }
        
        console.log('[PARTICIPANTS] ======');
        console.log('[PARTICIPANTS] state.currentUser:', state.currentUser);
        console.log('[PARTICIPANTS] Current user:', currentUserId, currentUsername);
        console.log('[PARTICIPANTS] state.isInVoice:', state.isInVoice, 'state.leftVoice:', state.leftVoice);
        
        // If we left voice (leftVoice = true), don't add ourselves
        if (state.leftVoice) {
            console.log('[PARTICIPANTS] LEFT - not adding self');
        }
        // If we're actively in voice (not left), show ourselves
        else if (state.isInVoice && currentUsername) {
            allParts.push({
                identity: currentUserId,
                name: currentUsername,
                isLocal: true,
                isSpeaking: localIsSpeaking,
                avatar_url: state.currentUser?.avatar_url || localStorage.getItem('voice_chat_avatar_url')
            });
            console.log('[PARTICIPANTS] Added self');
        } else {
            console.log('[PARTICIPANTS] Not adding self - no username or not in voice');
        }
        
        // Add remote participants - get REAL-TIME isSpeaking from each
        if (remoteParticipants) {
            remoteParticipants.forEach(p => {
                // Get live isSpeaking state directly from participant
                const isSpeaking = p.isSpeaking || false;
                allParts.push({
                    identity: p.identity,
                    name: p.name || p.identity,
                    isLocal: false,
                    isSpeaking: isSpeaking
                });
            });
        }
        
        // Detect if someone left (compare with previous list)
        if (previousParticipants.length > allParts.length) {
            // Someone left - find who
            const currentIds = allParts.map(p => p.identity);
            const leftParticipant = previousParticipants.find(p => !currentIds.includes(p.identity));
            if (leftParticipant) {
                console.log('[PARTICIPANTS] Someone left:', leftParticipant.name);
                showVoiceNotification(leftParticipant.name + ' salió del canal');
            }
        }
        
        // Update previous participants for next check
        previousParticipants = [...allParts];
        
        // If we're in voice AND we haven't left, we should always see ourselves
        // But if leftVoice = true (observer mode), we should NOT appear
        if (state.isInVoice && !state.leftVoice && !allParts.find(p => p.isLocal)) {
            allParts.unshift({
                identity: String(state.currentUser?.user_id || ''),
                name: state.currentUser?.username || 'Unknown',
                isLocal: true,
                isSpeaking: false,
                avatar_url: state.currentUser?.avatar_url || localStorage.getItem('voice_chat_avatar_url')
            });
        }
        
        if (allParts.length === 0 || (allParts.length === 1 && allParts[0].identity === 'null')) {
            elements.participantsList.innerHTML = '<div class="text-gray-400 p-2">No other participants</div>';
            // Still show ourselves
            if (state.isInVoice) {
                const initial = (state.currentUser?.username || 'U').charAt(0).toUpperCase();
                const avatarUrl = state.currentUser?.avatar_url || localStorage.getItem('voice_chat_avatar_url');
                
                let avatarHtml = '';
                if (avatarUrl) {
                    const avatarSrc = avatarUrl.startsWith('http') ? avatarUrl : 'https://voice-chat-production-a794.up.railway.app' + avatarUrl;
                    avatarHtml = `<img src="${avatarSrc}" alt="${state.currentUser?.username}" class="member-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="member-avatar" style="display:none">${initial}</div>`;
                } else {
                    avatarHtml = `<div class="member-avatar">${initial}</div>`;
                }
                
                const div = document.createElement('div');
                div.className = 'member-item';
                div.innerHTML = `
                    <div class="member-avatar-container">${avatarHtml}</div>
                    <div class="member-info">
                        <div class="member-name">${state.currentUser?.username || 'You'} (tu)</div>
                        <div class="member-status"><span>🟢</span> Conectado</div>
                    </div>
                `;
                elements.participantsList.appendChild(div);
            }
            return;
        }
        
        allParts.forEach(p => {
            console.log('[RENDER] Rendering participant:', p.name, 'isLocal:', p.isLocal, 'avatar:', p.avatar_url);
            const div = document.createElement('div');
            div.className = 'member-item';
            
            // Get first letter of username
            const initial = p.name.charAt(0).toUpperCase();
            
            // Check if participant has avatar
            let avatarHtml = '';
            if (p.avatar_url) {
                const avatarSrc = p.avatar_url.startsWith('http') ? p.avatar_url : 'https://voice-chat-production-a794.up.railway.app' + p.avatar_url;
                avatarHtml = `<img src="${avatarSrc}" alt="${p.name}" class="member-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="member-avatar" style="display:none">${initial}</div>`;
            } else {
                avatarHtml = `<div class="member-avatar">${initial}</div>`;
            }
            
            // Status icons
            let statusIcon = '🟢';
            if (p.isLocal && state.isMuted) statusIcon = '🔇';
            else if (p.isSpeaking) statusIcon = '🟢';
            else statusIcon = '⚪';
            
            // Name with "(you)" tag
            const nameDisplay = p.isLocal ? p.name + ' (tú)' : p.name;
            
            // Speaking class
            const speakingClass = p.isSpeaking ? 'speaking' : '';
            
            div.innerHTML = `
                <div class="member-avatar-container" style="${p.isSpeaking ? 'border: 2px solid #4caf50;' : ''}">${avatarHtml}</div>
                <div class="member-info">
                    <div class="member-name">${nameDisplay}</div>
                    <div class="member-status ${speakingClass}">
                        <span>${statusIcon}</span>
                        <span>${p.isSpeaking ? 'Hablando' : 'Conectado'}</span>
                    </div>
                </div>
            `;
            
            elements.participantsList.appendChild(div);
        });
    } catch (e) {
        console.warn('Could not update participants:', e);
        elements.participantsList.innerHTML = '<div class="text-gray-400 p-2">Connected to voice</div>';
    }
}

// Modal helpers
function showModal(modal) { modal.classList.remove('hidden'); }
function hideModal(modal) { modal.classList.add('hidden'); }

// Global error handler to catch any errors
window.onerror = function(msg, url, lineNo, columnNo, error) {
    console.error('Global error:', msg, 'at line', lineNo);
    return false;
};

// Track URL changes to detect navigation
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        console.log('URL changed from', lastUrl, 'to', url);
        lastUrl = url;
    }
}).observe(document, { subtree: true, childList: true });

// Prevent form submission from reloading the page
window.addEventListener('beforeunload', function(e) {
    console.log('Page about to unload');
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);

// Modal functions for new UI
function showCreateGroupModal() {
    document.getElementById('create-group-modal').classList.remove('hidden');
}

function hideCreateGroupModal() {
    document.getElementById('create-group-modal').classList.add('hidden');
}

function showCreateChannelModal() {
    document.getElementById('create-channel-modal').classList.remove('hidden');
}

function hideCreateChannelModal() {
    document.getElementById('create-channel-modal').classList.add('hidden');
}

// ==================== EDIT GROUP ====================

function showEditGroupModal() {
    if (!state.selectedGroup) return;
    
    document.getElementById('edit-group-id').value = state.selectedGroup.id;
    document.getElementById('edit-group-name').value = state.selectedGroup.name;
    document.getElementById('edit-group-modal').classList.remove('hidden');
}

function hideEditGroupModal() {
    document.getElementById('edit-group-modal').classList.add('hidden');
}

async function handleEditGroup(e) {
    e.preventDefault();
    
    const groupId = document.getElementById('edit-group-id').value;
    const name = document.getElementById('edit-group-name').value;
    
    try {
        await API.groups.update(groupId, { name: name });
        
        // Update local state
        state.selectedGroup.name = name;
        
        // Reload groups
        await loadGroups();
        
        hideEditGroupModal();
        alert('Grupo actualizado!');
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function deleteGroup() {
    if (!state.selectedGroup) return;
    
    if (!confirm('¿Estás seguro de eliminar este grupo? Esta acción no se puede deshacer.')) {
        return;
    }
    
    try {
        await API.groups.delete(state.selectedGroup.id);
        
        // Clear selection
        state.selectedGroup = null;
        state.selectedChannel = null;
        
        // Reload groups
        await loadGroups();
        
        hideEditGroupModal();
        alert('Grupo eliminado!');
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// ==================== EDIT CHANNEL ====================

function showEditChannelModal(channel) {
    if (!channel) return;
    
    document.getElementById('edit-channel-id').value = channel.id;
    document.getElementById('edit-channel-name').value = channel.name;
    document.getElementById('edit-channel-type').value = channel.type;
    document.getElementById('edit-channel-modal').classList.remove('hidden');
}

function hideEditChannelModal() {
    document.getElementById('edit-channel-modal').classList.add('hidden');
}

async function handleEditChannel(e) {
    e.preventDefault();
    
    const channelId = document.getElementById('edit-channel-id').value;
    const name = document.getElementById('edit-channel-name').value;
    const type = document.getElementById('edit-channel-type').value;
    
    try {
        await API.channels.update(channelId, { name: name, type: type });
        
        // Update local state
        if (state.selectedChannel && state.selectedChannel.id == channelId) {
            state.selectedChannel.name = name;
            state.selectedChannel.type = type;
        }
        
        // Reload channels
        if (state.selectedGroup) {
            const channels = await API.channels.list(state.selectedGroup.id);
            renderChannels(channels);
        }
        
        hideEditChannelModal();
        alert('Canal actualizado!');
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function deleteChannel() {
    const channelId = document.getElementById('edit-channel-id').value;
    
    if (!confirm('¿Estás seguro de eliminar este canal? Esta acción no se puede deshacer.')) {
        return;
    }
    
    try {
        await API.channels.delete(channelId);
        
        // Clear selection if this channel was selected
        if (state.selectedChannel && state.selectedChannel.id == channelId) {
            state.selectedChannel = null;
        }
        
        // Reload channels
        if (state.selectedGroup) {
            const channels = await API.channels.list(state.selectedGroup.id);
            renderChannels(channels);
        }
        
        hideEditChannelModal();
        alert('Canal eliminado!');
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Make loadGroups global
window.loadGroups = loadGroups;
window.handleLogout = handleLogout;
window.showEditGroupModal = showEditGroupModal;
window.hideEditGroupModal = hideEditGroupModal;
window.deleteGroup = deleteGroup;
window.showEditChannelModal = showEditChannelModal;
window.hideEditChannelModal = hideEditChannelModal;
window.deleteChannel = deleteChannel;

// ==================== SETTINGS ====================

// Audio test variables
let mediaRecorder = null;
let audioChunks = [];
let testAudioBlob = null;
let testAudioElement = null;

// Settings state
const settingsState = {
    inputDevice: null,
    outputDevice: null,
    inputVolume: 100,
    outputVolume: 100,
    noiseSuppression: false,
    echoCancellation: true
};

// Show Settings Modal
function showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    
    // Load user profile data
    loadProfileSettings();
    
    // Load audio devices
    loadAudioDevices();
    
    // Load appearance settings
    loadAppearanceSettings();
    
    // Load notification settings
    loadNotificationSettings();
    
    // Load privacy settings
    loadPrivacySettings();
}

// Hide Settings Modal
function hideSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
}

// Handle Logout
function handleLogout() {
    if (confirm('¿Querés cerrar sesión?')) {
        // Clear state
        state.currentUser = null;
        state.groups = [];
        state.selectedGroup = null;
        state.selectedChannel = null;
        state.isInVoice = false;
        state.isMuted = false;
        state.isDeafened = false;
        
        // Clear localStorage
        localStorage.removeItem('voice_chat_token');
        localStorage.removeItem('voice_chat_username');
        localStorage.removeItem('voice_chat_user_id');
        localStorage.removeItem('voice_chat_avatar_url');
        
        // Clear API token
        API.clearAuthToken();
        
        // Disconnect from voice if connected
        if (window.livekitClient) {
            window.livekitClient.disconnect();
            window.livekitClient = null;
        }
        
        // Disconnect WebSocket if connected
        if (wsClient && wsClient.isConnected()) {
            wsClient.disconnect();
        }
        
        // Hide settings modal if open
        hideSettingsModal();
        
        // Show auth view
        showAuthView();
        
        console.log('Logged out successfully');
    }
}

// Switch Settings Tabs
function switchSettingsTab(tabName) {
    // Update nav items
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.tab === tabName) {
            item.classList.add('active');
        }
    });
    
    // Update tab content
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById('settings-tab-' + tabName).classList.add('active');
}

// ==================== PROFILE SETTINGS ====================

// Load profile settings from API
async function loadProfileSettings() {
    try {
        const response = await fetch('https://voice-chat-production-a794.up.railway.app/users/me', {
            headers: {
                'Authorization': 'Bearer ' + API.getAuthToken()
            }
        });
        
        if (!response.ok) throw new Error('Failed to load profile');
        
        const user = await response.json();
        
        // Update UI
        document.getElementById('settings-username').value = user.username || '';
        document.getElementById('settings-avatar-url').value = user.avatar_url || '';
        document.getElementById('settings-bio').value = user.bio || '';
        document.getElementById('settings-username-display').textContent = user.username || 'Usuario';
        
        // Update avatar
        const avatarImg = document.getElementById('settings-avatar');
        if (user.avatar_url) {
            avatarImg.src = user.avatar_url.startsWith('http') ? user.avatar_url : 'https://voice-chat-production-a794.up.railway.app' + user.avatar_url;
        } else {
            // Default avatar with first letter
            avatarImg.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%234080d0"/><text x="50" y="65" text-anchor="middle" fill="white" font-size="40">' + (user.username?.charAt(0).toUpperCase() || 'U') + '</text></svg>';
        }
        
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

// Save profile settings
async function saveProfileSettings() {
    try {
        const username = document.getElementById('settings-username').value;
        const avatar_url = document.getElementById('settings-avatar-url').value;
        const bio = document.getElementById('settings-bio').value;
        
        const response = await fetch('https://voice-chat-production-a794.up.railway.app/users/me', {
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + API.getAuthToken(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: username,
                avatar_url: avatar_url,
                bio: bio
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            alert('Error: ' + (error.detail || 'Failed to save profile'));
            return;
        }
        
        const user = await response.json();
        
        // Update local state
        state.currentUser.username = user.username;
        state.currentUser.avatar_url = user.avatar_url;
        
        // Update localStorage
        localStorage.setItem('voice_chat_username', user.username);
        if (user.avatar_url) {
            localStorage.setItem('voice_chat_avatar_url', user.avatar_url);
        }
        
        // Update UI
        document.getElementById('settings-username-display').textContent = user.username;
        
        alert('Perfil guardado correctamente!');
        hideSettingsModal();
        
    } catch (error) {
        console.error('Error saving profile:', error);
        alert('Error al guardar el perfil');
    }
}

// Handle avatar URL change
function handleAvatarUrlChange(url) {
    if (url) {
        const avatarImg = document.getElementById('settings-avatar');
        avatarImg.src = url;
    }
}

// Handle avatar upload
async function handleAvatarUpload(input) {
    const file = input.files[0];
    if (!file) return;
    
    // Preview
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('settings-avatar').src = e.target.result;
    };
    reader.readAsDataURL(file);
    
    // Upload to server
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('https://voice-chat-production-a794.up.railway.app/users/me/avatar', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + API.getAuthToken()
            },
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            alert('Error uploading: ' + (error.detail || 'Failed to upload'));
            return;
        }
        
        const data = await response.json();
        console.log('Avatar uploaded, URL:', data.avatar_url);
        
        // Update the input with the full URL
        const fullUrl = 'https://voice-chat-production-a794.up.railway.app' + data.avatar_url;
        document.getElementById('settings-avatar-url').value = fullUrl;
        
        // Auto-save the profile
        await saveProfileSettings();
        
    } catch (error) {
        console.error('Error uploading avatar:', error);
    }
}

// ==================== AUDIO SETTINGS ====================

// Load audio devices
async function loadAudioDevices() {
    try {
        // Request permission first
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const inputSelect = document.getElementById('settings-input-device');
        const outputSelect = document.getElementById('settings-output-device');
        
        inputSelect.innerHTML = '<option value="">Seleccionar micrófono...</option>';
        outputSelect.innerHTML = '<option value="">Seleccionar altavoz...</option>';
        
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || device.kind;
            
            if (device.kind === 'audioinput') {
                inputSelect.appendChild(option);
            } else if (device.kind === 'audiooutput') {
                outputSelect.appendChild(option);
            }
        });
        
        // Load saved preferences
        const savedInput = localStorage.getItem('voice_chat_input_device');
        const savedOutput = localStorage.getItem('voice_chat_output_device');
        
        if (savedInput) inputSelect.value = savedInput;
        if (savedOutput) outputSelect.value = savedOutput;
        
    } catch (error) {
        console.error('Error loading audio devices:', error);
        document.getElementById('settings-input-device').innerHTML = '<option value="">Error al cargar dispositivos</option>';
        document.getElementById('settings-output-device').innerHTML = '<option value="">Error al cargar dispositivos</option>';
    }
}

// Handle input device change
function handleInputDeviceChange(deviceId) {
    settingsState.inputDevice = deviceId;
    localStorage.setItem('voice_chat_input_device', deviceId);
}

// Handle output device change
function handleOutputDeviceChange(deviceId) {
    settingsState.outputDevice = deviceId;
    localStorage.setItem('voice_chat_output_device', deviceId);
    
    // Set sink ID if supported
    if (testAudioElement && typeof testAudioElement.setSinkId === 'function') {
        testAudioElement.setSinkId(deviceId);
    }
}

// Handle input volume change
function handleInputVolumeChange(value) {
    settingsState.inputVolume = value;
    document.getElementById('input-volume-value').textContent = value;
    localStorage.setItem('voice_chat_input_volume', value);
}

// Handle output volume change
function handleOutputVolumeChange(value) {
    settingsState.outputVolume = value;
    document.getElementById('output-volume-value').textContent = value;
    localStorage.setItem('voice_chat_output_volume', value);
    
    // Adjust test audio if playing
    if (testAudioElement) {
        testAudioElement.volume = value / 100;
    }
}

// Start microphone test
async function startMicTest() {
    try {
        const deviceId = settingsState.inputDevice || localStorage.getItem('voice_chat_input_device');
        
        const constraints = {
            audio: deviceId ? { deviceId: { exact: deviceId } } : true
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            testAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            
            // Play the recording
            const url = URL.createObjectURL(testAudioBlob);
            testAudioElement = new Audio(url);
            
            // Set output device
            if (typeof testAudioElement.setSinkId === 'function') {
                const outputDevice = settingsState.outputDevice || localStorage.getItem('voice_chat_output_device');
                if (outputDevice) {
                    await testAudioElement.setSinkId(outputDevice);
                }
            }
            
            // Set volume
            testAudioElement.volume = settingsState.outputVolume / 100;
            
            document.getElementById('mic-test-status').textContent = 'Reproduciendo...';
            document.getElementById('mic-test-status').className = 'mic-test-status playing';
            
            testAudioElement.play();
            
            testAudioElement.onended = () => {
                document.getElementById('mic-test-status').textContent = 'Test completado';
                document.getElementById('mic-test-status').className = 'mic-test-status';
                stream.getTracks().forEach(track => track.stop());
            };
        };
        
        mediaRecorder.start();
        
        document.getElementById('test-mic-btn').classList.add('hidden');
        document.getElementById('stop-mic-btn').classList.remove('hidden');
        document.getElementById('mic-test-status').textContent = 'Grabando... Haz clic en Detener cuandoTermines';
        document.getElementById('mic-test-status').className = 'mic-test-status recording';
        
    } catch (error) {
        console.error('Error testing microphone:', error);
        document.getElementById('mic-test-status').textContent = 'Error: ' + error.message;
    }
}

// Stop microphone test
function stopMicTest() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    document.getElementById('test-mic-btn').classList.remove('hidden');
    document.getElementById('stop-mic-btn').classList.add('hidden');
}

// ==================== APPEARANCE SETTINGS ====================

// Load appearance settings
function loadAppearanceSettings() {
    const theme = localStorage.getItem('voice_chat_theme') || 'dark';
    const fontSize = localStorage.getItem('voice_chat_font_size') || 'medium';
    
    document.getElementById('settings-theme').value = theme;
    document.getElementById('settings-font-size').value = fontSize;
}

// Handle theme change
function handleThemeChange(theme) {
    localStorage.setItem('voice_chat_theme', theme);
    
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    } else {
        document.body.classList.remove('light-theme');
    }
}

// Handle font size change
function handleFontSizeChange(size) {
    localStorage.setItem('voice_chat_font_size', size);
    
    document.body.classList.remove('font-small', 'font-medium', 'font-large');
    document.body.classList.add('font-' + size);
}

// ==================== PRIVACY SETTINGS ====================

// Load privacy settings
function loadPrivacySettings() {
    const status = localStorage.getItem('voice_chat_privacy_status') || 'everyone';
    const voiceActivity = localStorage.getItem('voice_chat_privacy_voice_activity');
    const readReceipts = localStorage.getItem('voice_chat_privacy_read_receipts');
    const typing = localStorage.getItem('voice_chat_privacy_typing');
    const msgRequests = localStorage.getItem('voice_chat_privacy_msg_requests');
    const fileSize = localStorage.getItem('voice_chat_privacy_file_size') || '10';
    
    document.getElementById('settings-privacy-status').value = status;
    document.getElementById('settings-privacy-voice-activity').checked = voiceActivity !== 'false';
    document.getElementById('settings-privacy-read-receipts').checked = readReceipts !== 'false';
    document.getElementById('settings-privacy-typing').checked = typing !== 'false';
    document.getElementById('settings-privacy-msg-requests').checked = msgRequests !== 'false';
    document.getElementById('settings-privacy-file-size').value = fileSize;
}

// Save privacy settings
function savePrivacySettings() {
    const status = document.getElementById('settings-privacy-status').value;
    const voiceActivity = document.getElementById('settings-privacy-voice-activity').checked;
    const readReceipts = document.getElementById('settings-privacy-read-receipts').checked;
    const typing = document.getElementById('settings-privacy-typing').checked;
    const msgRequests = document.getElementById('settings-privacy-msg-requests').checked;
    const fileSize = document.getElementById('settings-privacy-file-size').value;
    
    localStorage.setItem('voice_chat_privacy_status', status);
    localStorage.setItem('voice_chat_privacy_voice_activity', voiceActivity);
    localStorage.setItem('voice_chat_privacy_read_receipts', readReceipts);
    localStorage.setItem('voice_chat_privacy_typing', typing);
    localStorage.setItem('voice_chat_privacy_msg_requests', msgRequests);
    localStorage.setItem('voice_chat_privacy_file_size', fileSize);
    
    alert('Configuración de privacidad guardada!');
}

// Check if user can see your status
function canSeeYourStatus(viewerId) {
    const status = localStorage.getItem('voice_chat_privacy_status') || 'everyone';
    
    if (status === 'everyone') return true;
    if (status === 'nobody') return false;
    // 'friends' would require friend system - for now, treat as everyone
    return true;
}

// Check if should show typing indicator
function shouldShowTyping() {
    const typing = localStorage.getItem('voice_chat_privacy_typing');
    return typing !== 'false';
}

// Check if should show read receipts
function shouldShowReadReceipts() {
    const readReceipts = localStorage.getItem('voice_chat_privacy_read_receipts');
    return readReceipts !== 'false';
}

// Save appearance settings
function saveAppearanceSettings() {
    const theme = document.getElementById('settings-theme').value;
    const fontSize = document.getElementById('settings-font-size').value;
    
    handleThemeChange(theme);
    handleFontSizeChange(fontSize);
    
    alert('Configuración de apariencia guardada!');
}

// ==================== NOTIFICATIONS SETTINGS ====================

// Load notification settings
function loadNotificationSettings() {
    const enabled = localStorage.getItem('voice_chat_notifications_enabled');
    const sound = localStorage.getItem('voice_chat_notification_sound');
    const mentions = localStorage.getItem('voice_chat_notification_mentions');
    const messages = localStorage.getItem('voice_chat_notification_messages');
    
    document.getElementById('settings-notifications-enabled').checked = enabled !== 'false';
    document.getElementById('settings-notification-sound').checked = sound !== 'false';
    document.getElementById('settings-notification-mentions').checked = mentions !== 'false';
    document.getElementById('settings-notification-messages').checked = messages === 'true';
    
    // Request notification permission if enabled
    if (enabled === 'true' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// Save notification settings
function saveNotificationSettings() {
    const enabled = document.getElementById('settings-notifications-enabled').checked;
    const sound = document.getElementById('settings-notification-sound').checked;
    const mentions = document.getElementById('settings-notification-mentions').checked;
    const messages = document.getElementById('settings-notification-messages').checked;
    
    localStorage.setItem('voice_chat_notifications_enabled', enabled);
    localStorage.setItem('voice_chat_notification_sound', sound);
    localStorage.setItem('voice_chat_notification_mentions', mentions);
    localStorage.setItem('voice_chat_notification_messages', messages);
    
    // Request notification permission if enabling
    if (enabled && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    // Show notification permission status
    if (enabled && 'Notification' in window) {
        if (Notification.permission === 'granted') {
            alert('Notificaciones guardadas! ✅');
        } else if (Notification.permission === 'denied') {
            alert('Notificaciones guardadas pero bloqueadas. Habilítalas en tu navegador.');
        } else {
            alert('Notificaciones guardadas. Haz click en "Permitir" cuando el navegador lo pida.');
        }
    } else {
        alert('Configuración de notificaciones guardada!');
    }
}

// Test notification
function testNotification() {
    const currentUsername = state.currentUser?.username || localStorage.getItem('voice_chat_username');
    
    showBrowserNotification(
        '🔔 Notificación de prueba',
        'Las notificaciones están funcionando correctamente!',
        null
    );
    
    // Also play sound
    playNotificationSound();
}

// Show browser notification
function showBrowserNotification(title, body, icon) {
    const enabled = localStorage.getItem('voice_chat_notifications_enabled');
    const sound = localStorage.getItem('voice_chat_notification_sound');
    
    console.log('[NOTIFICATION] Enabled:', enabled, 'Sound:', sound);
    
    if (enabled === 'false') {
        console.log('[NOTIFICATION] Notifications disabled');
        return;
    }
    
    // Play sound if enabled
    if (sound !== 'false') {
        console.log('[NOTIFICATION] Playing sound');
        playNotificationSound();
    }
    
    // Show browser notification if permitted
    if ('Notification' in window) {
        console.log('[NOTIFICATION] Notification API available, permission:', Notification.permission);
        
        if (Notification.permission === 'granted') {
            new Notification(title, {
                body: body,
                icon: icon || '/favicon.ico'
            });
            console.log('[NOTIFICATION] Notification shown');
        } else if (Notification.permission === 'default') {
            // Request permission
            Notification.requestPermission().then(permission => {
                console.log('[NOTIFICATION] Permission requested:', permission);
                if (permission === 'granted') {
                    new Notification(title, {
                        body: body,
                        icon: icon || '/favicon.ico'
                    });
                }
            });
        } else {
            console.log('[NOTIFICATION] Notifications blocked by browser');
        }
    } else {
        console.log('[NOTIFICATION] Notification API not available');
    }
}

// Play notification sound
function playNotificationSound() {
    // Simple beep using Web Audio API
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.1;
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
        console.log('Could not play notification sound:', e);
    }
}

// Check if should notify for message (handle mentions)
function shouldNotifyForMessage(message, currentUsername) {
    // Get values, default to false if not set
    const mentions = localStorage.getItem('voice_chat_notification_mentions');
    const messages = localStorage.getItem('voice_chat_notification_messages');
    const enabled = localStorage.getItem('voice_chat_notifications_enabled');
    
    console.log('[NOTIFY CHECK] enabled:', enabled, 'mentions:', mentions, 'messages:', messages);
    
    // If notifications are explicitly disabled, return false
    if (enabled === 'false') return false;
    
    // If enabled is not set (undefined) or is 'true', check other settings
    // Check for mentions
    if (mentions === 'true' && message.includes('@' + currentUsername)) {
        console.log('[NOTIFY CHECK] Mention detected!');
        return true;
    }
    
    // Check for all messages (if explicitly enabled)
    if (messages === 'true') {
        console.log('[NOTIFY CHECK] All messages enabled!');
        return true;
    }
    
    return false;
}

// ==================== INIT APPEARANCE ====================

// Apply saved appearance on load
function initAppearance() {
    const theme = localStorage.getItem('voice_chat_theme') || 'dark';
    const fontSize = localStorage.getItem('voice_chat_font_size') || 'medium';
    
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    }
    
    document.body.classList.add('font-' + fontSize);
}

// Call init appearance on load
initAppearance();