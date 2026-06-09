// API Configuration
const API_BASE = 'http://localhost:5000/api';

// DOM Elements
const loginView = document.getElementById('loginView');
const dashboardView = document.getElementById('dashboardView');
const loginForm = document.getElementById('loginForm');
const addGestureForm = document.getElementById('addGestureForm');
const editGestureForm = document.getElementById('editGestureForm');
const logoutBtn = document.getElementById('logoutBtn');
const editModal = document.getElementById('editModal');
const modalClose = document.querySelector('.modal-close');
const gesturesTable = document.getElementById('gesturesTable');
const loadingGestures = document.getElementById('loadingGestures');

let authToken = localStorage.getItem('admin_token');
let currentEditingGestureId = null;

// ===== Event Listeners =====
loginForm.addEventListener('submit', handleLogin);
addGestureForm.addEventListener('submit', handleAddGesture);
editGestureForm.addEventListener('submit', handleEditGesture);
logoutBtn.addEventListener('click', handleLogout);
modalClose.addEventListener('click', closeEditModal);
editModal.addEventListener('click', function (e) {
    if (e.target === editModal) closeEditModal();
});

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', function () {
    console.log('Admin page loaded');

    if (authToken) {
        showDashboard();
    } else {
        showLogin();
    }
});

// ===== Authentication =====
async function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        hideLoginError();
        showLoading(true);

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

        // Save token
        authToken = data.token;
        localStorage.setItem('admin_token', authToken);

        // Show dashboard
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

        showAddGestureSuccess('Gesture added successfully!');
        addGestureForm.reset();

        // Reload gestures table
        loadGesturesTable();
        loadStats();

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
        showAddGestureSuccess('Gesture updated successfully!');

        // Reload gestures table
        loadGesturesTable();

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

        showAddGestureSuccess('Gesture deleted successfully!');

        // Reload gestures table
        loadGesturesTable();
        loadStats();

    } catch (error) {
        showAddGestureError(error.message);
    }
}

// ===== Load Data =====
async function showDashboard() {
    loginView.classList.remove('active');
    dashboardView.classList.add('active');

    // Load stats and gestures
    loadStats();
    loadGesturesTable();
}

function showLogin() {
    dashboardView.classList.remove('active');
    loginView.classList.add('active');
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

        document.getElementById('totalGestures').textContent = data.total_gestures;
        document.getElementById('totalTranslations').textContent = data.total_translations;

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
                ${gestures.map(gesture => `
                    <tr>
                        <td>${gesture.gesture_name.replace(/_/g, ' ')}</td>
                        <td>${gesture.english_meaning}</td>
                        <td>${gesture.luganda_meaning}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="btn-edit" onclick="openEditModal(${gesture.id}, '${gesture.gesture_name}', '${gesture.english_meaning}', '${gesture.luganda_meaning}', '${gesture.description || ''}')">Edit</button>
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

    // Auto-hide after 3 seconds
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
    // Can add a global loading indicator here
}

function showTableLoading(show) {
    if (show) {
        loadingGestures.classList.remove('hidden');
    } else {
        loadingGestures.classList.add('hidden');
    }
}
