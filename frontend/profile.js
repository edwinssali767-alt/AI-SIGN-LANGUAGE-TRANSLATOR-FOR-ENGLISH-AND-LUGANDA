const PROFILE_API_BASE = getProfileApiBase();

function getProfileApiBase() {
    const localHosts = ['localhost', '127.0.0.1'];
    if (localHosts.includes(window.location.hostname)) {
        return `${window.location.protocol}//${window.location.hostname}:5000/api`;
    }
    return `${window.location.origin}/api`;
}

function checkLogin() {
    if (localStorage.getItem('is_logged_in') !== 'true') {
        window.location.href = 'auth.html';
        return false;
    }
    return true;
}

async function loadProfile() {
    try {
        const userId = localStorage.getItem('user_id');
        const token = localStorage.getItem('user_token');
        const response = await fetch(`${PROFILE_API_BASE}/user/profile/${userId}`, {
            headers: { Authorization: token },
        });

        const profileData = await response.json();
        if (!response.ok) {
            throw new Error(profileData.error || 'Failed to load profile');
        }

        const displayUsername = profileData.username || localStorage.getItem('username');
        const displayEmail = profileData.email || localStorage.getItem('email');
        document.getElementById('profileUsername').textContent = displayUsername;
        document.getElementById('profileEmail').textContent = displayEmail;
        document.getElementById('currentEmail').value = displayEmail;

        if (typeof syncSubscriptionFromServer === 'function') {
            await syncSubscriptionFromServer();
        }

        const subscription = JSON.parse(localStorage.getItem('userSubscription') || '{"tier":"basic"}');
        document.getElementById('accountType').textContent =
            subscription.tier === 'premium' ? 'Premium User' : 'Basic User';

        localStorage.setItem('username', displayUsername);
        localStorage.setItem('email', displayEmail);

        const createdAt = new Date(profileData.created_at);
        document.getElementById('memberSince').textContent = createdAt.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

        await loadTranslationHistory(token);
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

async function loadTranslationHistory(token) {
    try {
        const response = await fetch(`${PROFILE_API_BASE}/user/translations`, {
            headers: { Authorization: token },
        });

        const data = await response.json();
        const historyContainer = document.getElementById('historyContainer');

        if (response.ok && (data.translations || []).length > 0) {
            historyContainer.innerHTML = data.translations.map((item) => `
                <div class="history-item">
                    <div class="history-item-content">
                        <div class="history-gesture">${item.gesture}</div>
                        <div class="history-meta">Source: ${item.source_language || 'gesture'} | Target: ${item.language} | ${new Date(item.timestamp).toLocaleDateString()}</div>
                    </div>
                </div>
            `).join('');
            return;
        }

        historyContainer.innerHTML = '<div class="history-empty">No translation history yet. Start translating!</div>';
    } catch (error) {
        console.error('Error loading history:', error);
        document.getElementById('historyContainer').innerHTML = '<div class="history-empty">Could not load history</div>';
    }
}

function clearSessionAndRedirect() {
    localStorage.removeItem('user_id');
    localStorage.removeItem('username');
    localStorage.removeItem('email');
    localStorage.removeItem('user_token');
    localStorage.removeItem('is_logged_in');
    localStorage.removeItem('userSubscription');
    localStorage.removeItem('currentUser');
    window.location.href = 'auth.html';
}

document.querySelectorAll('.sidebar-item').forEach((button) => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-item').forEach((item) => item.classList.remove('active'));
        document.querySelectorAll('.profile-section').forEach((section) => section.classList.remove('active'));
        button.classList.add('active');
        document.getElementById(`${button.dataset.section}Section`).classList.add('active');
    });
});

document.getElementById('emailUpdateForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const newEmail = document.getElementById('newEmail').value.trim();
    const errorDiv = document.getElementById('emailError');
    const successDiv = document.getElementById('emailSuccess');
    const userId = localStorage.getItem('user_id');
    const token = localStorage.getItem('user_token');

    errorDiv.textContent = '';
    errorDiv.classList.add('hidden');
    successDiv.textContent = '';
    successDiv.classList.add('hidden');

    try {
        const response = await fetch(`${PROFILE_API_BASE}/user/profile/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: token,
            },
            body: JSON.stringify({ email: newEmail }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to update email');
        }

        localStorage.setItem('email', newEmail);
        document.getElementById('currentEmail').value = newEmail;
        document.getElementById('newEmail').value = '';
        successDiv.textContent = 'Email updated successfully!';
        successDiv.classList.remove('hidden');
    } catch (error) {
        errorDiv.textContent = error.message || 'Network error. Please try again.';
        errorDiv.classList.remove('hidden');
    }
});

document.getElementById('logoutNav').addEventListener('click', async (event) => {
    event.preventDefault();
    const token = localStorage.getItem('user_token');

    try {
        if (token) {
            await fetch(`${PROFILE_API_BASE}/user/logout`, {
                method: 'POST',
                headers: { Authorization: token },
            });
        }
    } catch (error) {
        console.warn('Logout sync failed:', error.message);
    } finally {
        clearSessionAndRedirect();
    }
});

document.getElementById('deleteAccountBtn').addEventListener('click', () => {
    document.getElementById('deleteModal').classList.remove('hidden');
});

document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
    document.getElementById('deleteModal').classList.add('hidden');
});

document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
    const userId = localStorage.getItem('user_id');
    const token = localStorage.getItem('user_token');

    try {
        const response = await fetch(`${PROFILE_API_BASE}/user/profile/${userId}`, {
            method: 'DELETE',
            headers: { Authorization: token },
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Error deleting account.');
        }

        alert('Account deleted successfully.');
        clearSessionAndRedirect();
    } catch (error) {
        alert(error.message);
        console.error('Error deleting account:', error);
    }
});

window.addEventListener('load', () => {
    if (checkLogin()) {
        loadProfile();
    }
});
