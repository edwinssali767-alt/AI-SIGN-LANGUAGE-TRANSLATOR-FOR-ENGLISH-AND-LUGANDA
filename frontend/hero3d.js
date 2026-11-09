/* Landing page 3D hero: procedural hand that follows the pointer, bobbing
   letter cubes, and a GSAP ScrollTrigger camera move. Falls back to the static
   SVG on small/low-end devices, without WebGL, or with Save-Data on. */
(function () {
    const stage = document.getElementById('heroStage');
    const canvas = document.getElementById('heroCanvas');
    if (!stage || !canvas) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const conn = navigator.connection || {};
    const lowEnd =
        window.innerWidth < 900 ||
        window.matchMedia('(pointer: coarse)').matches ||
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

    if (lowEnd || !hasWebGL()) return; // keep the static fallback image

    Promise.all([import('/vendor/three.module.min.js'), import('/hand-model.js')])
        .then(([THREE, handModule]) => start(THREE, handModule.buildHand)).catch(() => { /* keep fallback */ });

    function start(THREE, buildHand) {
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
        camera.position.set(0, 0.3, 7);

        scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cbb3, 1.3));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(3, 4, 5);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x2f6bff, 1.4);
        rim.position.set(-4, 1, -3);
        scene.add(rim);

        /* ---- Hand (shared procedural model) ---- */
        const model = buildHand(THREE);
        const hand = model.group;
        hand.position.set(-0.2, -0.2, 0);
        scene.add(hand);

        /* ---- Letter cubes ---- */
        function letterTexture(letter, bg, fg) {
            const c = document.createElement('canvas');
            c.width = c.height = 128;
            const g = c.getContext('2d');
            g.fillStyle = bg;
            g.fillRect(0, 0, 128, 128);
            g.fillStyle = fg;
            g.font = 'bold 84px "Segoe UI", Arial, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(letter, 64, 70);
            const t = new THREE.CanvasTexture(c);
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
        }
        const cubeDefs = [
            { l: 'A', bg: '#2F6BFF', fg: '#ffffff', pos: [-2.1, -1.1, 0.8], size: 0.85 },
            { l: 'B', bg: '#1E8E5A', fg: '#ffffff', pos: [2.0, -1.4, 0.6], size: 0.8 },
            { l: 'C', bg: '#6FB4DB', fg: '#1E1E1C', pos: [2.2, 1.2, -0.4], size: 0.75 },
        ];
        const cubes = cubeDefs.map((d, i) => {
            const m = new THREE.Mesh(
                new THREE.BoxGeometry(d.size, d.size, d.size),
                new THREE.MeshStandardMaterial({ map: letterTexture(d.l, d.bg, d.fg), roughness: 0.45 })
            );
            m.position.set(d.pos[0], d.pos[1], d.pos[2]);
            m.userData = { base: d.pos[1], phase: i * 1.7 };
            scene.add(m);
            return m;
        });

        /* ---- Sizing ---- */
        function resize() {
            const w = stage.clientWidth;
            const h = stage.clientHeight || 380;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        new ResizeObserver(resize).observe(stage);
        resize();
        stage.classList.add('is-3d');

        /* ---- Pointer follow + idle motion ---- */
        const target = { x: 0, y: 0 };
        if (!reduceMotion) {
            window.addEventListener('pointermove', (e) => {
                target.x = (e.clientX / window.innerWidth) * 2 - 1;
                target.y = (e.clientY / window.innerHeight) * 2 - 1;
            }, { passive: true });
        }

        let visible = true;
        let running = false;
        const clock = new THREE.Clock();
        let lastT = 0;
        function frame() {
            if (!visible || document.hidden) {
                running = false;
                return;
            }
            const t = clock.getElapsedTime();
            const dt = Math.min(t - lastT, 0.1);
            lastT = t;
            hand.rotation.y += (target.x * 0.7 - hand.rotation.y) * 0.08;
            hand.rotation.x += (target.y * 0.4 - hand.rotation.x) * 0.08;
            hand.position.y = -0.2 + Math.sin(t * 1.2) * 0.06;
            model.update(dt, t);
            cubes.forEach((c) => {
                c.position.y = c.userData.base + Math.sin(t * 1.3 + c.userData.phase) * 0.12;
                c.rotation.y += 0.006;
                c.rotation.x = Math.sin(t * 0.8 + c.userData.phase) * 0.15;
            });
            renderer.render(scene, camera);
            requestAnimationFrame(frame);
        }
        function play() {
            if (!running && !reduceMotion) {
                running = true;
                requestAnimationFrame(frame);
            }
        }

        renderer.render(scene, camera); // always paint one frame (covers reduced motion)

        if (!reduceMotion) {
            new IntersectionObserver((entries) => {
                visible = entries[0].isIntersecting;
                if (visible) play();
            }).observe(stage);
            document.addEventListener('visibilitychange', play);
            play();

            /* ---- Scroll: camera travels toward "What You Can Do" ---- */
            if (window.gsap && window.ScrollTrigger) {
                gsap.registerPlugin(ScrollTrigger);
                const rig = { angle: 0 };
                gsap.timeline({
                    scrollTrigger: { trigger: '.hero-card', start: 'top top', end: 'bottom top', scrub: 1 }
                })
                    .to(camera.position, { z: 4.2, y: -0.4, ease: 'none' }, 0)
                    .to(rig, {
                        angle: 0.9,
                        ease: 'none',
                        onUpdate: () => {
                            camera.position.x = Math.sin(rig.angle) * 2.2;
                            camera.lookAt(0, 0, 0);
                        }
                    }, 0)
                    .to(cubes.map((c) => c.scale), { x: 1.25, y: 1.25, z: 1.25, ease: 'none' }, 0);
            }
        }
        window.addEventListener('pagehide', () => renderer.dispose());
    }
})();

/* Card reveal + tilt. Works with or without WebGL; tilt is off for touch and reduced motion. */
(function () {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!calm && window.gsap && window.ScrollTrigger) {
        gsap.registerPlugin(ScrollTrigger);
        gsap.from('.features-grid .tilt-card', {
            y: 50, opacity: 0, duration: 0.7, stagger: 0.12, ease: 'power3.out',
            scrollTrigger: { trigger: '#features', start: 'top 80%' }
        });
    }

    if (calm || window.matchMedia('(pointer: coarse)').matches) return;
    document.querySelectorAll('.tilt-card').forEach((card) => {
        card.addEventListener('pointermove', (e) => {
            const r = card.getBoundingClientRect();
            card.style.setProperty('--ry', (((e.clientX - r.left) / r.width) - 0.5) * 14 + 'deg');
            card.style.setProperty('--rx', (0.5 - ((e.clientY - r.top) / r.height)) * 14 + 'deg');
        });
        card.addEventListener('pointerleave', () => {
            card.style.setProperty('--rx', '0deg');
            card.style.setProperty('--ry', '0deg');
        });
    });
})();
