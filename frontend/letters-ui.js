/* Presentation only: keeps the "Camera off / Live" pill and the camera hint in
   step with the video stream. letters.js still owns all camera logic. */
(function () {
    const video = document.getElementById('videoFeed');
    const frame = document.getElementById('cameraFrame');
    const pill = document.getElementById('cameraPill');
    const pillText = document.getElementById('cameraPillText');
    if (!video || !frame || !pill) return;

    function sync() {
        const live = !!video.srcObject && !video.paused && !video.ended;
        pill.classList.toggle('is-off', !live);
        pillText.textContent = live ? 'Live' : 'Camera off';
        frame.classList.toggle('is-live', live);
    }

    ['playing', 'pause', 'emptied', 'ended', 'abort', 'loadedmetadata'].forEach((name) => {
        video.addEventListener(name, sync);
    });
    sync();
})();
