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
    myRole: 'member', // Current user's role in selected group: "owner", "admin", "member"
};

// Expose state globally so livekit.js can check observer mode
window.appState = state;

console.log('Initial state:', state);

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'error', duration = 4000) {
    // Remove existing toast
    const existing = document.getElementById('app-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = `app-toast app-toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️'}</span>
        <span class="toast-message">${message}</span>
    `;
    document.body.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => toast.classList.add('show'));
    
    // Auto-remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Permission helpers
function canCreateChannel() {
    return state.myRole === 'owner' || state.myRole === 'admin';
}
function canEditGroup() {
    return state.myRole === 'owner' || state.myRole === 'admin';
}
function canKickMembers() {
    return state.myRole === 'owner' || state.myRole === 'admin';
}
function canManageRoles() {
    return state.myRole === 'owner';
}

// DOM Elements - use function to get them when DOM is ready
function getElements() {
    return {
        // Auth view
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
        
        // Sidebars
        serversList: document.getElementById('servers-list'),
        currentServerName: document.getElementById('current-server-name'),
        channelsList: document.getElementById('channels-list'),
        
        // Buttons
        createGroupBtn: document.getElementById('create-group-btn'),
        createChannelBtn: document.getElementById('create-channel-btn'),
        inviteUserBtn: document.getElementById('invite-user-btn'),
        editServerBtn: document.getElementById('edit-server-btn'),
        
        // Main content
        selectedChannelName: document.getElementById('selected-channel-name'),
        textChat: document.getElementById('text-chat'),
        voiceChat: document.getElementById('voice-chat'),
        messagesList: document.getElementById('messages-list'),
        messageInput: document.getElementById('message-input'),
        voiceContainer: document.getElementById('voice-container'),
        emptyState: document.getElementById('empty-state'),
        bottomMessageArea: document.getElementById('bottom-message-area'),
        
        // Bottom controls
        userDisplayName: document.getElementById('user-display-name'),
        userAvatar: document.getElementById('user-avatar'),
        userInitial: document.getElementById('user-initial'),
        muteMicBtn: document.getElementById('mute-mic-btn'),
        muteAudioBtn: document.getElementById('mute-audio-btn'),
        screenShareBtn: document.getElementById('screen-share-btn'),
        joinVoiceBtn: document.getElementById('join-voice-btn'),
        leaveVoiceBtn: document.getElementById('leave-voice-btn'),
        
        // Members / participants section
        membersSection: document.getElementById('members-section'),
        membersList: document.getElementById('members-list'),
        // Backwards-compatible: some code references 'participants-list'
        participantsList: document.getElementById('participants-list') || document.getElementById('members-list'),
        
        // Modals
        createGroupModal: document.getElementById('create-group-modal'),
        createGroupForm: document.getElementById('create-group-form'),
        groupNameInput: document.getElementById('group-name-input'),
        editGroupModal: document.getElementById('edit-group-modal'),
        editGroupForm: document.getElementById('edit-group-form'),
        editGroupId: document.getElementById('edit-group-id'),
        editGroupName: document.getElementById('edit-group-name'),
        createChannelModal: document.getElementById('create-channel-modal'),
        createChannelForm: document.getElementById('create-channel-form'),
        channelGroupId: document.getElementById('channel-group-id'),
        channelNameInput: document.getElementById('channel-name-input'),
        channelTypeInput: document.getElementById('channel-type-input'),
        editChannelModal: document.getElementById('edit-channel-modal'),
        editChannelForm: document.getElementById('edit-channel-form'),
        editChannelId: document.getElementById('edit-channel-id'),
        editChannelName: document.getElementById('edit-channel-name'),
        inviteUserModal: document.getElementById('invite-user-modal'),
        inviteUserForm: document.getElementById('invite-user-form'),
        inviteUsernameInput: document.getElementById('invite-username-input'),
        settingsModal: document.getElementById('settings-modal'),
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

// Ensure the voice container exists on startup so livekit can attach audio elements
(function ensureVoiceContainer(){
    try {
        if (!document.getElementById('voice-container')) {
            const c = document.createElement('div');
            c.id = 'voice-container';
            // Keep it visually hidden but available for audio elements
            c.style.position = 'fixed';
            c.style.width = '1px';
            c.style.height = '1px';
            c.style.overflow = 'hidden';
            c.style.pointerEvents = 'none';
            c.style.bottom = '0';
            c.style.right = '0';
            document.body.appendChild(c);
            console.log('[APP] Created #voice-container fallback');
        }
    } catch (e) {
        console.warn('[APP] Failed to ensure #voice-container:', e);
    }
})();

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
    // Chat - send message via bottom bar input
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessageFromInput();
            }
        });
    }
    if (elements.joinVoiceBtn) elements.joinVoiceBtn.addEventListener('click', handleJoinVoice);
    if (elements.leaveVoiceBtn) elements.leaveVoiceBtn.addEventListener('click', handleLeaveVoice);
    
    // Voice controls - mute/deafen - get directly from DOM
    document.getElementById('mute-mic-btn')?.addEventListener('click', () => {
        console.log('Mute button clicked');
        handleToggleMute();
    });
    document.getElementById('mute-audio-btn')?.addEventListener('click', () => {
        console.log('Deaf button clicked');
        handleToggleDeaf();
    });
    document.getElementById('screen-share-btn')?.addEventListener('click', () => {
        console.log('Screen share button clicked');
        handleToggleScreenShare();
    });
    document.getElementById('screen-share-close-btn')?.addEventListener('click', () => {
        console.log('Screen share close button clicked');
        hideScreenShareView();
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
    // Screen share callbacks
    window.livekitCallbacks.onScreenShareStarted = handleRemoteScreenShareStarted;
    window.livekitCallbacks.onScreenShareStopped = handleRemoteScreenShareStopped;
    window.livekitCallbacks.onLocalScreenShareStarted = handleLocalScreenShareStarted;
    window.livekitCallbacks.onLocalScreenShareStopped = handleLocalScreenShareStopped;
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
    updateUserDisplay();
    loadGroups();
    
    // Connect global DM notification WebSocket
    connectDMNotificationWS();
    
    // Auto-refresh groups every 30 seconds to detect new invites
    setInterval(() => {
        if (state.currentUser) {
            loadGroups();
        }
    }, 30000);
}

// Update user display in bottom control bar
function updateUserDisplay() {
    if (!state.currentUser) return;
    
    const elements = getElements();
    const username = state.currentUser.username || 'Usuario';
    const initial = username.charAt(0).toUpperCase();
    
    if (elements.userDisplayName) {
        elements.userDisplayName.textContent = username;
    }
    if (elements.userInitial) {
        elements.userInitial.textContent = initial;
    }
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
// Render groups as server buttons in left sidebar
function renderGroups() {
    const serversList = document.getElementById('servers-list');
    
    if (!serversList) return;
    
    serversList.innerHTML = '';
    
    // Render each group as a button in the servers sidebar
    state.groups.forEach(group => {
        const btn = document.createElement('button');
        btn.className = 'server-btn' + (state.selectedGroup?.id === group.id ? ' active' : '');
        btn.type = 'button';
        btn.title = group.name;
        
        // Get initial of group name
        const initial = group.name.charAt(0).toUpperCase();
        btn.textContent = initial;
        
        btn.onclick = () => selectGroup(group);
        serversList.appendChild(btn);
    });
    
    // Auto-select first group if none selected
    if (state.groups.length > 0) {
        if (!state.selectedGroup || !state.groups.find(g => g.id === state.selectedGroup.id)) {
            console.log('Selecting first group:', state.groups[0]);
            selectGroup(state.groups[0]);
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
    
    // Sort: owner first, then admins, then members
    const roleOrder = { owner: 0, admin: 1, member: 2 };
    const sorted = [...members].sort((a, b) => (roleOrder[a.role] || 2) - (roleOrder[b.role] || 2));
    
    // Clear and render members
    membersList.innerHTML = '';
    
    sorted.forEach(member => {
        const div = document.createElement('div');
        div.className = 'member-item';
        
        // Check if member has avatar
        const initial = member.username.charAt(0).toUpperCase();
        let avatarHtml = '';
        
        if (member.avatar_url) {
            const avatarSrc = member.avatar_url.startsWith('http') ? member.avatar_url : 'https://voice-chat-production-a794.up.railway.app' + member.avatar_url;
            avatarHtml = `<img src="${avatarSrc}" alt="${member.username}" class="member-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="member-avatar" style="display:none">${initial}</div>`;
        } else {
            avatarHtml = `<div class="member-avatar">${initial}</div>`;
        }
        
        // Role badge
        const role = member.role || 'member';
        let roleBadge = '';
        if (role === 'owner') {
            roleBadge = '<span class="role-badge role-owner" title="Owner">👑</span>';
        } else if (role === 'admin') {
            roleBadge = '<span class="role-badge role-admin" title="Admin">🛡️</span>';
        }
        
        // Check if it's the current user
        const isCurrentUser = member.id === state.currentUser?.user_id;
        const nameDisplay = isCurrentUser ? member.username + ' (tú)' : member.username;
        
        // Action buttons (only for owner/admin managing others)
        let actionsHtml = '';
        if (!isCurrentUser && (canManageRoles() || canKickMembers())) {
            let actionButtons = '';
            
            // Owner can promote/demote
            if (canManageRoles() && role !== 'owner') {
                if (role === 'member') {
                    actionButtons += `<button class="member-action-btn promote-btn" onclick="handlePromoteMember(${member.id}, '${member.username}')" title="Promote to Admin">⬆️</button>`;
                } else if (role === 'admin') {
                    actionButtons += `<button class="member-action-btn demote-btn" onclick="handleDemoteMember(${member.id}, '${member.username}')" title="Demote to Member">⬇️</button>`;
                }
            }
            
            // Owner/Admin can kick (but not owner, and admin can't kick admin)
            if (canKickMembers() && role !== 'owner') {
                if (state.myRole === 'owner' || (state.myRole === 'admin' && role === 'member')) {
                    actionButtons += `<button class="member-action-btn kick-btn" onclick="handleKickMember(${member.id}, '${member.username}')" title="Kick">🚫</button>`;
                }
            }
            
            if (actionButtons) {
                actionsHtml = `<div class="member-actions">${actionButtons}</div>`;
            }
        }
        
        div.innerHTML = `
            <div class="member-avatar-container">${avatarHtml}</div>
            <div class="member-info">
                <div class="member-name">${roleBadge}${nameDisplay}</div>
                <div class="member-status">
                    <span class="role-label role-label-${role}">${role}</span>
                </div>
            </div>
            ${actionsHtml}
        `;
        
        membersList.appendChild(div);
    });
    
    console.log('Members rendered:', members.length);
}

