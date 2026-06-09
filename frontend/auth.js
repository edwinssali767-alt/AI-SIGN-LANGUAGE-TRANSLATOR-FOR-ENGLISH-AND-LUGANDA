/**
 * Authentication JavaScript Handler
 */

const API_BASE = 'http://localhost:5000/api';
const ALLOWED_THEMES = ['light', 'dark', 'system'];

function getSystemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    const normalizedTheme = ALLOWED_THEMES.includes(theme) ? theme : 'system';
    document.documentElement.setAttribute('data-theme', normalizedTheme);
    localStorage.setItem('site_theme', normalizedTheme);
    const themeSelector = document.getElementById('themeSelector');
    if (themeSelector) {
        themeSelector.value = normalizedTheme;
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem('site_theme') || 'system';
    applyTheme(savedTheme);
    const themeSelector = document.getElementById('themeSelector');
    if (themeSelector) {
        themeSelector.addEventListener('change', (event) => {
            applyTheme(event.target.value);
        });
    }
    if (savedTheme === 'system' || savedTheme === 'system') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', () => {
            applyTheme('system');
        });
    }
}

function setAuthMode(mode) {
    const loginBox = document.getElementById('loginBox');
    const signupBox = document.getElementById('signupBox');

    if (mode === 'signup') {
        loginBox.classList.remove('active');
        loginBox.classList.add('hidden');

        signupBox.classList.remove('hidden');
        signupBox.classList.add('active');
        return;
    }

    signupBox.classList.remove('active');
    signupBox.classList.add('hidden');

    loginBox.classList.remove('hidden');
    loginBox.classList.add('active');
}
// Toggle between login and signup forms
function toggleForms() {
    const loginBox = document.getElementById('loginBox');
    const signupBox = document.getElementById('signupBox');

    loginBox.classList.toggle('active');
    signupBox.classList.toggle('active');
}

// Login Form Handler
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;

        const errorDiv = document.getElementById('loginError');
        const successDiv = document.getElementById('loginSuccess');
        const submitBtn = e.target.querySelector('button[type="submit"]');

        // Clear previous messages
        errorDiv.textContent = '';
        errorDiv.classList.remove('show');
        successDiv.textContent = '';
        successDiv.classList.remove('show');

        // Disable button
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        try {
            const response = await fetch(`${API_BASE}/user/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                // Store user info and token
                localStorage.setItem('user_id', data.user_id);
                localStorage.setItem('username', data.username);
                localStorage.setItem('email', data.email);
                localStorage.setItem('user_token', data.token);
                localStorage.setItem('is_logged_in', 'true');

                // Initialize subscription for user
                initializeUserSubscription();

                successDiv.textContent = `Welcome back, ${username}! Redirecting...`;
                successDiv.classList.add('show');

                // Redirect after 1.5 seconds
                setTimeout(() => {
                    window.location.href = 'profile.html';
                }, 1500);
            } else {
                errorDiv.textContent = data.error || 'Login failed. Please try again.';
                errorDiv.classList.add('show');
            }
        } catch (error) {
            errorDiv.textContent = 'Network error. Please check your connection.';
            errorDiv.classList.add('show');
            console.error('Login error:', error);
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
        }
    });
}

// Signup Form Handler
const signupForm = document.getElementById('signupForm');
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('signupUsername').value.trim();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        const passwordConfirm = document.getElementById('signupPasswordConfirm').value;

        const errorDiv = document.getElementById('signupError');
        const successDiv = document.getElementById('signupSuccess');
        const submitBtn = e.target.querySelector('button[type="submit"]');

        // Clear previous messages
        errorDiv.textContent = '';
        errorDiv.classList.remove('show');
        successDiv.textContent = '';
        successDiv.classList.remove('show');

        // Validate inputs
        if (username.length < 3) {
            errorDiv.textContent = 'Username must be at least 3 characters';
            errorDiv.classList.add('show');
            return;
        }

        if (password.length < 6) {
            errorDiv.textContent = 'Password must be at least 6 characters';
            errorDiv.classList.add('show');
            return;
        }

        if (password !== passwordConfirm) {
            errorDiv.textContent = 'Passwords do not match';
            errorDiv.classList.add('show');
            return;
        }

        // Disable button
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        try {
            const response = await fetch(`${API_BASE}/user/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, email, password })
            });

            const data = await response.json();

            if (response.ok) {
                successDiv.textContent = 'Account created! Signing you in...';
                successDiv.classList.add('show');

                // Store user info
                localStorage.setItem('user_id', data.user_id);
                localStorage.setItem('username', data.username);
                localStorage.setItem('email', email);
                localStorage.setItem('user_token', `user_${data.user_id}`);
                localStorage.setItem('is_logged_in', 'true');

                // Initialize subscription for new user
                initializeUserSubscription();

                // Redirect after 2 seconds
                setTimeout(() => {
                    window.location.href = 'profile.html';
                }, 2000);
            } else {
                if (response.status === 409) {
                    errorDiv.textContent = 'Username or email already exists';
                } else {
                    errorDiv.textContent = data.error || 'Signup failed. Please try again.';
                }
                errorDiv.classList.add('show');
            }
        } catch (error) {
            errorDiv.textContent = 'Network error. Please check your connection.';
            errorDiv.classList.add('show');
            console.error('Signup error:', error);
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
        }
    });
}

