/* Shared procedural hand for the landing hero and the translator card.
   No model file is needed, so the whole 3D feature stays far below 3 MB.
   buildHand(THREE) -> { group, fingers, setPose(label), update(dt) } */

// Curl per digit [thumb, index, middle, ring, pinky]: 0 = extended, 1 = fully curled.
export const POSES = {
    hello: [0, 0, 0, 0, 0],
    thank_you: [0.15, 0.05, 0.05, 0.05, 0.05],
    yes: [0.9, 1, 1, 1, 1],
    no: [1, 0, 0, 1, 1],
    good: [0, 1, 1, 1, 1],
    bad: [0, 1, 1, 1, 1],
    how: [0.3, 0.35, 0.35, 0.35, 0.35],
    fine: [0.7, 0.8, 0, 0, 0],
    you: [0.9, 0, 1, 1, 1],
    open: [0, 0, 0, 0, 0],
};

export function buildHand(THREE) {
    const skin = new THREE.MeshStandardMaterial({ color: 0xf4c7b8, roughness: 0.55 });
    const nail = new THREE.MeshStandardMaterial({ color: 0xd72d59, roughness: 0.4 });
    const group = new THREE.Group();

    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 0.4, 8, 16), skin);
    palm.scale.set(1.4, 1, 0.55);
    palm.position.y = -0.2;
    group.add(palm);

    const lengths = [0.95, 1.2, 1.3, 1.1];
    const digits = []; // [thumb, index, middle, ring, pinky]

    const thumb = new THREE.Group();
    thumb.position.set(-0.8, -0.45, 0);
    thumb.rotation.z = 0.9;
    const thumbMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.85, 6, 12), skin);
    thumbMesh.position.y = 0.55;
    thumb.add(thumbMesh);
    group.add(thumb);
    digits.push({ node: thumb, rest: 0.9, axis: 'z', span: -1.3 });

    lengths.forEach((len, i) => {
        const pivot = new THREE.Group();
        pivot.position.set(-0.62 + i * 0.41, 0.55, 0);
        const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, len, 6, 12), skin);
        f.position.y = len / 2 + 0.1;
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), nail);
        tip.position.set(0, len + 0.3, 0.12);
        pivot.add(f, tip);
        group.add(pivot);
        digits.push({ node: pivot, rest: 0, axis: 'x', span: 1.75 });
    });

    let current = POSES.open.slice();
    let target = POSES.open.slice();

    function setPose(label) {
        const key = String(label || '').toLowerCase().replace(/[\s-]+/g, '_');
        target = (POSES[key] || POSES.open).slice();
        group.userData.flip = key === 'bad' ? Math.PI : 0; // thumbs down
    }

    // Ease each digit toward the target pose; dt in seconds.
    function update(dt, time) {
        const k = 1 - Math.exp(-8 * dt);
        digits.forEach((d, i) => {
            current[i] += (target[i] - current[i]) * k;
            d.node.rotation[d.axis] = d.rest + current[i] * d.span + (d.axis === 'x' ? Math.sin(time * 1.5 + i) * 0.03 : 0);
        });
        const flip = group.userData.flip || 0;
        group.rotation.z += (flip - group.rotation.z) * k;
    }

    return { group, setPose, update };
}
