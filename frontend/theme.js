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

        syncThemeWidgets(normalizedTheme);
    }

    const ICONS = {
        light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></g></svg>',
        dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>',
        system: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    };
    const LABELS = { light: 'Light', dark: 'Dark', system: 'System' };

    function closeAllThemeMenus(except) {
        document.querySelectorAll('.theme-switch.open').forEach((el) => {
            if (el !== except) {
                el.classList.remove('open');
                el.querySelector('.theme-toggle').setAttribute('aria-expanded', 'false');
            }
        });
    }

    function syncThemeWidgets(theme) {
        document.querySelectorAll('.theme-switch').forEach((widget) => {
            widget.querySelector('.theme-toggle').innerHTML = ICONS[resolveTheme(theme)];
            widget.querySelectorAll('[role="menuitemradio"]').forEach((item) => {
                item.setAttribute('aria-checked', item.dataset.value === theme ? 'true' : 'false');
            });
        });
    }

    // Replace each theme <select> with an icon button that opens a small popup menu.
    function buildThemeSwitch(selector) {
        const widget = document.createElement('div');
        widget.className = 'theme-switch';
        widget.innerHTML =
            '<button type="button" class="theme-toggle" aria-haspopup="menu" aria-expanded="false" aria-label="Change theme"></button>' +
            '<div class="theme-menu" role="menu" aria-label="Theme">' +
            ['light', 'dark', 'system'].map((v) =>
                '<button type="button" role="menuitemradio" aria-checked="false" data-value="' + v + '">' +
                ICONS[v] + '<span>' + LABELS[v] + '</span></button>').join('') +
            '</div>';

        const toggle = widget.querySelector('.theme-toggle');
        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            const open = !widget.classList.contains('open');
            closeAllThemeMenus(widget);
            widget.classList.toggle('open', open);
            toggle.setAttribute('aria-expanded', String(open));
            if (open) widget.querySelector('[aria-checked="true"]').focus();
        });
        widget.querySelectorAll('[role="menuitemradio"]').forEach((item) => {
            item.addEventListener('click', () => {
                applyTheme(item.dataset.value, true);
                closeAllThemeMenus();
                toggle.focus();
            });
        });
        widget.addEventListener('keydown', (event) => {
            const items = [...widget.querySelectorAll('[role="menuitemradio"]')];
            const i = items.indexOf(document.activeElement);
            if (event.key === 'ArrowDown' && i > -1) { event.preventDefault(); items[(i + 1) % items.length].focus(); }
            if (event.key === 'ArrowUp' && i > -1) { event.preventDefault(); items[(i + items.length - 1) % items.length].focus(); }
        });
        selector.replaceWith(widget);
    }

    function bindThemeSelectors() {
        document.querySelectorAll('select[data-theme-selector], #themeSelector, #mobileThemeSelector')
            .forEach(buildThemeSwitch);
        syncThemeWidgets(normalizeTheme(localStorage.getItem(THEME_KEY) || 'system'));
    }

    document.addEventListener('click', () => closeAllThemeMenus());
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            const open = document.querySelector('.theme-switch.open .theme-toggle');
            closeAllThemeMenus();
            if (open) open.focus();
        }
    });

    function initTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY) || 'system';
        applyTheme(savedTheme, false);
        bindThemeSelectors();
    }

    // Follow OS changes while the user is on "system" (checked live, so switching
    // from light/dark back to system also works).
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if ((localStorage.getItem(THEME_KEY) || 'system') === 'system') {
            applyTheme('system', false);
        }
    });

    // Apply immediately to avoid a light flash, then bind selectors once the DOM is ready.
    applyTheme(localStorage.getItem(THEME_KEY) || 'system', false);
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