// Select group
async function selectGroup(group) {
    console.log('selectGroup called with:', group);
    
    // Switch back from DM mode to server mode
    hideDMView();
    
    state.selectedGroup = group;
    state.selectedChannel = null;
    const elements = getElements();
    console.log('currentServerName element:', elements.currentServerName);
    console.log('Setting currentServerName to:', group.name);
    if (elements.currentServerName) {
        elements.currentServerName.textContent = group.name;
        console.log('After setting, textContent is:', elements.currentServerName.textContent);
    } else {
        console.error('currentServerName element not found!');
    }
    // Don't show create/edit buttons yet — wait for role detection in members load below
    
    // Show invite button
    if (elements.inviteUserBtn) {
        elements.inviteUserBtn.classList.remove('hidden');
    }
    
    // Load members for this group
    console.log('Loading members for group:', group.id);
    try {
        if (API?.groups?.getMembers) {
            const members = await API.groups.getMembers(group.id);
            console.log('Members loaded:', members);
            
            // Detect current user's role
            const myMember = members.find(m => m.id === state.currentUser?.user_id);
            state.myRole = myMember?.role || 'member';
            console.log('My role in this group:', state.myRole);
            
            renderMembers(members);
            
            // Show/hide admin controls based on role
            if (canCreateChannel()) {
                elements.createChannelBtn.classList.remove('hidden');
            } else {
                elements.createChannelBtn.classList.add('hidden');
            }
            if (canEditGroup()) {
                elements.editServerBtn.classList.remove('hidden');
            } else {
                elements.editServerBtn.classList.add('hidden');
            }
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
    elements.emptyState.classList.remove('hidden');
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
            
            // Add voice participants container below this channel
            const participantsDiv = document.createElement('div');
            participantsDiv.className = 'voice-channel-participants';
            participantsDiv.id = 'voice-participants-ch-' + channel.id;
            categoryDiv.appendChild(participantsDiv);
            
            // Load participants for this voice channel
            loadChannelVoiceParticipants(channel.id);
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

// Load voice participants for a specific channel and render in sidebar
async function loadChannelVoiceParticipants(channelId) {
    try {
        const participants = await API.channels.getVoiceParticipants(channelId);
        const container = document.getElementById('voice-participants-ch-' + channelId);
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!participants || participants.length === 0) return;
        
        participants.forEach(p => {
            const isCurrentUser = p.user_id === state.currentUser?.user_id;
            const initial = p.username.charAt(0).toUpperCase();
            const nameDisplay = isCurrentUser ? p.username + ' (vos)' : p.username;
            
            const item = document.createElement('div');
            item.className = 'voice-participant-item';
            
            let avatarHtml = '';
            if (p.avatar_url) {
                const avatarSrc = p.avatar_url.startsWith('http') ? p.avatar_url : 'https://voice-chat-production-a794.up.railway.app' + p.avatar_url;
                avatarHtml = `<img src="${avatarSrc}" alt="${p.username}" class="voice-participant-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="voice-participant-avatar">${initial}</div>`;
            } else {
                avatarHtml = `<div class="voice-participant-avatar">${initial}</div>`;
            }
            
            item.innerHTML = `${avatarHtml}<span class="voice-participant-name">${nameDisplay}</span>`;
            container.appendChild(item);
        });
    } catch (e) {
        console.log('[VOICE] Error loading participants for channel', channelId, e);
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
        elements.emptyState.classList.add('hidden');
        // Show message input in bottom bar
        if (elements.bottomMessageArea) elements.bottomMessageArea.classList.remove('hidden');
        window.wsClient.connect(channel.id);
    } else {
        elements.textChat.classList.add('hidden');
        elements.voiceChat.classList.remove('hidden');
        elements.emptyState.classList.add('hidden');
        // Hide message input in bottom bar
        if (elements.bottomMessageArea) elements.bottomMessageArea.classList.add('hidden');
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
// Show invite user modal
function showInviteUserModal() {
    if (!state.selectedGroup) {
        alert('Selecciona un grupo primero');
        return;
    }
    
    const modal = document.getElementById('invite-user-modal');
    document.getElementById('invite-username-input').value = '';
    modal.classList.remove('hidden');
    document.getElementById('invite-username-input').focus();
}

// Hide invite user modal
function hideInviteUserModal() {
    const modal = document.getElementById('invite-user-modal');
    modal.classList.add('hidden');
}

// Handle invite user form submission
async function handleInviteUserSubmit(e) {
    e.preventDefault();
    
    if (!state.selectedGroup) {
        alert('Selecciona un grupo primero');
        return;
    }
    
    const username = document.getElementById('invite-username-input').value.trim();
    if (!username) {
        alert('Por favor ingresa un nombre de usuario');
        return;
    }
    
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
        hideInviteUserModal();
    } catch (error) {
        alert('Error al convidar: ' + error.message);
    }
}

// OLD FUNCTION (deprecated, keeping for reference)
async function handleInviteUser() {
    if (!state.selectedGroup) {
        alert('Selecciona un grupo primero');
        return;
    }
    
    // Now use the modal instead of prompt
    showInviteUserModal();
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
        showToast(error.message || 'No se pudo crear el canal', 'error');
    }
}

// ==================== ROLE MANAGEMENT ====================

async function handlePromoteMember(userId, username) {
    if (!confirm(`¿Promover a ${username} a Admin?`)) return;
    try {
        await API.groups.updateMemberRole(state.selectedGroup.id, userId, 'admin');
        showToast(`${username} ahora es Admin 🛡️`, 'success');
        // Refresh members
        const members = await API.groups.getMembers(state.selectedGroup.id);
        renderMembers(members);
    } catch (error) {
        showToast(error.message || 'Error al promover', 'error');
    }
}

async function handleDemoteMember(userId, username) {
    if (!confirm(`¿Quitar Admin a ${username}?`)) return;
    try {
        await API.groups.updateMemberRole(state.selectedGroup.id, userId, 'member');
        showToast(`${username} ahora es Member`, 'success');
        const members = await API.groups.getMembers(state.selectedGroup.id);
        renderMembers(members);
    } catch (error) {
        showToast(error.message || 'Error al degradar', 'error');
    }
}

async function handleKickMember(userId, username) {
    if (!confirm(`¿Expulsar a ${username} del grupo?`)) return;
    try {
        await API.groups.kickMember(state.selectedGroup.id, userId);
        showToast(`${username} fue expulsado del grupo`, 'success');
        const members = await API.groups.getMembers(state.selectedGroup.id);
        renderMembers(members);
    } catch (error) {
        showToast(error.message || 'Error al expulsar', 'error');
    }
}

// Message operations

// Send message from bottom bar input (called by Enter key and send button)
function sendMessageFromInput() {
    const input = document.getElementById('message-input');
    if (!input) return;
    
    const content = input.value.trim();
    if (!content) return;
    
    if (!state.selectedChannel || state.selectedChannel.type !== 'text') return;
    
    const message = {
        channel_id: state.selectedChannel.id,
        content: content,
        sender_id: state.currentUser?.user_id || parseInt(localStorage.getItem('voice_chat_user_id') || '0'),
        sender_username: state.currentUser?.username || localStorage.getItem('voice_chat_username') || "Anonymous"
    };
    
    console.log('Sending message:', message);
    window.wsClient.send(JSON.stringify(message));
    input.value = '';
}

// Global function for onclick button
window.sendMessage = sendMessageFromInput;

async function handleMessageSubmit(e, elements) {
    e.preventDefault();
    sendMessageFromInput();
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
    // Prevent re-entrant join attempts without disabling the UI button
    if (state.joining) {
        console.log('[JOIN] Join already in progress, ignoring duplicate click');
        return;
    }

    state.joining = true;
    window.appState = state;

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
        console.log('[JOIN] livekitClient exists:', !!window.livekitClient);
        console.log('[JOIN] livekitClient object:', window.livekitClient);

        if (!window.livekitClient || !window.livekitClient.connect) {
            console.error('[JOIN] livekitClient not loaded!', window.livekitClient);
            alert('Error: LiveKit client not loaded. Please refresh the page.');
            return;
        }

        // If a connect is already in progress inside the livekit client, wait for it
        if (window.livekitClient._connecting) {
            console.log('[JOIN] livekitClient._connecting is true - waiting up to 3s for it to finish');
            const start = Date.now();
            while (window.livekitClient._connecting && Date.now() - start < 3000) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise(r => setTimeout(r, 100));
            }
            if (window.livekitClient._connecting) {
                console.warn('[JOIN] previous connect still in progress after wait - aborting this join');
                throw new Error('Connect already in progress');
            }
            // If the room is already connected by the previous call, skip connect
            if (window.livekitClient.room && window.livekitClient.room.state === 'connected') {
                console.log('[JOIN] Room already connected from previous attempt - skipping connect()');
            } else {
                await window.livekitClient.connect(tokenData.url, tokenData.token);
            }
        } else {
            await window.livekitClient.connect(tokenData.url, tokenData.token);
        }
        console.log('[JOIN] Connected to LiveKit!');

        // Check room state
        const room = window.livekitClient.room;
        console.log('[JOIN] Room state:', room?.state);
        console.log('[JOIN] Room name:', room?.name);
        console.log('[JOIN] Local participant identity:', room?.localParticipant?.identity);
        console.log('[JOIN] Local participant name:', room?.localParticipant?.name);

        // Try to publish microphone, only if connected
        try {
            if (window.livekitClient.room && window.livekitClient.room.state === 'connected') {
                console.log('[JOIN] Publishing microphone...');
                await window.livekitClient.publishMicrophone();
                console.log('[JOIN] Microphone published!');
            } else {
                console.warn('[JOIN] Room not connected yet, skipping publishMicrophone');
            }
        } catch (micError) {
            console.warn('[JOIN] Microphone access error:', micError?.message || micError);
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
         console.error('[JOIN] Full error:', error);
         console.error('[JOIN] Error message:', error.message);
         console.error('[JOIN] Error stack:', error.stack);
         alert('No se pudo unir a voz: ' + error.message + '\n\nRevisa la consola (F12) para más detalles.');
     } finally {
         // Clear joining flag so user can try again
         state.joining = false;
         window.appState = state;
         console.log('[JOIN] joining flag cleared');
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
    
    // Update every 3000ms (was 100ms — reduced to stop console spam)
    if (participantsUpdateInterval) clearInterval(participantsUpdateInterval);
    
    participantsUpdateInterval = setInterval(() => {
        // Keep updating even if left voice - to see who's still there
        if (state.isInVoice) {
            // Get current participants (quiet — no logging)
            let currentParticipants = [];
            
            if (window.livekitClient && window.livekitClient.room) {
                const remoteParticipants = window.livekitClient.getParticipants();
                
                if (remoteParticipants.length > 0) {
                    window.livekitClient.knownParticipants = remoteParticipants;
                    currentParticipants = remoteParticipants;
                }
            }
            updateParticipantsList();
        }
    }, 3000);
    
    // Heartbeat: re-join every 2 minutes to refresh joined_at (prevents stale cleanup)
    if (window.voiceHeartbeatInterval) clearInterval(window.voiceHeartbeatInterval);
    window.voiceHeartbeatInterval = setInterval(() => {
        if (state.isInVoice && state.selectedChannel) {
            API.channels.joinVoice(state.selectedChannel.id).catch(() => {});
        }
    }, 120000); // 2 minutes
}

function stopParticipantsUpdateInterval() {
    if (participantsUpdateInterval) {
        clearInterval(participantsUpdateInterval);
        participantsUpdateInterval = null;
    }
    if (window.voiceHeartbeatInterval) {
        clearInterval(window.voiceHeartbeatInterval);
        window.voiceHeartbeatInterval = null;
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
    if (document.getElementById('screen-share-btn')) document.getElementById('screen-share-btn').classList.add('hidden');
    
    // Hide screen share view if visible
    hideScreenShareView();
    
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
            // Also update sidebar
            loadChannelVoiceParticipants(state.selectedChannel.id);
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
        
        // Also update sidebar participants
        loadChannelVoiceParticipants(state.selectedChannel.id);
        
    } catch (e) {
        console.log('[VOICE DB] Error getting participants:', e);
    }
}

// Toggle mute microphone
async function handleToggleMute() {
    console.log('[MUTE-BTN] handleToggleMute called, isInVoice:', state.isInVoice, 'isMuted:', state.isMuted);
    
    if (!state.isInVoice) {
        alert('No estás en un canal de voz');
        return;
    }
    
    state.isMuted = !state.isMuted;
    console.log('[MUTE-BTN] Mute toggled TO:', state.isMuted);
    
    // Debug: check livekitClient
    console.log('[MUTE-BTN] livekitClient:', !!window.livekitClient);
    console.log('[MUTE-BTN] setMuted function:', typeof window.livekitClient?.setMuted);
    
    // Call LiveKit to mute/unmute — AWAIT the async call
    if (window.livekitClient && window.livekitClient.setMuted) {
        console.log('[MUTE-BTN] Calling window.livekitClient.setMuted (awaiting)...');
        try {
            await window.livekitClient.setMuted(state.isMuted);
            console.log('[MUTE-BTN] setMuted COMPLETED');
        } catch (e) {
            console.error('[MUTE-BTN] setMuted ERROR:', e);
        }
    } else {
        console.error('[MUTE-BTN] livekitClient.setMuted not available!');
    }
    
    updateVoiceControlsUI();
}

// Alias for button onclick handlers
window.toggleMuteMic = handleToggleMute;
window.toggleMuteAudio = handleToggleDeaf;
window.joinVoiceChannel = handleJoinVoice;
window.leaveVoiceChannel = handleLeaveVoice;

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
    const deafBtn = document.getElementById('mute-audio-btn');
    const joinBtn = document.getElementById('join-voice-btn');
    const leaveBtn = document.getElementById('leave-voice-btn');
    const screenBtn = document.getElementById('screen-share-btn');
    
    if (!muteBtn || !deafBtn || !joinBtn || !leaveBtn) {
        console.warn('Voice control buttons not found in DOM', { muteBtn, deafBtn, joinBtn, leaveBtn });
        return;
    }
    
    if (state.isInVoice) {
        // Show controls when in voice
        joinBtn.classList.add('hidden');
        leaveBtn.classList.remove('hidden');
        muteBtn.classList.remove('hidden');
        deafBtn.classList.remove('hidden');
        if (screenBtn) screenBtn.classList.remove('hidden');
        
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
        
        // Update screen share button style
        if (screenBtn) {
            if (window.livekitClient && window.livekitClient.isScreenSharing()) {
                screenBtn.classList.add('active');
                screenBtn.innerHTML = '🖥️';
                screenBtn.title = 'Dejar de compartir pantalla';
            } else {
                screenBtn.classList.remove('active');
                screenBtn.innerHTML = '🖥️';
                screenBtn.title = 'Compartir pantalla';
            }
        }
        
        console.log('Voice controls updated - in voice mode');
    } else {
        // Show join button when not in voice
        joinBtn.classList.remove('hidden');
        leaveBtn.classList.add('hidden');
        muteBtn.classList.add('hidden');
        deafBtn.classList.add('hidden');
        if (screenBtn) screenBtn.classList.add('hidden');
        
        console.log('Voice controls updated - not in voice mode');
    }
}

// ==========================================
// SCREEN SHARE — Toggle, Display, Callbacks
// ==========================================

// Toggle screen share on/off
async function handleToggleScreenShare() {
    console.log('[SCREEN-UI] handleToggleScreenShare called, isInVoice:', state.isInVoice);
    
    if (!state.isInVoice) {
        alert('No estás en un canal de voz');
        return;
    }
    
    if (!window.livekitClient) {
        console.error('[SCREEN-UI] livekitClient not available');
        return;
    }
    
    try {
        if (window.livekitClient.isScreenSharing()) {
            // Stop sharing
            await window.livekitClient.stopScreenShare();
            console.log('[SCREEN-UI] Screen share stopped');
        } else {
            // Start sharing
            const started = await window.livekitClient.startScreenShare();
            if (started) {
                console.log('[SCREEN-UI] Screen share started');
            } else {
                console.log('[SCREEN-UI] Screen share cancelled by user');
            }
        }
        updateVoiceControlsUI();
    } catch (error) {
        console.error('[SCREEN-UI] Screen share error:', error);
        showToast('Error al compartir pantalla: ' + error.message, 'error');
    }
}

// When a remote participant starts sharing their screen
function handleRemoteScreenShareStarted(track, publication, participant) {
    console.log('[SCREEN-UI] Remote screen share started from:', participant.name || participant.identity);
    // Log publication dimensions from SFU
    if (publication && publication.dimensions) {
        console.log('[SCREEN-UI] SFU dimensions:', publication.dimensions.width, 'x', publication.dimensions.height);
    }
    showScreenShareView(track, publication, participant);
}

// When a remote participant stops sharing their screen
function handleRemoteScreenShareStopped(track, participant) {
    console.log('[SCREEN-UI] Remote screen share stopped from:', participant.name || participant.identity);
    hideScreenShareView();
}

// When WE start sharing our screen
function handleLocalScreenShareStarted() {
    console.log('[SCREEN-UI] Local screen share started');
    updateVoiceControlsUI();
    showToast('Compartiendo pantalla 🖥️', 'success');
}

// When WE stop sharing our screen
function handleLocalScreenShareStopped() {
    console.log('[SCREEN-UI] Local screen share stopped');
    updateVoiceControlsUI();
    hideScreenShareView();
    showToast('Dejaste de compartir pantalla', 'info');
}

// Show the expanded screen share view (Discord-style)
async function showScreenShareView(track, publication, participant) {
    const screenShareView = document.getElementById('screen-share-view');
    const videoContainer = document.getElementById('screen-share-video-container');
    const usernameLabel = document.getElementById('screen-share-username');
    const normalView = document.getElementById('voice-container');
    
    if (!screenShareView || !videoContainer) {
        console.error('[SCREEN-UI] Screen share view elements not found');
        return;
    }
    
    // Get target resolution from publication (SFU knows the source dimensions)
    const targetWidth = publication?.dimensions?.width || 1920;
    const targetHeight = publication?.dimensions?.height || 1080;
    console.log('[SCREEN-UI] Target resolution from SFU:', targetWidth, 'x', targetHeight);
    
    // CRITICAL: Show the screen share view FIRST (before attaching track)
    screenShareView.classList.remove('hidden');
    if (normalView) normalView.classList.add('hidden');
    
    // Wait one frame for the DOM to layout
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // Clear previous video
    videoContainer.innerHTML = '';
    
    // === ADAPTIVESTREAM BYPASS: Hidden high-quality element ===
    // LiveKit's adaptiveStream uses ResizeObserver to measure video element size.
    // If the visible element is constrained to 1366px, it requests 768p from the SFU.
    // Solution: create a HIDDEN video element at full resolution (2560x1440).
    // adaptiveStream measures THIS element and requests the high quality stream.
    // The visible element mirrors the stream and scales to fit.
    const hiddenEl = document.createElement('video');
    hiddenEl.style.cssText = `position:absolute;width:${targetWidth}px;height:${targetHeight}px;visibility:hidden;pointer-events:none;opacity:0;`;
    hiddenEl.autoplay = true;
    hiddenEl.playsInline = true;
    hiddenEl.muted = true;
    videoContainer.appendChild(hiddenEl);
    
    // Attach the track to the HIDDEN element — adaptiveStream measures this at full res
    track.attach(hiddenEl);
    console.log('[SCREEN-UI] Attached track to hidden element at', targetWidth, 'x', targetHeight);
    
    // Create the VISIBLE element that mirrors the stream
    const videoElement = document.createElement('video');
    videoElement.className = 'screen-share-video';
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.muted = true;
    videoElement.style.width = '100%';
    videoElement.style.height = '100%';
    videoElement.style.objectFit = 'contain';
    videoContainer.appendChild(videoElement);
    
    // Mirror the stream from hidden to visible element
    hiddenEl.addEventListener('loadedmetadata', () => {
        videoElement.srcObject = hiddenEl.srcObject;
        console.log('[SCREEN-UI] Stream mirrored — visible video dimensions:', videoElement.videoWidth, 'x', videoElement.videoHeight);
    });
    
    // Double-click for browser fullscreen
    videoElement.addEventListener('dblclick', () => {
        if (videoElement.requestFullscreen) {
            videoElement.requestFullscreen();
        } else if (videoElement.webkitRequestFullscreen) {
            videoElement.webkitRequestFullscreen();
        }
    });
    
    // Set who is sharing
    const displayName = participant.name || participant.identity || 'Alguien';
    if (usernameLabel) usernameLabel.textContent = displayName;
    
    // Build participant thumbnails in the bottom bar
    buildScreenShareThumbnails(participant.identity);
    
    console.log('[SCREEN-UI] Screen share view shown for:', displayName);
}

// Hide the expanded screen share view
function hideScreenShareView() {
    const screenShareView = document.getElementById('screen-share-view');
    const videoContainer = document.getElementById('screen-share-video-container');
    const normalView = document.getElementById('voice-container');
    
    if (screenShareView) {
        screenShareView.classList.add('hidden');
    }
    
    // Detach and clean up video elements
    if (videoContainer) {
        const videos = videoContainer.querySelectorAll('video');
        videos.forEach(v => {
            v.srcObject = null;
            v.remove();
        });
        videoContainer.innerHTML = '';
    }
    
    // Show normal voice view again
    if (normalView) normalView.classList.remove('hidden');
    
    console.log('[SCREEN-UI] Screen share view hidden');
}

// Build participant thumbnails at the bottom of screen share view
function buildScreenShareThumbnails(sharerIdentity) {
    const thumbContainer = document.getElementById('screen-share-participants');
    if (!thumbContainer) return;
    
    thumbContainer.innerHTML = '';
    
    // Get all participants (including local)
    const localParticipant = window.livekitClient?.getLocalParticipant();
    const remoteParticipants = window.livekitClient?.getParticipants() || [];
    
    // Build list of all participants
    const allParticipants = [];
    
    if (localParticipant) {
        allParticipants.push({
            identity: localParticipant.identity,
            name: localParticipant.name || localParticipant.identity,
            isLocal: true,
            isSharing: localParticipant.identity === sharerIdentity
        });
    }
    
    remoteParticipants.forEach(p => {
        allParticipants.push({
            identity: p.identity,
            name: p.name || p.identity,
            isLocal: false,
            isSharing: p.identity === sharerIdentity
        });
    });
    
    // Create thumbnails
    allParticipants.forEach(p => {
        const thumb = document.createElement('div');
        thumb.className = 'screen-share-thumb' + (p.isSharing ? ' sharing' : '');
        
        const initial = (p.name || '?').charAt(0).toUpperCase();
        thumb.innerHTML = `
            <div class="thumb-avatar">${initial}</div>
            <span class="thumb-name">${p.isLocal ? p.name + ' (vos)' : p.name}</span>
            ${p.isSharing ? '<span class="thumb-sharing-badge">🖥️</span>' : ''}
        `;
        
        thumbContainer.appendChild(thumb);
    });
}

// Expose screen share functions globally
window.handleToggleScreenShare = handleToggleScreenShare;

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
    // Clean up voice participant from database
    if (state.isInVoice && state.selectedChannel) {
        // Use sendBeacon for reliable delivery on page close
        const token = localStorage.getItem('token');
        if (token) {
            const url = API_BASE + '/channels/' + state.selectedChannel.id + '/voice/leave';
            navigator.sendBeacon(url, '');
            // sendBeacon doesn't support auth headers, so also try fetch with keepalive
            fetch(url, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                keepalive: true
            }).catch(() => {});
        }
    }
    // Disconnect LiveKit
    if (window.livekitClient && window.livekitClient.disconnect) {
        window.livekitClient.disconnect();
    }
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
    
    // Show danger zone only for owner
    const dangerZone = document.getElementById('edit-group-danger-zone');
    if (dangerZone) {
        if (state.myRole === 'owner') {
            dangerZone.classList.remove('hidden');
        } else {
            dangerZone.classList.add('hidden');
        }
    }
    
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
    
    // Always start on profile tab
    switchSettingsTab('profile');
    
    // Load user profile data
    loadProfileSettings();
    
    // Load audio devices
    loadAudioDevices();
    
    // Load audio settings from localStorage
    loadAudioSettings();
    
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
    // Update tab buttons (highlight active)
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    // Find the clicked button by matching tab name in onclick
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        if (btn.getAttribute('onclick')?.includes("'" + tabName + "'")) {
            btn.classList.add('active');
        }
    });
    
    // Hide all tabs, show selected
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.add('hidden');
    });
    const activeTab = document.getElementById('settings-tab-' + tabName);
    if (activeTab) {
        activeTab.classList.remove('hidden');
    }
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
        
        // Update UI (with null checks for elements that may not exist)
        const usernameEl = document.getElementById('settings-username');
        const avatarUrlEl = document.getElementById('settings-avatar-url');
        const bioEl = document.getElementById('settings-bio');
        const usernameDisplayEl = document.getElementById('settings-username-display');
        
        if (usernameEl) usernameEl.value = user.username || '';
        if (avatarUrlEl) avatarUrlEl.value = user.avatar_url || '';
        if (bioEl) bioEl.value = user.bio || '';
        if (usernameDisplayEl) usernameDisplayEl.textContent = user.username || 'Usuario';
        
        // Update avatar
        const avatarImg = document.getElementById('settings-avatar');
        if (avatarImg && user.avatar_url) {
            avatarImg.src = user.avatar_url.startsWith('http') ? user.avatar_url : 'https://voice-chat-production-a794.up.railway.app' + user.avatar_url;
        } else if (avatarImg) {
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
        const username = document.getElementById('settings-username')?.value || '';
        const avatar_url = document.getElementById('settings-avatar-url')?.value || '';
        const bio = document.getElementById('settings-bio')?.value || '';
        
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
        const displayEl = document.getElementById('settings-username-display');
        if (displayEl) displayEl.textContent = user.username;
        
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
        if (avatarImg) avatarImg.src = url;
    }
}

