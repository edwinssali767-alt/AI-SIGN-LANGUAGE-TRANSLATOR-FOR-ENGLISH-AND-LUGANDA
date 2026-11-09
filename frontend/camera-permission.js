// In-page camera permission dialog. Explains why the camera is needed, then
// triggers the browser's own prompt (which a website cannot replace or restyle).
(function () {
    function cameraAlreadyGranted() {
        if (!navigator.permissions?.query) return Promise.resolve(false);
        return navigator.permissions.query({ name: 'camera' })
            .then(status => status.state === 'granted')
            .catch(() => false);
    }

    function showDialog() {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'camPermTitle');
            overlay.className = 'cp-overlay';
            overlay.innerHTML = `
                <div class="cp-dialog">
                    <svg class="cp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
                    <h2 id="camPermTitle">Allow camera access</h2>
                    <p>
                        The translator uses your camera to see your hand signs. Video is never recorded or stored.
                        Your browser will ask for confirmation next: choose <strong>Allow</strong>.
                        <a href="privacy.html" target="_blank" rel="noopener">Privacy notice</a>
                    </p>
                    <div class="cp-actions">
                        <button type="button" data-act="cancel" class="btn btn-secondary">Not now</button>
                        <button type="button" data-act="allow" class="btn btn-primary">Continue</button>
                    </div>
                </div>`;

            const finish = result => {
                document.removeEventListener('keydown', onKey);
                overlay.remove();
                resolve(result);
            };
            const onKey = e => { if (e.key === 'Escape') finish(false); };
            overlay.addEventListener('click', e => {
                const act = e.target.dataset?.act;
                if (act === 'allow') finish(true);
                else if (act === 'cancel' || e.target === overlay) finish(false);
            });
            document.addEventListener('keydown', onKey);
            document.body.appendChild(overlay);
            overlay.querySelector('[data-act="allow"]').focus();
        });
    }

    // Drop-in replacement for navigator.mediaDevices.getUserMedia.
    window.requestCameraStream = async function (constraints) {
        if (!(await cameraAlreadyGranted())) {
            const proceed = await showDialog();
            if (!proceed) {
                const err = new Error('Camera permission was not requested.');
                err.name = 'NotAllowedError';
                throw err;
            }
        }
        return navigator.mediaDevices.getUserMedia(constraints);
    };
})();
