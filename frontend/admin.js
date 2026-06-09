// API Configuration
const API_BASE = getAdminApiBase();

function getAdminApiBase() {
    if (window.location.protocol === 'file:') {
        return 'http://localhost:5000/api';
    }
    const localHosts = ['localhost', '127.0.0.1'];
    if (localHosts.includes(window.location.hostname)) {
        return `${window.location.protocol}//${window.location.hostname}:5000/api`;
    }
    return `${window.location.origin}/api`;
}

// DOM Elements
const loginView = document.getElementById('loginView');
const dashboardView = document.getElementById('dashboardView');
const loginForm = document.getElementById('loginForm');
const addGestureForm = document.getElementById('addGestureForm');
const editGestureForm = document.getElementById('editGestureForm');
const changePasswordForm = document.getElementById('changePasswordForm');
const logoutBtn = document.getElementById('logoutBtn');
const editModal = document.getElementById('editModal');
const modalClose = document.querySelector('#editModal .modal-close');
const passwordModal = document.getElementById('passwordModal');
const passwordModalClose = document.getElementById('passwordModalClose');
const gesturesTable = document.getElementById('gesturesTable');
const usersTable = document.getElementById('usersTable');
const loadingGestures = document.getElementById('loadingGestures');
const themeSelector = document.getElementById('themeSelector');
const ALLOWED_THEMES = ['light', 'dark', 'system'];

let authToken = localStorage.getItem('admin_token');
let currentEditingGestureId = null;

function getSystemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    const normalizedTheme = ALLOWED_THEMES.includes(theme) ? theme : 'system';
    document.documentElement.setAttribute('data-theme', normalizedTheme);
    localStorage.setItem('site_theme', normalizedTheme);
    if (themeSelector) {
        themeSelector.value = normalizedTheme;
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem('site_theme') || 'system';
    applyTheme(savedTheme);
    if (themeSelector) {
        themeSelector.addEventListener('change', (event) => {
            applyTheme(event.target.value);
        });
    }
    if (savedTheme === 'system') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', () => {
            applyTheme('system');
        });
    }
}

function updateAuthNav() {
    const isLoggedIn = localStorage.getItem('is_logged_in') === 'true';
    const authNav = document.getElementById('authNav');
    const profileNav = document.getElementById('profileNav');
    const logoutNav = document.getElementById('logoutNav');

    if (isLoggedIn) {
        if (authNav) authNav.style.display = 'none';
        if (profileNav) profileNav.style.display = 'block';
        if (logoutNav) logoutNav.style.display = 'block';
    } else {
        if (authNav) authNav.style.display = 'block';
        if (profileNav) profileNav.style.display = 'none';
        if (logoutNav) logoutNav.style.display = 'none';
    }
}

function logout(event) {
    event.preventDefault();
    localStorage.removeItem('user_id');
    localStorage.removeItem('username');
    localStorage.removeItem('email');
    localStorage.removeItem('user_token');
    localStorage.removeItem('is_logged_in');
    localStorage.removeItem('admin_token');
    updateAuthNav();
    location.reload();
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDate(dateString) {
    if (!dateString) {
        return 'Never';
    }
    return new Date(dateString).toLocaleString();
}

function getUserStatus(user) {
    if (user.is_online) {
        return { label: 'Logged In', className: 'status-active' };
    }
    if (user.last_login_at) {
        return { label: 'Logged Out', className: 'status-offline' };
    }
    return { label: 'Never Logged In', className: 'status-pending' };
}

// ===== Event Listeners =====
window.addEventListener('load', () => {
    updateAuthNav();
    initTheme();
});

// ===== Init =====
document.addEventListener('DOMContentLoaded', function () {
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    if (addGestureForm) {
        addGestureForm.addEventListener('submit', handleAddGesture);
    }
    if (editGestureForm) {
        editGestureForm.addEventListener('submit', handleEditGesture);
    }
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', handleChangeUserPassword);
    }
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    // Attach training button listeners once
    document.getElementById('startTrainingCameraBtn')?.addEventListener('click', startTrainingCamera);
    document.getElementById('captureTrainingFrameBtn')?.addEventListener('click', captureTrainingFrame);
    document.getElementById('stopTrainingCameraBtn')?.addEventListener('click', stopTrainingCamera);
    document.getElementById('trainModelBtn')?.addEventListener('click', trainModel);
    
    // Attach modal close listeners
    document.querySelector('#editModal .modal-close')?.addEventListener('click', closeEditModal);
    document.querySelector('#passwordModal .modal-close')?.addEventListener('click', closePasswordModal);
    
    // Attach auto-generate label listener
    const nameInput = document.getElementById('trainingGestureName');
    const labelInput = document.getElementById('trainingGestureLabel');
    if (nameInput && labelInput) {
        nameInput.addEventListener('input', () => {
            const name = nameInput.value.trim().toLowerCase().replace(/\s+/g, '_');
            labelInput.value = name || '';
        });
    }
    
    if (authToken) {
        showDashboard();
    } else {
        showLogin();
    }
});