// Handle avatar upload
async function handleAvatarUpload(input) {
    const file = input.files[0];
    if (!file) return;
    
    // Preview
    const reader = new FileReader();
    reader.onload = function(e) {
        const avatarImg = document.getElementById('settings-avatar');
        if (avatarImg) avatarImg.src = e.target.result;
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
        const avatarUrlInput = document.getElementById('settings-avatar-url');
        if (avatarUrlInput) avatarUrlInput.value = fullUrl;
        
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
    console.log('[VOLUME] handleInputVolumeChange called with value:', value);
    
    settingsState.inputVolume = value;
    document.getElementById('input-volume-value').textContent = value;
    localStorage.setItem('voice_chat_input_volume', value);
    
    // Update LiveKit volume in real-time if in voice
    console.log('[VOLUME] Checking livekitClient:', !!window.livekitClient);
    if (window.livekitClient && window.livekitClient.setInputVolume) {
        console.log('[VOLUME] Calling setInputVolume');
        window.livekitClient.setInputVolume(value);
    } else {
        console.log('[VOLUME] livekitClient not available or setInputVolume missing');
    }
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

// Save audio settings
function saveAudioSettings() {
    console.log('[SETTINGS] Saving audio settings...');
    
    // Get values from form (with null safety)
    settingsState.inputDevice = document.getElementById('settings-input-device')?.value || settingsState.inputDevice;
    settingsState.outputDevice = document.getElementById('settings-output-device')?.value || settingsState.outputDevice;
    settingsState.inputVolume = document.getElementById('settings-input-volume')?.value || settingsState.inputVolume;
    settingsState.outputVolume = document.getElementById('settings-output-volume')?.value || settingsState.outputVolume;
    settingsState.noiseSuppression = document.getElementById('settings-noise-suppression')?.checked ?? settingsState.noiseSuppression;
    settingsState.echoCancellation = document.getElementById('settings-echo-cancellation')?.checked ?? settingsState.echoCancellation;
    
    console.log('[SETTINGS] Values from form:', settingsState);
    
    // Save to localStorage
    localStorage.setItem('voice_chat_input_device', settingsState.inputDevice);
    localStorage.setItem('voice_chat_output_device', settingsState.outputDevice);
    localStorage.setItem('voice_chat_input_volume', settingsState.inputVolume);
    localStorage.setItem('voice_chat_output_volume', settingsState.outputVolume);
    localStorage.setItem('voice_chat_noise_suppression', String(settingsState.noiseSuppression));
    localStorage.setItem('voice_chat_echo_cancellation', String(settingsState.echoCancellation));
    
    console.log('[SETTINGS] Saved to localStorage');
    
    alert('Configuración de audio guardada');
}

// Apply audio settings to LiveKit
function applyAudioSettingsToLiveKit() {
    if (!window.livekitClient || !window.livekitClient.room) {
        console.log('No LiveKit room connected, settings will apply on next join');
        return;
    }
    
    const audioSettings = {
        noiseSuppression: settingsState.noiseSuppression,
        echoCancellation: settingsState.echoCancellation
    };
    
    console.log('Applying audio settings to LiveKit:', audioSettings);
    // LiveKit applies these settings automatically when the track is created
    // For now, just log - the actual settings are applied when publishing the mic
}

// Load audio settings when opening settings modal
function loadAudioSettings() {
    console.log('[SETTINGS] Loading audio settings from localStorage...');
    
    // Load from localStorage
    const inputDevice = localStorage.getItem('voice_chat_input_device');
    const outputDevice = localStorage.getItem('voice_chat_output_device');
    const inputVolume = localStorage.getItem('voice_chat_input_volume');
    const outputVolume = localStorage.getItem('voice_chat_output_volume');
    const noiseSuppression = localStorage.getItem('voice_chat_noise_suppression');
    const echoCancellation = localStorage.getItem('voice_chat_echo_cancellation');
    
    console.log('[SETTINGS] noiseSuppression from localStorage:', noiseSuppression, typeof noiseSuppression);
    console.log('[SETTINGS] echoCancellation from localStorage:', echoCancellation, typeof echoCancellation);
    
    // Update form values
    if (inputDevice) {
        const inputSelect = document.getElementById('settings-input-device');
        if (inputSelect) inputSelect.value = inputDevice;
    }
    if (outputDevice) {
        const outputSelect = document.getElementById('settings-output-device');
        if (outputSelect) outputSelect.value = outputDevice;
    }
    if (inputVolume) {
        const inputVolumeEl = document.getElementById('settings-input-volume');
        const inputVolumeLabel = document.getElementById('input-volume-value');
        if (inputVolumeEl) inputVolumeEl.value = inputVolume;
        if (inputVolumeLabel) inputVolumeLabel.textContent = inputVolume;
    }
    if (outputVolume) {
        const outputVolumeEl = document.getElementById('settings-output-volume');
        const outputVolumeLabel = document.getElementById('output-volume-value');
        if (outputVolumeEl) outputVolumeEl.value = outputVolume;
        if (outputVolumeLabel) outputVolumeLabel.textContent = outputVolume;
    }
    
    // Checkboxes - need proper default handling
    const noiseCheckbox = document.getElementById('settings-noise-suppression');
    const echoCheckbox = document.getElementById('settings-echo-cancellation');
    
    if (noiseCheckbox) {
        // If not set, default to false (no noise suppression)
        noiseCheckbox.checked = noiseSuppression === 'true';
    }
    if (echoCheckbox) {
        // If not set, default to true (echo cancellation on)
        echoCheckbox.checked = echoCancellation !== 'false';
    }
    
    // Update state
    settingsState.inputDevice = inputDevice;
    settingsState.outputDevice = outputDevice;
    settingsState.inputVolume = inputVolume || 100;
    settingsState.outputVolume = outputVolume || 100;
    settingsState.noiseSuppression = noiseSuppression === 'true';
    settingsState.echoCancellation = echoCancellation !== 'false';
    
    console.log('[SETTINGS] Loaded state:', settingsState);
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
            
            const statusEl = document.getElementById('mic-test-status');
            if (statusEl) {
                statusEl.textContent = 'Reproduciendo...';
                statusEl.className = 'mic-test-status playing';
            }
            
            testAudioElement.play();
            
            testAudioElement.onended = () => {
                const statusEl2 = document.getElementById('mic-test-status');
                if (statusEl2) {
                    statusEl2.textContent = 'Test completado';
                    statusEl2.className = 'mic-test-status';
                }
                stream.getTracks().forEach(track => track.stop());
            };
        };
        
        mediaRecorder.start();
        
        document.getElementById('test-mic-btn')?.classList.add('hidden');
        document.getElementById('stop-mic-btn')?.classList.remove('hidden');
        document.getElementById('mic-test-status')?.setAttribute('class', 'mic-test-status recording');
        const micStatusEl = document.getElementById('mic-test-status');
        if (micStatusEl) micStatusEl.textContent = 'Grabando... Haz clic en Detener cuando termines';
        
    } catch (error) {
        console.error('Error testing microphone:', error);
        const statusEl = document.getElementById('mic-test-status');
        if (statusEl) statusEl.textContent = 'Error: ' + error.message;
    }
}

