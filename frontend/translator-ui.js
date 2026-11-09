/* Presentation layer for translator.html. It only listens: translator.js keeps
   all camera, API and history logic and announces results with the
   'translation:result' event. Nothing here calls the backend. */
(function () {
    const $ = (id) => document.getElementById(id);
    const video = $('cameraFeed');
    const livePill = $('livePill');
    const english = $('liveEnglishTranslation');
    const luganda = $('liveLugandaTranslation');
    const fill = $('confidenceFill');
    const confText = $('confidenceText');
    const meter = $('confidenceMeter');
    const landmarkCanvas = $('landmarkCanvas');
    const handStage = $('handStage');
    const handCanvas = $('handCanvas');

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let poseSetter = null; // set once the 3D hand has loaded
    let pendingLabel = null;

    /* ---- Live pill follows the camera stream ---- */
    function syncLive() {
        if (livePill) livePill.hidden = !(video && video.srcObject && !video.paused);
    }
    if (video) {
        ['playing', 'pause', 'emptied', 'ended', 'abort'].forEach((e) => video.addEventListener(e, syncLive));
    }

    /* ---- Landmarks: drawn only if the API ever returns them ---- */
    const BONES = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]];
    function drawLandmarks(points) {
        if (!landmarkCanvas) return;
        const w = landmarkCanvas.clientWidth;
        const h = landmarkCanvas.clientHeight;
        if (landmarkCanvas.width !== w) landmarkCanvas.width = w;
        if (landmarkCanvas.height !== h) landmarkCanvas.height = h;
        const g = landmarkCanvas.getContext('2d');
        g.clearRect(0, 0, w, h);
        if (!Array.isArray(points) || points.length < 21) return;
        g.lineWidth = 3;
        g.strokeStyle = '#35b27c';
        BONES.forEach((chain) => {
            g.beginPath();
            chain.forEach((idx, i) => {
                const p = points[idx];
                if (i === 0) g.moveTo(p.x * w, p.y * h);
                else g.lineTo(p.x * w, p.y * h);
            });
            g.stroke();
        });
        g.fillStyle = '#2F6BFF';
        points.forEach((p) => {
            g.beginPath();
            g.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
            g.fill();
        });
    }

    /* ---- Results ---- */
    document.addEventListener('translation:result', (event) => {
        const data = event.detail || {};
        if (english) english.textContent = data.english || data.translation || '-';
        if (luganda) luganda.textContent = data.luganda || '-';

        const c = Number(data.confidence);
        const pct = Number.isFinite(c) && c > 0 ? Math.round(Math.min(c, 1) * 100) : null;
        if (fill) fill.style.width = (pct === null ? 0 : pct) + '%';
        if (confText) confText.textContent = pct === null ? 'Confidence -' : 'Confidence ' + pct + '%';
        if (meter) meter.setAttribute('aria-label', pct === null ? 'Confidence unavailable' : 'Confidence ' + pct + ' percent');

        drawLandmarks(data.landmarks);

        pendingLabel = data.gesture;
        if (poseSetter) poseSetter(data.gesture);
    });

    /* ---- 3D hand behind the translation card (lazy, optional) ---- */
    const conn = navigator.connection || {};
    const lowEnd =
        reduceMotion ||
        (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
        (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) ||
        conn.saveData === true;

    function hasWebGL() {
        try {
            const c = document.createElement('canvas');
            return !!(c.getContext('webgl2') || c.getContext('webgl'));
        } catch (e) {
            return false;
        }
    }

    if (!handStage || !handCanvas || lowEnd || !hasWebGL()) return; // static image stays

    let started = false;
    const loader = new IntersectionObserver((entries) => {
        if (started || !entries[0].isIntersecting) return;
        started = true;
        loader.disconnect();
        Promise.all([import('/vendor/three.module.min.js'), import('/hand-model.js')])
            .then(([THREE, mod]) => startScene(THREE, mod.buildHand))
            .catch(() => { /* keep the static image */ });
    });
    loader.observe(handStage);

    function startScene(THREE, buildHand) {
        const renderer = new THREE.WebGLRenderer({ canvas: handCanvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
        camera.position.set(0, 0.2, 8);
        scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cbb3, 1.4));
        const key = new THREE.DirectionalLight(0xffffff, 2);
        key.position.set(3, 4, 5);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x2f6bff, 1.2);
        rim.position.set(-4, 1, -3);
        scene.add(rim);

        const model = buildHand(THREE);
        model.group.position.y = -0.3;
        scene.add(model.group);
        poseSetter = model.setPose;
        if (pendingLabel) model.setPose(pendingLabel); // a result arrived while loading

        function resize() {
            const w = handStage.clientWidth;
            const h = handStage.clientHeight || 160;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        new ResizeObserver(resize).observe(handStage);
        resize();
        handStage.classList.add('is-3d');

        let visible = true;
        let running = false;
        const clock = new THREE.Clock();
        let last = 0;
        function frame() {
            if (!visible || document.hidden) {
                running = false;
                return;
            }
            const t = clock.getElapsedTime();
            const dt = Math.min(t - last, 0.1);
            last = t;
            model.group.rotation.y = Math.sin(t * 0.5) * 0.7; // slow turn
            model.update(dt, t);
            renderer.render(scene, camera);
            requestAnimationFrame(frame);
        }
        function play() {
            if (!running) {
                running = true;
                requestAnimationFrame(frame);
            }
        }
        new IntersectionObserver((entries) => {
            visible = entries[0].isIntersecting;
            if (visible) play();
        }).observe(handStage);
        document.addEventListener('visibilitychange', play);
        play();
        window.addEventListener('pagehide', () => renderer.dispose());
    }
})();