async function showDashboard() {
    loginView.classList.remove('active');
    loginView.classList.add('hidden');
    dashboardView.classList.add('active');
    dashboardView.classList.remove('hidden');

    loadStats();
    loadGesturesTable();
    loadUsersTable();
}

let trainingStream = null;
let trainingCapturedFrames = [];

async function startTrainingCamera() {
    console.log('startTrainingCamera called');
    try {
        trainingStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.getElementById('trainingCameraFeed');
        if (!video) {
            console.error('Video element not found');
            return;
        }
        video.srcObject = trainingStream;
        document.getElementById('startTrainingCameraBtn').disabled = true;
        document.getElementById('captureTrainingFrameBtn').disabled = false;
        document.getElementById('stopTrainingCameraBtn').disabled = false;
    } catch (error) {
        showTrainingError('Camera access denied: ' + error.message);
    }
}

function stopTrainingCamera() {
    if (trainingStream) {
        trainingStream.getTracks().forEach(track => track.stop());
        trainingStream = null;
    }
    document.getElementById('startTrainingCameraBtn').disabled = false;
    document.getElementById('captureTrainingFrameBtn').disabled = true;
    document.getElementById('stopTrainingCameraBtn').disabled = true;
}

function captureTrainingFrame() {
    const video = document.getElementById('trainingCameraFeed');
    const canvas = document.getElementById('trainingCanvas');
    const context = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);
    
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    trainingCapturedFrames.push(imageData);
    
    document.getElementById('capturedFramesCount').textContent = trainingCapturedFrames.length;
    
    const preview = document.getElementById('trainingPreview');
    const img = document.createElement('img');
    img.src = imageData;
    img.style.width = '80px';
    img.style.height = '80px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '4px';
    preview.appendChild(img);
    
    document.getElementById('trainModelBtn').disabled = trainingCapturedFrames.length < 10;
}