// Stop microphone test
function stopMicTest() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    document.getElementById('test-mic-btn')?.classList.remove('hidden');
    document.getElementById('stop-mic-btn')?.classList.add('hidden');
}

// ==================== APPEARANCE SETTINGS ====================

// Load appearance settings
function loadAppearanceSettings() {
    const theme = localStorage.getItem('voice_chat_theme') || 'dark';
    const fontSize = localStorage.getItem('voice_chat_font_size') || 'medium';
    
    const themeEl = document.getElementById('settings-theme');
    const fontSizeEl = document.getElementById('settings-font-size');
    
    if (themeEl) themeEl.value = theme;
    if (fontSizeEl) fontSizeEl.value = fontSize;
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
    
    const el = (id) => document.getElementById(id);
    
    if (el('settings-privacy-status')) el('settings-privacy-status').value = status;
    if (el('settings-privacy-voice-activity')) el('settings-privacy-voice-activity').checked = voiceActivity !== 'false';
    if (el('settings-privacy-read-receipts')) el('settings-privacy-read-receipts').checked = readReceipts !== 'false';
    if (el('settings-privacy-typing')) el('settings-privacy-typing').checked = typing !== 'false';
    if (el('settings-privacy-msg-requests')) el('settings-privacy-msg-requests').checked = msgRequests !== 'false';
    if (el('settings-privacy-file-size')) el('settings-privacy-file-size').value = fileSize;
}