// Check if user is already logged in
window.addEventListener('load', () => {
    initTheme();
    const isLoggedIn = localStorage.getItem('is_logged_in');

    // Only redirect if on auth.html page
    if (isLoggedIn === 'true' && window.location.pathname.includes('auth.html')) {
        window.location.href = 'profile.html';
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    if (mode) setAuthMode(mode);
});

// ===== SUBSCRIPTION MANAGEMENT =====

/**
 * Update navigation based on authentication state
 */
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

/**
 * Logout user
 */
async function logout(event) {
    if (event) event.preventDefault();

    const token = localStorage.getItem('user_token');

    try {
        if (token) {
            await fetch(`${API_BASE}/user/logout`, {
                method: 'POST',
                headers: {
                    'Authorization': token
                }
            });
        }
    } catch (error) {
        console.warn('Logout sync failed:', error.message);
    } finally {
        // Clear all auth-related data
        localStorage.removeItem('user_id');
        localStorage.removeItem('username');
        localStorage.removeItem('email');
        localStorage.removeItem('user_token');
        localStorage.removeItem('is_logged_in');
        localStorage.removeItem('userSubscription');
        localStorage.removeItem('currentUser');

        updateAuthNav();
        window.location.href = 'welcome.html';
    }
}

/**
 * Initialize subscription for new user
 */
function initializeUserSubscription() {
    const existingSubscription = JSON.parse(localStorage.getItem('userSubscription') || 'null');
    const currentUserId = localStorage.getItem('user_id');
    const shouldReuse =
        existingSubscription &&
        existingSubscription.userId === currentUserId;

    const subscription = shouldReuse ? existingSubscription : {
        tier: 'basic',
        translationsUsed: 0,
        translationLimit: 10,
        createdAt: new Date().toISOString(),
        userId: currentUserId
    };

    subscription.userId = currentUserId;
    if (subscription.tier !== 'premium' && (!subscription.translationLimit || subscription.translationLimit < 1)) {
        subscription.translationLimit = 10;
    }

    localStorage.setItem('userSubscription', JSON.stringify(subscription));
    localStorage.setItem('currentUser', JSON.stringify({
        id: currentUserId,
        username: localStorage.getItem('username'),
        email: localStorage.getItem('email')
    }));
}

/**
 * Get subscription status
 */
function getSubscriptionStatus() {
    const subscription = JSON.parse(localStorage.getItem('userSubscription')) || {
        tier: 'basic',
        translationsUsed: 0,
        translationLimit: 10
    };
    return subscription;
}

/**
 * Check if user can make a translation
 */
function canMakeTranslation() {
    const isLoggedIn = localStorage.getItem('is_logged_in') === 'true';

    if (!isLoggedIn) {
        // Guest users can make unlimited translations
        return true;
    }

    const subscription = getSubscriptionStatus();

    if (subscription.tier === 'premium') {
        // Premium users have unlimited translations
        return true;
    }

    // Basic plan: 10 translations limit
    if (subscription.translationsUsed >= subscription.translationLimit) {
        return false;
    }

    return true;
}

/**
 * Record a translation
 */
function recordTranslation() {
    const isLoggedIn = localStorage.getItem('is_logged_in') === 'true';

    if (!isLoggedIn) {
        // Don't track guest translations
        return;
    }

    const subscription = getSubscriptionStatus();
    subscription.translationsUsed = (subscription.translationsUsed || 0) + 1;
    localStorage.setItem('userSubscription', JSON.stringify(subscription));
}

/**
 * Get translation count remaining
 */
function getTranslationsRemaining() {
    const subscription = getSubscriptionStatus();

    if (subscription.tier === 'premium') {
        return Infinity;
    }

    return subscription.translationLimit - (subscription.translationsUsed || 0);
}

// Initialize auth on page load
window.addEventListener('load', updateAuthNav);
