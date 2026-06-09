// API Configuration
const GESTURES_API_BASE = getGesturesApiBase();

function getGesturesApiBase() {
    if (window.location.protocol === 'file:') {
        return 'http://localhost:5000/api';
    }
    const localHosts = ['localhost', '127.0.0.1'];
    if (localHosts.includes(window.location.hostname)) {
        return `${window.location.protocol}//${window.location.hostname}:5000/api`;
    }
    return `${window.location.origin}/api`;
}

// Function to update navbar auth state
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

// Logout function
async function logout(event) {
    event.preventDefault();
    const token = localStorage.getItem('user_token');

    try {
        if (token) {
            await fetch(`${GESTURES_API_BASE}/user/logout`, {
                method: 'POST',
                headers: {
                    'Authorization': token
                }
            });
        }
    } catch (error) {
        console.warn('Logout sync failed:', error.message);
    } finally {
        localStorage.removeItem('user_id');
        localStorage.removeItem('username');
        localStorage.removeItem('email');
        localStorage.removeItem('user_token');
        localStorage.removeItem('is_logged_in');
        updateAuthNav();
        location.reload();
    }
}

// Update navbar on page load
window.addEventListener('load', updateAuthNav);

// DOM Elements
const gesturesGrid = document.getElementById('gesturesGrid');
const searchInput = document.getElementById('searchInput');
const languageFilter = document.getElementById('languageFilter');
const loadingGestures = document.getElementById('loadingGestures');
const emptyState = document.getElementById('emptyState');
const errorState = document.getElementById('errorState');
const gestureModal = document.getElementById('gestureModal');
const modalClose = document.querySelector('.modal-close');

let allGestures = [];

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', function () {
    console.log('Gestures page loaded');
    if (searchInput) {
        searchInput.addEventListener('input', filterGestures);
    }
    if (languageFilter) {
        languageFilter.addEventListener('change', filterGestures);
    }
    if (modalClose) {
        modalClose.addEventListener('click', closeModal);
    }
    if (gestureModal) {
        gestureModal.addEventListener('click', function (e) {
            if (e.target === gestureModal) closeModal();
        });
    }
    loadGestures();
});

// ===== Load Gestures =====
async function loadGestures() {
    try {
        showLoading(true);
        hideError();

        const response = await fetch(`${GESTURES_API_BASE}/gestures`);

        if (!response.ok) {
            throw new Error('Failed to load gestures');
        }

        const data = await response.json();
        allGestures = data.gestures || [];

        renderGestures(allGestures);

    } catch (error) {
        showError(`Error loading gestures: ${error.message}`);
        console.error(error);
    } finally {
        showLoading(false);
    }
}

// ===== Render Gestures =====
function renderGestures(gestures) {
    gesturesGrid.innerHTML = '';

    if (gestures.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    gestures.forEach(gesture => {
        const card = createGestureCard(gesture);
        gesturesGrid.appendChild(card);
    });
}

function createGestureCard(gesture) {
    const card = document.createElement('div');
    card.className = 'gesture-card';

    card.innerHTML = `
        <div class="gesture-card-header">
            <div class="gesture-icon">🤚</div>
            <div class="gesture-info">
                <h3>${gesture.gesture_name.replace(/_/g, ' ')}</h3>
            </div>
        </div>

        <div class="gesture-translations">
            <div class="translation-item">
                <span class="lang-label">English:</span>
                <span class="lang-value">${gesture.english_meaning}</span>
            </div>
            <div class="translation-item">
                <span class="lang-label">Luganda:</span>
                <span class="lang-value">${gesture.luganda_meaning}</span>
            </div>
        </div>

        <div class="gesture-footer">
            <button class="gesture-btn" onclick="openModal(${gesture.id})">View Details</button>
        </div>
    `;

    return card;
}

// ===== Filter Gestures =====
function filterGestures() {
    const searchTerm = searchInput.value.toLowerCase();
    const selectedLanguage = languageFilter.value;

    const filtered = allGestures.filter(gesture => {
        const matchesSearch =
            gesture.gesture_name.toLowerCase().includes(searchTerm) ||
            gesture.english_meaning.toLowerCase().includes(searchTerm) ||
            gesture.luganda_meaning.toLowerCase().includes(searchTerm);

        if (selectedLanguage === 'all') {
            return matchesSearch;
        } else if (selectedLanguage === 'english') {
            return matchesSearch && gesture.english_meaning;
        } else if (selectedLanguage === 'luganda') {
            return matchesSearch && gesture.luganda_meaning;
        }

        return matchesSearch;
    });

    renderGestures(filtered);
}

// ===== Modal Functions =====
async function openModal(gestureId) {
    try {
        const response = await fetch(`${GESTURES_API_BASE}/gestures/${gestureId}`);

        if (!response.ok) {
            throw new Error('Failed to load gesture details');
        }

        const gesture = await response.json();

        // Populate modal
        document.getElementById('modalGestureName').textContent =
            gesture.gesture_name.replace(/_/g, ' ');
        document.getElementById('modalEnglish').textContent =
            gesture.english_meaning;
        document.getElementById('modalLuganda').textContent =
            gesture.luganda_meaning;
        document.getElementById('modalDescription').textContent =
            gesture.description || 'No description available';

        // Show modal
        gestureModal.classList.remove('hidden');

    } catch (error) {
        showError(`Error loading gesture details: ${error.message}`);
    }
}

function closeModal() {
    gestureModal.classList.add('hidden');
}

// ===== UI Functions =====
function showLoading(show) {
    if (show) {
        loadingGestures.classList.remove('hidden');
    } else {
        loadingGestures.classList.add('hidden');
    }
}

function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    errorState.classList.remove('hidden');

    const closeErrorBtn = document.getElementById('closeErrorBtn');
    closeErrorBtn.addEventListener('click', hideError);
}

function hideError() {
    errorState.classList.add('hidden');
}