// Save privacy settings
function savePrivacySettings() {
    const el = (id) => document.getElementById(id);
    
    const status = el('settings-privacy-status')?.value ?? localStorage.getItem('voice_chat_privacy_status') ?? 'everyone';
    const voiceActivity = el('settings-privacy-voice-activity')?.checked ?? (localStorage.getItem('voice_chat_privacy_voice_activity') !== 'false');
    const readReceipts = el('settings-privacy-read-receipts')?.checked ?? (localStorage.getItem('voice_chat_privacy_read_receipts') !== 'false');
    const typing = el('settings-privacy-typing')?.checked ?? (localStorage.getItem('voice_chat_privacy_typing') !== 'false');
    const msgRequests = el('settings-privacy-msg-requests')?.checked ?? (localStorage.getItem('voice_chat_privacy_msg_requests') !== 'false');
    const fileSize = el('settings-privacy-file-size')?.value ?? localStorage.getItem('voice_chat_privacy_file_size') ?? '10';
    
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
    const theme = document.getElementById('settings-theme')?.value || 'dark';
    const fontSize = document.getElementById('settings-font-size')?.value || 'medium';
    
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
    
    const el = (id) => document.getElementById(id);
    if (el('settings-notifications-enabled')) el('settings-notifications-enabled').checked = enabled !== 'false';
    if (el('settings-notification-sound')) el('settings-notification-sound').checked = sound !== 'false';
    if (el('settings-notification-mentions')) el('settings-notification-mentions').checked = mentions !== 'false';
    if (el('settings-notification-messages')) el('settings-notification-messages').checked = messages === 'true';
    
    // Request notification permission if enabled
    if (enabled === 'true' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// Save notification settings
function saveNotificationSettings() {
    const el = (id) => document.getElementById(id);
    const enabled = el('settings-notifications-enabled')?.checked ?? (localStorage.getItem('voice_chat_notifications_enabled') !== 'false');
    const sound = el('settings-notification-sound')?.checked ?? (localStorage.getItem('voice_chat_notification_sound') !== 'false');
    const mentions = el('settings-notification-mentions')?.checked ?? (localStorage.getItem('voice_chat_notification_mentions') !== 'false');
    const messages = el('settings-notification-messages')?.checked ?? (localStorage.getItem('voice_chat_notification_messages') === 'true');
    
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

// ==================== DIRECT MESSAGES ====================

// DM state
state.isDMMode = false;
state.dmConversations = [];
state.selectedDMConversation = null;
state.dmWebSocket = null;
state.dmNotificationWS = null;
state.dmUnreadCounts = {};  // { conversation_id: count }
state.totalDMUnread = 0;

// Show DM view (called when clicking 💬 button)
function showDMView() {
    console.log('[DM] showDMView called');
    state.isDMMode = true;
    
    // Deselect servers
    document.querySelectorAll('.server-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('.dm-btn').classList.add('active');
    
    // Hide server views
    document.querySelector('.channels-sidebar').classList.add('hidden');
    document.querySelector('.main-content').classList.add('hidden');
    
    // Hide bottom message area (DM has its own input)
    const bottomMsg = document.getElementById('bottom-message-area');
    if (bottomMsg) bottomMsg.classList.add('hidden');
    
    // Show DM views
    document.getElementById('dm-sidebar').classList.remove('hidden');
    document.getElementById('dm-chat-area').classList.remove('hidden');
    
    // Load conversations
    loadDMConversations();
}

// Hide DM view (called when clicking a server button)
function hideDMView() {
    if (!state.isDMMode) return;
    console.log('[DM] hideDMView called');
    state.isDMMode = false;
    state.selectedDMConversation = null;
    
    // Disconnect DM WebSocket
    disconnectDMWebSocket();
    
    // Remove active from DM button
    document.querySelector('.dm-btn').classList.remove('active');
    
    // Hide DM views
    document.getElementById('dm-sidebar').classList.add('hidden');
    document.getElementById('dm-chat-area').classList.add('hidden');
    
    // Show server views
    document.querySelector('.channels-sidebar').classList.remove('hidden');
    document.querySelector('.main-content').classList.remove('hidden');
}

// Load DM conversations from API
async function loadDMConversations() {
    try {
        console.log('[DM] Loading conversations...');
        const conversations = await API.dm.listConversations();
        console.log('[DM] Conversations loaded:', conversations);
        state.dmConversations = conversations;
        renderDMConversations(conversations);
    } catch (error) {
        console.error('[DM] Failed to load conversations:', error);
    }
}

// Render DM conversations in sidebar
function renderDMConversations(conversations) {
    const list = document.getElementById('dm-conversations-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    if (!conversations || conversations.length === 0) {
        list.innerHTML = `
            <div class="dm-empty-state">
                <p>💬</p>
                <p>No tenés mensajes directos todavía</p>
                <button class="btn btn-primary" onclick="showNewDMModal()" style="margin-top: 12px;">Iniciar conversación</button>
            </div>
        `;
        return;
    }
    
    conversations.forEach(conv => {
        const item = document.createElement('div');
        const unreadCount = state.dmUnreadCounts[conv.id] || 0;
        let cls = 'dm-conversation-item';
        if (state.selectedDMConversation?.id === conv.id) cls += ' active';
        if (unreadCount > 0) cls += ' unread';
        item.className = cls;
        item.onclick = () => selectDMConversation(conv);
        
        const initial = conv.other_username.charAt(0).toUpperCase();
        let avatarHtml = '';
        if (conv.other_avatar_url) {
            const avatarSrc = conv.other_avatar_url.startsWith('http') ? conv.other_avatar_url : API_BASE + conv.other_avatar_url;
            avatarHtml = `<img src="${avatarSrc}" alt="${conv.other_username}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="dm-conversation-avatar" style="display:none">${initial}</div>`;
        } else {
            avatarHtml = '';
        }
        
        const timeStr = conv.last_message_at ? formatDMTimestamp(conv.last_message_at) : '';
        const lastMsg = conv.last_message || 'Sin mensajes todavía';
        const unreadBadge = unreadCount > 0 ? `<span class="dm-conversation-unread-badge">${unreadCount}</span>` : '';
        
        item.innerHTML = `
            <div class="dm-conversation-avatar">${avatarHtml || initial}</div>
            <div class="dm-conversation-info">
                <div class="dm-conversation-top">
                    <span class="dm-conversation-name">${conv.other_username}</span>
                    <span class="dm-conversation-time">${timeStr}</span>
                </div>
                <div class="dm-conversation-last-msg">${lastMsg}${unreadBadge}</div>
            </div>
        `;
        
        list.appendChild(item);
    });
}

// Filter DM conversations (search)
function filterDMConversations(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
        renderDMConversations(state.dmConversations);
        return;
    }
    const filtered = state.dmConversations.filter(c => 
        c.other_username.toLowerCase().includes(q)
    );
    renderDMConversations(filtered);
}

// Select a DM conversation
async function selectDMConversation(conv) {
    console.log('[DM] Selecting conversation:', conv);
    state.selectedDMConversation = conv;
    
    // Clear unread for this conversation
    if (state.dmUnreadCounts[conv.id]) {
        delete state.dmUnreadCounts[conv.id];
        recalcTotalUnread();
        updateDMBadge();
    }
    
    // Update sidebar active state
    document.querySelectorAll('.dm-conversation-item').forEach(item => item.classList.remove('active'));
    // Re-render to update active state
    renderDMConversations(state.dmConversations);
    
    // Update chat header
    const avatarEl = document.getElementById('dm-chat-avatar');
    const usernameEl = document.getElementById('dm-chat-username');
    const initialEl = document.getElementById('dm-chat-avatar-initial');
    
    if (usernameEl) usernameEl.textContent = conv.other_username;
    if (initialEl) initialEl.textContent = conv.other_username.charAt(0).toUpperCase();
    
    // Set avatar image if available
    if (avatarEl && conv.other_avatar_url) {
        const avatarSrc = conv.other_avatar_url.startsWith('http') ? conv.other_avatar_url : API_BASE + conv.other_avatar_url;
        avatarEl.innerHTML = `<img src="${avatarSrc}" alt="${conv.other_username}" onerror="this.style.display='none'; this.parentElement.innerHTML='<span>${conv.other_username.charAt(0).toUpperCase()}</span>';">`;
    } else if (avatarEl) {
        avatarEl.innerHTML = `<span>${conv.other_username.charAt(0).toUpperCase()}</span>`;
    }
    
    // Show input area
    const inputArea = document.getElementById('dm-input-area');
    if (inputArea) inputArea.style.display = 'flex';
    
    // Load messages
    await loadDMMessages(conv.id);
    
    // Connect DM WebSocket for real-time
    connectDMWebSocket(conv.id);
    
    // Focus input
    const input = document.getElementById('dm-message-input');
    if (input) input.focus();
}

// Load DM messages
async function loadDMMessages(conversationId) {
    try {
        console.log('[DM] Loading messages for conversation:', conversationId);
        const messages = await API.dm.getMessages(conversationId);
        console.log('[DM] Messages loaded:', messages.length);
        renderDMMessages(messages);
    } catch (error) {
        console.error('[DM] Failed to load messages:', error);
    }
}

// Render DM messages
function renderDMMessages(messages) {
    const container = document.getElementById('dm-messages-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        container.innerHTML = `
            <div class="dm-chat-empty-state">
                <p style="font-size: 48px;">👋</p>
                <p>Esta es la primera vez que hablás con este usuario. ¡Mandá un mensaje!</p>
            </div>
        `;
        return;
    }
    
    const currentUserId = state.currentUser?.user_id;
    
    messages.forEach(msg => {
        const div = document.createElement('div');
        const isOwn = msg.sender_id === currentUserId;
        div.className = 'dm-message' + (isOwn ? ' own-message' : '');
        
        const initial = msg.sender_username.charAt(0).toUpperCase();
        let avatarHtml = '';
        if (msg.sender_avatar_url) {
            const avatarSrc = msg.sender_avatar_url.startsWith('http') ? msg.sender_avatar_url : API_BASE + msg.sender_avatar_url;
            avatarHtml = `<img src="${avatarSrc}" alt="${msg.sender_username}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="dm-message-avatar" style="display:none">${initial}</div>`;
        }
        
        const timeStr = formatDMTimestamp(msg.created_at);
        
        div.innerHTML = `
            <div class="dm-message-avatar">${avatarHtml || initial}</div>
            <div class="dm-message-content">
                <div class="dm-message-header">
                    <span class="dm-message-author">${msg.sender_username}</span>
                    <span class="dm-message-time">${timeStr}</span>
                </div>
                <div class="dm-message-text">${escapeHtml(msg.content)}</div>
            </div>
        `;
        
        container.appendChild(div);
    });
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// Append a single DM message (for real-time)
function appendDMMessage(msg) {
    const container = document.getElementById('dm-messages-list');
    if (!container) return;
    
    // Remove empty state if present
    const emptyState = container.querySelector('.dm-chat-empty-state');
    if (emptyState) emptyState.remove();
    
    const currentUserId = state.currentUser?.user_id;
    const isOwn = msg.sender_id === currentUserId;
    
    const div = document.createElement('div');
    div.className = 'dm-message' + (isOwn ? ' own-message' : '');
    
    const initial = msg.sender_username.charAt(0).toUpperCase();
    let avatarHtml = '';
    if (msg.sender_avatar_url) {
        const avatarSrc = msg.sender_avatar_url.startsWith('http') ? msg.sender_avatar_url : API_BASE + msg.sender_avatar_url;
        avatarHtml = `<img src="${avatarSrc}" alt="${msg.sender_username}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="dm-message-avatar" style="display:none">${initial}</div>`;
    }
    
    const timeStr = formatDMTimestamp(msg.created_at);
    
    div.innerHTML = `
        <div class="dm-message-avatar">${avatarHtml || initial}</div>
        <div class="dm-message-content">
            <div class="dm-message-header">
                <span class="dm-message-author">${msg.sender_username}</span>
                <span class="dm-message-time">${timeStr}</span>
            </div>
            <div class="dm-message-text">${escapeHtml(msg.content)}</div>
        </div>
    `;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Send DM message
async function sendDMMessage() {
    const input = document.getElementById('dm-message-input');
    if (!input) return;
    
    const content = input.value.trim();
    if (!content) return;
    
    if (!state.selectedDMConversation) return;
    
    // Clear input immediately
    input.value = '';
    
    // If WebSocket is connected, send through it
    if (state.dmWebSocket && state.dmWebSocket.readyState === WebSocket.OPEN) {
        state.dmWebSocket.send(JSON.stringify({ content: content }));
        return;
    }
    
    // Fallback: send via REST API
    try {
        const msg = await API.dm.sendMessage(state.selectedDMConversation.id, content);
        appendDMMessage(msg);
        
        // Update last message in conversation list
        updateConversationLastMessage(state.selectedDMConversation.id, content);
    } catch (error) {
        console.error('[DM] Failed to send message:', error);
        alert('Error al enviar mensaje: ' + error.message);
        // Put content back
        input.value = content;
    }
}

// Update conversation last message in sidebar
function updateConversationLastMessage(convId, content) {
    const conv = state.dmConversations.find(c => c.id === convId);
    if (conv) {
        conv.last_message = content;
        conv.last_message_at = Math.floor(Date.now() / 1000);
        renderDMConversations(state.dmConversations);
    }
}

// DM WebSocket connection
function connectDMWebSocket(conversationId) {
    disconnectDMWebSocket();
    
    const token = API.getAuthToken();
    if (!token) return;
    
    // Build WebSocket URL
    const wsBase = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');
    const wsUrl = `${wsBase}/ws/dm/${conversationId}?token=${token}`;
    
    console.log('[DM-WS] Connecting to:', wsUrl);
    
    try {
        state.dmWebSocket = new WebSocket(wsUrl);
        
        state.dmWebSocket.onopen = () => {
            console.log('[DM-WS] Connected to conversation', conversationId);
        };
        
        state.dmWebSocket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                console.log('[DM-WS] Message received:', msg);
                
                if (msg.type === 'dm_message') {
                    appendDMMessage(msg);
                    updateConversationLastMessage(msg.conversation_id, msg.content);
                    // Hide typing indicator when a real message arrives
                    if (msg.sender_id !== state.currentUser?.user_id) {
                        hideTypingIndicator();
                    }
                } else if (msg.type === 'typing') {
                    // Show typing indicator (ignore own typing)
                    if (msg.sender_id !== state.currentUser?.user_id) {
                        showTypingIndicator(msg.sender_username);
                    }
                }
            } catch (e) {
                console.error('[DM-WS] Error parsing message:', e);
            }
        };
        
        state.dmWebSocket.onclose = (event) => {
            console.log('[DM-WS] Disconnected:', event.code, event.reason);
        };
        
        state.dmWebSocket.onerror = (error) => {
            console.error('[DM-WS] Error:', error);
        };
    } catch (e) {
        console.error('[DM-WS] Failed to connect:', e);
    }
}

function disconnectDMWebSocket() {
    if (state.dmWebSocket) {
        state.dmWebSocket.close();
        state.dmWebSocket = null;
    }
}

// ==================== DM NOTIFICATIONS ====================

// Connect global DM notification WebSocket (called once at app init)
function connectDMNotificationWS() {
    disconnectDMNotificationWS();
    
    const token = API.getAuthToken();
    if (!token) return;
    
    const wsBase = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');
    const wsUrl = `${wsBase}/ws/dm-notifications?token=${token}`;
    
    console.log('[DM-Notif] Connecting to:', wsUrl);
    
    try {
        state.dmNotificationWS = new WebSocket(wsUrl);
        
        state.dmNotificationWS.onopen = () => {
            console.log('[DM-Notif] Connected');
        };
        
        state.dmNotificationWS.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                console.log('[DM-Notif] Received:', msg);
                
                if (msg.type === 'dm_notification') {
                    handleDMNotification(msg);
                }
            } catch (e) {
                console.error('[DM-Notif] Error parsing:', e);
            }
        };
        
        state.dmNotificationWS.onclose = (event) => {
            console.log('[DM-Notif] Disconnected:', event.code);
            // Reconnect after 3 seconds (unless intentional close)
            if (event.code !== 1000) {
                setTimeout(() => {
                    if (state.currentUser) connectDMNotificationWS();
                }, 3000);
            }
        };
        
        state.dmNotificationWS.onerror = (error) => {
            console.error('[DM-Notif] Error:', error);
        };
    } catch (e) {
        console.error('[DM-Notif] Failed to connect:', e);
    }
}

