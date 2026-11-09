// Mobile menu behaviour shared by pages that do not carry their own copy.
document.addEventListener('DOMContentLoaded', function () {
    const btn = document.querySelector('.mobile-menu-btn');
    const close = document.querySelector('.close-menu');
    const menu = document.getElementById('mobileMenu');
    const overlay = document.getElementById('mobileMenuOverlay');
    if (!menu || !overlay) return;
    const setOpen = open => {
        menu.classList.toggle('active', open);
        overlay.classList.toggle('active', open);
        if (btn) btn.setAttribute('aria-expanded', String(open));
    };
    if (btn) btn.addEventListener('click', () => setOpen(true));
    if (close) close.addEventListener('click', () => setOpen(false));
    overlay.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
    menu.querySelectorAll('.nav-link').forEach(a => a.addEventListener('click', () => setOpen(false)));
});
