/**
 * Authentication JavaScript Handler
 */

const API_BASE = (() => {
    if (window.location.protocol === 'file:') {
        console.warn('Opened as file:// - using localhost:5000/api. Run: python -m flask run --port=5000');
        return 'http://localhost:5000/api';
    }
    const localHosts = ['localhost', '127.0.0.1'];
    if (localHosts.includes(window.location.hostname)) {
        return `${window.location.protocol}//${window.location.hostname}:5000/api`;
    }
    return `${window.location.origin}/api`;
})();
const ALLOWED_THEMES = ['light', 'dark', 'system'];

function getApiBase() {
    if (window.location.protocol === 'file:') {
        return 'http://localhost:5000/api';
    }
    const localHosts = ['localhost', '127.0.0.1'];
    if (localHosts.includes(window.location.hostname)) {
        return `${window.location.protocol}//${window.location.hostname}:5000/api`;
    }
    return `${window.location.origin}/api`;
}

async function checkServerStatus() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const response = await fetch(`${API_BASE}/health`, {
            method: 'GET',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        return false;
    }
}

function hideAlert(element) {
    if (!element) return;
    element.textContent = '';
    element.classList.remove('show');
    element.classList.add('hidden');
}

function showAlert(element, message) {
    if (!element) return;
    element.textContent = message;
    element.classList.remove('hidden');
    element.classList.add('show');
}

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
        hideAlert(errorDiv);
        hideAlert(successDiv);

        // Disable button
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        try {
            const serverOk = await checkServerStatus();
            if (!serverOk) {
                throw new Error('Server unreachable');
            }

            const response = await fetch(`${API_BASE}/user/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const contentType = response.headers.get('content-type') || '';
            const data = contentType.includes('application/json') ? await response.json() : {};

            if (response.ok) {
                // Store user info and token
                localStorage.setItem('user_id', data.user_id);
                localStorage.setItem('username', data.username);
                localStorage.setItem('email', data.email);
                localStorage.setItem('user_token', data.token);
                localStorage.setItem('is_logged_in', 'true');

                initializeUserSubscription(data.subscription);

                showAlert(successDiv, `Welcome back, ${username}! Redirecting...`);

                // Redirect after 1.5 seconds
                setTimeout(() => {
                    window.location.href = 'profile.html';
                }, 1500);
            } else {
                showAlert(errorDiv, data.error || 'Login failed. Please try again.');
            }
        } catch (error) {
            console.error('Login error:', error);
            if (error.message === 'Server unreachable' || error.message.includes('Failed to fetch') || !navigator.onLine) {
                showAlert(errorDiv, `Cannot connect to server. API_BASE=${API_BASE}`);
            } else {
                showAlert(errorDiv, 'Login failed. Please try again.');
            }
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
        hideAlert(errorDiv);
        hideAlert(successDiv);

        // Validate inputs
        if (username.length < 3) {
            showAlert(errorDiv, 'Username must be at least 3 characters');
            return;
        }

        if (password.length < 6) {
            showAlert(errorDiv, 'Password must be at least 6 characters');
            return;
        }

        if (password !== passwordConfirm) {
            showAlert(errorDiv, 'Passwords do not match');
            return;
        }

        // Disable button
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        try {
            const serverOk = await checkServerStatus();
            if (!serverOk) {
                throw new Error('Server unreachable');
            }

            const response = await fetch(`${API_BASE}/user/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, email, password })
            });

            const contentType = response.headers.get('content-type') || '';
            const data = contentType.includes('application/json') ? await response.json() : {};

            if (response.ok) {
                showAlert(successDiv, 'Account created! Signing you in...');

                localStorage.setItem('user_id', data.user_id);
                localStorage.setItem('username', data.username);
                localStorage.setItem('email', email);
                localStorage.setItem('user_token', data.token || `user_${data.user_id}`);
                localStorage.setItem('is_logged_in', 'true');

                initializeUserSubscription(data.subscription);

                setTimeout(() => {
                    window.location.href = 'profile.html';
                }, 2000);
            } else {
                let errorMsg = data.error || 'Signup failed. Please try again.';
                if (response.status === 409) {
                    errorMsg = 'Username or email already exists';
                } else if (response.status === 401) {
                    errorMsg = 'Authentication required';
                } else if (response.status === 400) {
                    errorMsg = data.error || 'Invalid input data';
                } else if (response.status >= 500) {
                    errorMsg = data.error || 'Server error. Please try again later.';
                }
                showAlert(errorDiv, errorMsg);
            }
        } catch (error) {
            console.error('Signup error:', error);
            if (error.message === 'Server unreachable' || error.message.includes('Failed to fetch') || !navigator.onLine) {
                showAlert(errorDiv, `Cannot connect to server. API_BASE=${API_BASE}`);
            } else {
                showAlert(errorDiv, 'Signup failed. Please try again.');
            }
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
function initializeUserSubscription(serverSubscription) {
    if (serverSubscription) {
        storeSubscription(serverSubscription);
    }

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

    storeSubscription(subscription);
    localStorage.setItem('currentUser', JSON.stringify({
        id: currentUserId,
        username: localStorage.getItem('username'),
        email: localStorage.getItem('email')
    }));
}

function normalizeSubscription(subscription) {
    const tier = (subscription?.tier || 'basic').toLowerCase();
    const translationsUsed = Number(subscription?.translations_used ?? subscription?.translationsUsed ?? 0);
    const serverLimit = subscription?.translation_limit ?? subscription?.translationLimit;
    const translationLimit = tier === 'premium' ? 'Unlimited' : Number(serverLimit || 10);
    const computedCanTranslate = tier === 'premium' || translationsUsed < translationLimit;
    const translationsRemaining = tier === 'premium'
        ? Infinity
        : Number(subscription?.translations_remaining ?? subscription?.translationsRemaining ?? Math.max(translationLimit - translationsUsed, 0));

    return {
        tier,
        translationsUsed,
        translationLimit,
        translationsRemaining,
        canTranslate: subscription?.can_translate ?? computedCanTranslate,
        requiresUpgrade: subscription?.requires_upgrade ?? !computedCanTranslate,
        userId: String(subscription?.user_id ?? subscription?.userId ?? localStorage.getItem('user_id') ?? '')
    };
}

function storeSubscription(subscription) {
    localStorage.setItem('userSubscription', JSON.stringify(normalizeSubscription(subscription)));
}

async function syncSubscriptionFromServer() {
    const token = localStorage.getItem('user_token');
    if (!token) {
        return getSubscriptionStatus();
    }

    try {
        const response = await fetch(`${API_BASE}/user/subscription`, {
            headers: {
                'Authorization': token
            }
        });
        const data = await response.json();
        if (response.ok && data.subscription) {
            storeSubscription(data.subscription);
        }
    } catch (error) {
        console.warn('Subscription sync failed:', error.message);
    }

    return getSubscriptionStatus();
}

async function updateSubscriptionTier(tier) {
    const token = localStorage.getItem('user_token');
    if (!token) {
        throw new Error('Please sign in before changing your plan.');
    }

    const response = await fetch(`${API_BASE}/user/subscription`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token
        },
        body: JSON.stringify({ tier })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Could not update subscription.');
    }

    storeSubscription(data.subscription);
    return getSubscriptionStatus();
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
        return false;
    }

    const subscription = getSubscriptionStatus();

    if (subscription.tier === 'premium' || subscription.canTranslate === true) {
        return true;
    }

    if (subscription.requiresUpgrade || subscription.translationsUsed >= subscription.translationLimit) {
        return false;
    }

    return true;
}

/**
 * Record a translation
 */
function recordTranslation(serverSubscription) {
    if (serverSubscription) {
        storeSubscription(serverSubscription);
        return;
    }

    const isLoggedIn = localStorage.getItem('is_logged_in') === 'true';

    if (!isLoggedIn) {
        return;
    }

    const subscription = getSubscriptionStatus();
    subscription.translationsUsed = (subscription.translationsUsed || 0) + 1;
    storeSubscription(subscription);
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
window.addEventListener('load', () => {
    updateAuthNav();
    syncSubscriptionFromServer();
});
