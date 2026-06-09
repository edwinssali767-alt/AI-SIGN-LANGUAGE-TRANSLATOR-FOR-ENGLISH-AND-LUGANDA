(function () {
    const THEME_KEY = 'site_theme';
    const ALLOWED_THEMES = ['light', 'dark', 'system'];

    function getSystemTheme() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function normalizeTheme(theme) {
        return ALLOWED_THEMES.includes(theme) ? theme : 'system';
    }

    function resolveTheme(theme) {
        const normalizedTheme = normalizeTheme(theme);
        return normalizedTheme === 'system' ? getSystemTheme() : normalizedTheme;
    }

    function applyTheme(theme, persist) {
        const normalizedTheme = normalizeTheme(theme);
        const resolvedTheme = resolveTheme(theme);

        document.documentElement.setAttribute('data-theme', normalizedTheme);
        document.documentElement.setAttribute('data-resolved-theme', resolvedTheme);

        if (persist !== false) {
            localStorage.setItem(THEME_KEY, normalizedTheme);
        }

        const selectors = document.querySelectorAll('[data-theme-selector], #themeSelector');
        selectors.forEach((selector) => {
            selector.value = normalizedTheme;
        });
    }

    function bindThemeSelectors() {
        const selectors = document.querySelectorAll('[data-theme-selector], #themeSelector');

        selectors.forEach((selector) => {
            if (selector.dataset.themeBound === 'true') {
                return;
            }

            selector.dataset.themeBound = 'true';
            selector.addEventListener('change', (event) => {
                applyTheme(event.target.value, true);
            });
        });
    }

    function initTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY) || 'system';
        applyTheme(savedTheme, false);
        bindThemeSelectors();

        if (savedTheme === 'system') {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addEventListener('change', (e) => {
                applyTheme('system', false);
            });
        }
    }

    document.addEventListener('DOMContentLoaded', initTheme);

    window.themeManager = {
        applyTheme,
        initTheme,
        getSystemTheme,
        resolveTheme
    };

    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
    });

    function showInstallPrompt() {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('User accepted install');
                }
                deferredPrompt = null;
            });
        }
    }

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then((registration) => {
                    console.log('SW registered: ', registration.scope);
                })
                .catch((error) => {
                    console.log('SW registration failed: ', error);
                });
        });
    }
})();