function disconnectDMNotificationWS() {
    if (state.dmNotificationWS) {
        state.dmNotificationWS.close(1000);
        state.dmNotificationWS = null;
    }
}

// Handle incoming DM notification
function handleDMNotification(msg) {
    const convId = msg.conversation_id;
    
    // If user is currently viewing this conversation, ignore
    if (state.isDMMode && state.selectedDMConversation?.id === convId) {
        return;
    }
    
    // Increment unread count
    state.dmUnreadCounts[convId] = (state.dmUnreadCounts[convId] || 0) + 1;
    recalcTotalUnread();
    
    // Update the conversation's last message in state
    const conv = state.dmConversations.find(c => c.id === convId);
    if (conv) {
        conv.last_message = msg.content;
        conv.last_message_at = msg.created_at;
        // Re-sort: move this conversation to the top
        state.dmConversations.sort((a, b) => (b.last_message_at || 0) - (a.last_message_at || 0));
    }
    
    // Update UI
    updateDMBadge();
    if (state.isDMMode) {
        renderDMConversations(state.dmConversations);
    }
    
    // Play notification sound
    playDMNotificationSound();
}

// Recalculate total unread count
function recalcTotalUnread() {
    state.totalDMUnread = Object.values(state.dmUnreadCounts).reduce((sum, n) => sum + n, 0);
}