async function trainModel() {
    const gestureName = document.getElementById('trainingGestureName').value.trim();
    const gestureLabel = document.getElementById('trainingGestureLabel').value.trim();
    
    if (!gestureName || trainingCapturedFrames.length < 10) {
        showTrainingError('Please enter gesture name and capture at least 10 frames.');
        return;
    }
    
    try {
        showTrainingError('', true);
        showTrainingSuccess('Training model...', false);
        
        const response = await fetch(`${API_BASE}/admin/train`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authToken
            },
            body: JSON.stringify({
                gesture_name: gestureName,
                gesture_label: gestureLabel || gestureName.replace(/\s+/g, '_').toLowerCase(),
                frames: trainingCapturedFrames
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Training failed');
        }
        
        showTrainingSuccess(`Training complete! Gesture "${gestureName}" added with ${trainingCapturedFrames.length} frames.`);
        trainingCapturedFrames = [];
        document.getElementById('trainingPreview').innerHTML = '';
        document.getElementById('capturedFramesCount').textContent = '0';
        document.getElementById('trainModelBtn').disabled = true;
    } catch (error) {
        showTrainingError(error.message);
    }
}

function showTrainingError(message, hide = false) {
    const errorDiv = document.getElementById('trainingError');
    const successDiv = document.getElementById('trainingSuccess');

    if (hide && !message) {
        errorDiv.classList.add('hidden');
    } else {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }
    successDiv.classList.add('hidden');
}

function showTrainingSuccess(message) {
    const errorDiv = document.getElementById('trainingError');
    const successDiv = document.getElementById('trainingSuccess');

    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
    errorDiv.classList.add('hidden');
}

// ===== Authentication Handlers =====
async function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        hideLoginError();
        showLoading(true);

        // Check server status first
        let serverOk = false;
        try {
            const healthCheck = await fetch(`${API_BASE}/health`, { method: 'GET' });
            serverOk = healthCheck.ok;
        } catch (healthError) {
            console.warn('Health check failed:', healthError);
        }

        if (!serverOk) {
            throw new Error('Backend server is not running. Please start the Flask server.');
        }

        const response = await fetch(`${API_BASE}/admin/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Login failed');
        }

        const data = await response.json();
        authToken = data.token;
        localStorage.setItem('admin_token', authToken);
        showDashboard();
    } catch (error) {
        showLoginError(error.message);
    } finally {
        showLoading(false);
    }
}

function handleLogout() {
    authToken = null;
    localStorage.removeItem('admin_token');
    loginForm.reset();
    showLogin();
}

// ===== Gesture Management =====
async function handleAddGesture(e) {
    e.preventDefault();

    const gesture_name = document.getElementById('gestureName').value;
    const english_meaning = document.getElementById('englishMeaning').value;
    const luganda_meaning = document.getElementById('lugandaMeaning').value;
    const description = document.getElementById('description').value;

    try {
        hideAddGestureError();
        hideAddGestureSuccess();

        const response = await fetch(`${API_BASE}/admin/gestures`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authToken
            },
            body: JSON.stringify({
                gesture_name,
                english_meaning,
                luganda_meaning,
                description
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to add gesture');
        }

        showAddGestureSuccess('Gesture added successfully.');
        addGestureForm.reset();
        await Promise.all([loadGesturesTable(), loadStats()]);
    } catch (error) {
        showAddGestureError(error.message);
    }
}

async function handleEditGesture(e) {
    e.preventDefault();

    const gesture_name = document.getElementById('editGestureName').value;
    const english_meaning = document.getElementById('editEnglishMeaning').value;
    const luganda_meaning = document.getElementById('editLugandaMeaning').value;
    const description = document.getElementById('editDescription').value;

    try {
        const response = await fetch(`${API_BASE}/admin/gestures/${currentEditingGestureId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authToken
            },
            body: JSON.stringify({
                gesture_name,
                english_meaning,
                luganda_meaning,
                description
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to update gesture');
        }

        closeEditModal();
        showAddGestureSuccess('Gesture updated successfully.');
        await loadGesturesTable();
    } catch (error) {
        showAddGestureError(error.message);
    }
}

async function deleteGesture(gestureId) {
    if (!confirm('Are you sure you want to delete this gesture?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/gestures/${gestureId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': authToken
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to delete gesture');
        }

        showAddGestureSuccess('Gesture deleted successfully.');
        await Promise.all([loadGesturesTable(), loadStats()]);
    } catch (error) {
        showAddGestureError(error.message);
    }
}

// ===== User Management =====
async function loadUsersTable() {
    try {
        const response = await fetch(`${API_BASE}/admin/users`, {
            headers: {
                'Authorization': authToken
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load users');
        }

        const data = await response.json();
        renderUsersTable(data.users || []);
    } catch (error) {
        usersTable.innerHTML = `<p class="table-error">${escapeHtml(error.message)}</p>`;
    }
}

function renderUsersTable(users) {
    if (users.length === 0) {
        usersTable.innerHTML = '<p class="table-empty">No users found.</p>';
        return;
    }

    const html = `
        <table>
            <thead>
                <tr>
                    <th>Username</th>
                    <th>Email</th>
                    <th>Created</th>
                    <th>Last Login</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${users.map((user) => {
        const status = getUserStatus(user);
        return `
                    <tr>
                        <td>${escapeHtml(user.username)}</td>
                        <td>${escapeHtml(user.email)}</td>
                        <td>${escapeHtml(formatDate(user.created_at))}</td>
                        <td>${escapeHtml(formatDate(user.last_login_at))}</td>
                        <td><span class="status-chip ${status.className}">${status.label}</span></td>
                        <td>
                            <div class="action-buttons">
                                <button class="btn-edit" onclick="openPasswordModal(${user.id})">Change Password</button>
                                <button class="btn-delete" onclick="deleteUser(${user.id}, '${escapeHtml(user.username)}')">Delete</button>
                            </div>
                        </td>
                    </tr>
                `;
    }).join('')}
            </tbody>
        </table>
    `;

    usersTable.innerHTML = html;
}

async function deleteUser(userId, username) {
    if (!confirm(`Delete user "${username}"? This action cannot be undone.`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': authToken
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to delete user');
        }

        showAddGestureSuccess('User deleted successfully.');
        await Promise.all([loadUsersTable(), loadStats()]);
    } catch (error) {
        showAddGestureError(error.message);
    }
}

function openPasswordModal(userId) {
    document.getElementById('passwordUserId').value = userId;
    changePasswordForm.reset();
    passwordModal.classList.remove('hidden');
}

function closePasswordModal() {
    passwordModal.classList.add('hidden');
    changePasswordForm.reset();
}

async function handleChangeUserPassword(event) {
    event.preventDefault();
    const userId = document.getElementById('passwordUserId').value;
    const newPassword = document.getElementById('newUserPassword').value;
    const confirmPassword = document.getElementById('confirmUserPassword').value;

    if (newPassword.length < 6) {
        showAddGestureError('Password must be at least 6 characters.');
        return;
    }

    if (newPassword !== confirmPassword) {
        showAddGestureError('Passwords do not match.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/users/${userId}/password`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authToken
            },
            body: JSON.stringify({ new_password: newPassword })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to change password');
        }

        closePasswordModal();
        showAddGestureSuccess('User password changed successfully.');
    } catch (error) {
        showAddGestureError(error.message);
    }
}

function showLogin() {
    dashboardView.classList.remove('active');
    dashboardView.classList.add('hidden');
    loginView.classList.add('active');
    loginView.classList.remove('hidden');
}

async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/admin/stats`, {
            headers: {
                'Authorization': authToken
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load statistics');
        }

        const data = await response.json();
        document.getElementById('totalGestures').textContent = data.total_gestures || 0;
        document.getElementById('totalTranslations').textContent = data.total_translations || 0;
        document.getElementById('totalUsers').textContent = data.total_users || 0;
        document.getElementById('loggedInUsers').textContent = data.logged_in_users || 0;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

async function loadGesturesTable() {
    try {
        showTableLoading(true);
        const response = await fetch(`${API_BASE}/gestures`);

        if (!response.ok) {
            throw new Error('Failed to load gestures');
        }

        const data = await response.json();
        const gestures = data.gestures || [];
        renderGesturesTable(gestures);
    } catch (error) {
        showAddGestureError(`Error loading gestures: ${error.message}`);
    } finally {
        showTableLoading(false);
    }
}

function renderGesturesTable(gestures) {
    const html = `
        <table>
            <thead>
                <tr>
                    <th>Gesture Name</th>
                    <th>English</th>
                    <th>Luganda</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${gestures.map((gesture) => `
                    <tr>
                        <td>${escapeHtml(gesture.gesture_name.replace(/_/g, ' '))}</td>
                        <td>${escapeHtml(gesture.english_meaning)}</td>
                        <td>${escapeHtml(gesture.luganda_meaning)}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="btn-edit" onclick="openEditModal(${gesture.id}, '${escapeHtml(gesture.gesture_name)}', '${escapeHtml(gesture.english_meaning)}', '${escapeHtml(gesture.luganda_meaning)}', '${escapeHtml(gesture.description || '')}')">Edit</button>
                                <button class="btn-delete" onclick="deleteGesture(${gesture.id})">Delete</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    gesturesTable.innerHTML = html;
}

// ===== Modal Functions =====
function openEditModal(id, name, english, luganda, description) {
    currentEditingGestureId = id;
    document.getElementById('editGestureName').value = name;
    document.getElementById('editEnglishMeaning').value = english;
    document.getElementById('editLugandaMeaning').value = luganda;
    document.getElementById('editDescription').value = description;
    editModal.classList.remove('hidden');
}

function closeEditModal() {
    editModal.classList.add('hidden');
    editGestureForm.reset();
    currentEditingGestureId = null;
}

// ===== UI Functions =====
function showAddGestureError(message) {
    document.getElementById('addErrorMessage').textContent = message;
    document.getElementById('addGestureError').classList.remove('hidden');

    const closeBtn = document.querySelector('#addGestureError .btn-close');
    closeBtn.addEventListener('click', hideAddGestureError);
}

function hideAddGestureError() {
    document.getElementById('addGestureError').classList.add('hidden');
}

function showAddGestureSuccess(message) {
    document.getElementById('successMessage').textContent = message;
    document.getElementById('addGestureSuccess').classList.remove('hidden');

    const closeBtn = document.querySelector('#addGestureSuccess .btn-close');
    closeBtn.addEventListener('click', hideAddGestureSuccess);
    setTimeout(hideAddGestureSuccess, 3000);
}

function hideAddGestureSuccess() {
    document.getElementById('addGestureSuccess').classList.add('hidden');
}

function showLoginError(message) {
    document.getElementById('loginErrorMessage').textContent = message;
    document.getElementById('loginError').classList.remove('hidden');

    const closeBtn = document.querySelector('#loginError .btn-close');
    closeBtn.addEventListener('click', hideLoginError);
}

function hideLoginError() {
    document.getElementById('loginError').classList.add('hidden');
}

function showLoading(show) {
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    if (!submitBtn) return;
    submitBtn.disabled = show;
    submitBtn.textContent = show ? 'Logging in...' : 'Login';
}

function showTableLoading(show) {
    if (show) {
        loadingGestures.classList.remove('hidden');
    } else {
        loadingGestures.classList.add('hidden');
    }
}