// Update the badge on the 💬 button
function updateDMBadge() {
    const btn = document.querySelector('.dm-btn');
    if (!btn) return;
    
    // Remove existing badge
    const existing = btn.querySelector('.dm-badge');
    if (existing) existing.remove();
    
    if (state.totalDMUnread > 0) {
        const badge = document.createElement('span');
        badge.className = 'dm-badge';
        badge.textContent = state.totalDMUnread > 99 ? '99+' : state.totalDMUnread;
        btn.appendChild(badge);
    }
}

// ==================== TYPING INDICATOR ====================

let typingTimeout = null;
let lastTypingSent = 0;

// Send typing event (throttled — max once per 2 seconds)
function sendTypingEvent() {
    const now = Date.now();
    if (now - lastTypingSent < 2000) return;
    if (!state.dmWebSocket || state.dmWebSocket.readyState !== WebSocket.OPEN) return;
    
    lastTypingSent = now;
    state.dmWebSocket.send(JSON.stringify({ type: 'typing' }));
}

// Show typing indicator
function showTypingIndicator(username) {
    const indicator = document.getElementById('dm-typing-indicator');
    const usernameEl = document.getElementById('dm-typing-username');
    if (!indicator || !usernameEl) return;
    
    usernameEl.textContent = username;
    indicator.classList.remove('hidden');
    
    // Auto-hide after 3 seconds
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        hideTypingIndicator();
    }, 3000);
}

// Hide typing indicator
function hideTypingIndicator() {
    const indicator = document.getElementById('dm-typing-indicator');
    if (indicator) indicator.classList.add('hidden');
    clearTimeout(typingTimeout);
}

// ==================== DM NOTIFICATION SOUND ====================

// Play a short notification sound using Web Audio API (no external file needed)
function playDMNotificationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // First tone — pleasant "pop"
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, ctx.currentTime); // A5
        osc1.frequency.setValueAtTime(1047, ctx.currentTime + 0.08); // C6
        gain1.gain.setValueAtTime(0.15, ctx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 0.25);
        
        // Second tone — slightly higher for that "ding" feel
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1319, ctx.currentTime + 0.1); // E6
        gain2.gain.setValueAtTime(0, ctx.currentTime);
        gain2.gain.setValueAtTime(0.12, ctx.currentTime + 0.1);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(ctx.currentTime + 0.1);
        osc2.stop(ctx.currentTime + 0.35);
        
        // Cleanup
        setTimeout(() => ctx.close(), 500);
    } catch (e) {
        console.log('[DM] Could not play notification sound:', e.message);
    }
}

// Format DM timestamp
function formatDMTimestamp(unixTimestamp) {
    const date = new Date(unixTimestamp * 1000);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    const timeStr = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    
    if (msgDate.getTime() === today.getTime()) {
        return timeStr;
    } else if (msgDate.getTime() === yesterday.getTime()) {
        return 'Ayer ' + timeStr;
    } else {
        return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' + timeStr;
    }
}

// New DM Modal
function showNewDMModal() {
    document.getElementById('new-dm-modal').classList.remove('hidden');
    document.getElementById('new-dm-username').value = '';
    document.getElementById('new-dm-username').focus();
}

function hideNewDMModal() {
    document.getElementById('new-dm-modal').classList.add('hidden');
}

async function handleNewDMSubmit(event) {
    event.preventDefault();
    
    const username = document.getElementById('new-dm-username').value.trim();
    if (!username) return;
    
    try {
        console.log('[DM] Starting conversation with:', username);
        const conv = await API.dm.startConversation(username);
        console.log('[DM] Conversation created/found:', conv);
        
        hideNewDMModal();
        
        // Reload conversations and select the new one
        await loadDMConversations();
        selectDMConversation(conv);
    } catch (error) {
        console.error('[DM] Failed to start conversation:', error);
        alert('Error: ' + error.message);
    }
}

// Wire up DM button
document.querySelector('.dm-btn')?.addEventListener('click', showDMView);

// Wire up DM message input (Enter key)
document.addEventListener('DOMContentLoaded', () => {
    const dmInput = document.getElementById('dm-message-input');
    if (dmInput) {
        dmInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendDMMessage();
                hideTypingIndicator(); // Hide typing when sending
            }
        });
        // Send typing event when user types
        dmInput.addEventListener('input', () => {
            if (dmInput.value.trim()) {
                sendTypingEvent();
            }
        });
    }
});

// Make DM functions global
window.showDMView = showDMView;
window.hideDMView = hideDMView;
window.showNewDMModal = showNewDMModal;
window.hideNewDMModal = hideNewDMModal;
window.handleNewDMSubmit = handleNewDMSubmit;
window.sendDMMessage = sendDMMessage;
window.filterDMConversations = filterDMConversations;

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

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
