const TRANSLATOR_API_BASE = getTranslatorApiBase();
const SOCKET_IO_URL = getSocketUrl();

function getTranslatorApiBase() {
    if (window.location.protocol === 'file:') {
        return 'http://localhost:5000/api';
    }
    const localHosts = ['localhost', '127.0.0.1'];
    if (localHosts.includes(window.location.hostname)) {
        return `${window.location.protocol}//${window.location.hostname}:5000/api`;
    }
    return `${window.location.origin}/api`;
}

function getSocketUrl() {
    if (window.location.protocol === 'file:') {
        return 'http://localhost:5000';
    }
    const localHosts = ['localhost', '127.0.0.1'];
    if (localHosts.includes(window.location.hostname)) {
        return `${window.location.protocol}//${window.location.hostname}:5000`;
    }
    return `${window.location.origin}`;
}

let mediaStream = null;
let currentImageData = null;
let frameBuffer = [];
let captureInterval = null;
let isCapturing = false;
let feedbackUpdateInterval = null;
let socket = null;
let isRealtimeMode = false;
let realtimeFrameInterval = null;
let realtimeBtn = null;
let targetLanguage = null;
let usingFrontCamera = true;


document.addEventListener('DOMContentLoaded', function () {
    const startCameraBtn = document.getElementById('startCameraBtn');
    const captureBtn = document.getElementById('captureBtn');
    const stopCameraBtn = document.getElementById('stopCameraBtn');
    const cameraFeed = document.getElementById('cameraFeed');
    const photoCanvas = document.getElementById('photoCanvas');
    targetLanguage = document.getElementById('targetLanguage');
    const translationLabel = document.getElementById('translationLabel');
    const resultContainer = document.getElementById('resultContainer');
    const errorContainer = document.getElementById('errorContainer');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const feedbackContainer = document.getElementById('feedbackContainer');
    const newTranslationBtn = document.getElementById('newTranslationBtn');
    const closeErrorBtn = document.getElementById('closeErrorBtn');
    const detectedGesture = document.getElementById('detectedGesture');
    const translationResult = document.getElementById('translationResult');
    const observer = new MutationObserver(() => {
        console.trace(
            "TEXT CHANGED:",
            detectedGesture.textContent,
            translationResult.textContent
        );
    });

    observer.observe(detectedGesture, {
        childList: true,
        characterData: true,
        subtree: true
    });

    observer.observe(translationResult, {
        childList: true,
        characterData: true,
        subtree: true
    });
    const resultImage = document.getElementById('resultImage');
    const historyCountValue = document.getElementById('historyCountValue');
    const learningVideoUpload = document.getElementById('learningVideoUpload');
    const learningVideoPreviewContainer = document.getElementById('learningVideoPreviewContainer');
    const learningVideoPreview = document.getElementById('learningVideoPreview');
    const learningLessons = document.getElementById('learningLessons');
    realtimeBtn = document.getElementById('realtimeBtn');

    if (!startCameraBtn || !captureBtn || !stopCameraBtn || !detectedGesture || !translationResult) {
        console.error('Translator page is missing required DOM elements');
        return;
    }

    initSocket();

    resultContainer.classList.add('hidden');
    updateTranslationLabel();
    refreshHistoryCount();
    loadLearningLessons();

    targetLanguage.addEventListener('change', updateTranslationLabel);
    startCameraBtn.addEventListener('click', startCamera);
    stopCameraBtn.addEventListener('click', stopCamera);
    captureBtn.addEventListener('click', captureGesture);
    if (realtimeBtn) {
        realtimeBtn.addEventListener('click', toggleRealtimeMode);
    }
    const switchCameraBtn = document.getElementById('switchCameraBtn');
    if (switchCameraBtn) {
        switchCameraBtn.addEventListener('click', switchCamera);
    }
    if (newTranslationBtn) {
        newTranslationBtn.addEventListener('click', () => {
            resultContainer.classList.add('hidden');
            feedbackContainer?.classList.add('hidden');
            if (typeof captureBtn !== 'undefined') captureBtn.disabled = !mediaStream;
        });
    }
    if (closeErrorBtn) {
        closeErrorBtn.addEventListener('click', hideError);
    }
    if (learningVideoUpload) {
        learningVideoUpload.addEventListener('change', handleLearningVideoUpload);
    }

    async function startCamera() {
        try {
            const facingMode = usingFrontCamera ? 'user' : 'environment';
            const constraints = {
                video: { facingMode: facingMode },
                audio: false,
            };

            mediaStream = await requestCameraStream(constraints);

            cameraFeed.srcObject = mediaStream;

            cameraFeed.setAttribute('playsinline', '');
            cameraFeed.setAttribute('webkit-playsinline', '');

            await cameraFeed.play();

            startCameraBtn.disabled = true;
            captureBtn.disabled = false;
            stopCameraBtn.disabled = false;
            realtimeBtn.disabled = false;
            if (switchCameraBtn) switchCameraBtn.disabled = false;
            showSuccess('Camera started');
        } catch (error) {
            // A signer pressing "Not now" on our own dialog is a normal choice, not a fault.
            if (!/permission was not requested/i.test(error.message || '')) console.error(error);
            hideError();
            const reason = buildCameraErrorReason(error);
            showError(reason);
        }

        function buildCameraErrorReason(error) {
            const isNotSecure = window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
            const parts = ['Camera error: ' + error.message];
            if (isNotSecure) {
                parts.push('Camera access requires HTTPS or localhost. Use HTTPS, or test on localhost.');
            }
            if (typeof DeviceCameraError === 'undefined' || !error.name) {
                parts.push('If this device needs permission, allow camera access and try again.');
            }
            return parts.join('\n');
        }
    }

    async function switchCamera() {
        const previousFacing = usingFrontCamera;
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        usingFrontCamera = !previousFacing;
        try {
            const facingMode = usingFrontCamera ? 'user' : 'environment';
            const constraints = {
                video: { facingMode: facingMode },
                audio: false,
            };

            mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            cameraFeed.srcObject = mediaStream;
            cameraFeed.setAttribute('playsinline', '');
            cameraFeed.setAttribute('webkit-playsinline', '');
            await cameraFeed.play();
            showSuccess(`Switched to ${usingFrontCamera ? 'front' : 'back'} camera`);
        } catch (error) {
            usingFrontCamera = previousFacing;
            console.error(error);
            hideError();
            showError('Camera switch failed: ' + error.message);
        }
    }

    function stopCamera() {
        const switchCameraBtn = document.getElementById('switchCameraBtn');
        if (captureInterval) {
            clearInterval(captureInterval);
            captureInterval = null;
        }

        if (isRealtimeMode) {
            stopRealtimeMode();
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach((track) => track.stop());
            mediaStream = null;
        }

        isCapturing = false;
        cameraFeed.srcObject = null;
        startCameraBtn.disabled = false;
        captureBtn.disabled = true;
        stopCameraBtn.disabled = true;
        realtimeBtn.disabled = true;
        if (switchCameraBtn) switchCameraBtn.disabled = true;
        captureBtn.textContent = 'Capture Gesture';
        captureBtn.style.background = '';
        showSuccess('Camera stopped');
    }

    function initSocket() {
        if (socket) {
            socket.disconnect();
        }

        const token = localStorage.getItem('user_token');
        if (!token) {
            console.warn('No auth token found for real-time mode');
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = function() {
            socket = io(SOCKET_IO_URL, {
                transports: ['polling', 'websocket']
            });

            socket.on('connect', function() {
                console.log('Socket connected for real-time translation');
            });

            socket.on('realtime_status', function(data) {
                console.log('Real-time status:', data);
            });

            socket.on('realtime_result', function(data) {
                handleRealtimeResult(data);
            });

            socket.on('realtime_error', function(data) {
                showError(data.error || 'Real-time translation error');
            });

            socket.on('realtime_limit', function(data) {
                if (typeof showSubscriptionModal === 'function') {
                    showSubscriptionModal();
                }
                stopRealtimeMode();
            });

            socket.on('disconnect', function() {
                console.log('Socket disconnected');
            });
        };
        script.onerror = function() {
            console.error('Failed to load Socket.IO client library');
            if (realtimeBtn) {
                realtimeBtn.disabled = true;
                realtimeBtn.textContent = 'Real-time Unavailable';
            }
        };
        document.head.appendChild(script);
    }

    function toggleRealtimeMode() {
        if (!isRealtimeMode) {
            startRealtimeMode();
        } else {
            stopRealtimeMode();
        }
    }

    function startRealtimeMode() {
        if (!socket || !socket.connected) {
            showError('Socket not connected. Please try again.');
            return;
        }

        if (!canTranslateNow()) {
            return;
        }

        const token = localStorage.getItem('user_token');
        if (!token) {
            showError('Please sign in first.');
            return;
        }

        isRealtimeMode = true;
        realtimeBtn.textContent = 'Stop Real-time';
        realtimeBtn.style.background = 'red';
        captureBtn.disabled = true;

        socket.emit('start_realtime', {
            token: token,
            target_language: targetLanguage.value
        });

        const ctx = photoCanvas.getContext('2d');
        photoCanvas.width = cameraFeed.videoWidth;
        photoCanvas.height = cameraFeed.videoHeight;

        realtimeFrameInterval = setInterval(() => {
            ctx.drawImage(cameraFeed, 0, 0);
            const frameData = photoCanvas.toDataURL('image/jpeg', 0.7);
            socket.emit('realtime_frame', {
                token: token,
                frame: frameData,
                target_language: targetLanguage.value
            });
        }, 200);
    }

    function stopRealtimeMode() {
        if (realtimeFrameInterval) {
            clearInterval(realtimeFrameInterval);
            realtimeFrameInterval = null;
        }

        if (socket && socket.connected) {
            socket.emit('stop_realtime');
        }

        isRealtimeMode = false;
        if (realtimeBtn) {
            realtimeBtn.textContent = 'Real-time Translation';
            realtimeBtn.style.background = '';
            realtimeBtn.disabled = false;
        }
        captureBtn.disabled = false;
        clearFeedback();
    }

    function handleRealtimeResult(data) {
        const liveEnglishEl = document.getElementById('liveEnglishTranslation');
        const liveLugandaEl = document.getElementById('liveLugandaTranslation');

        if (data.gesture && (liveEnglishEl || liveLugandaEl)) {
            if (liveEnglishEl) {
                liveEnglishEl.textContent = data.english || formatGestureName(data.gesture) || '-';
            }
            if (liveLugandaEl) {
                liveLugandaEl.textContent = data.luganda || formatGestureName(data.gesture) || '-';
            }

            if (detectedGesture) {
                detectedGesture.textContent = formatGestureName(data.gesture) || '-';
            }
            if (translationResult) {
                translationResult.textContent = data.english || '-';
            }
            document.dispatchEvent(new CustomEvent('translation:result', { detail: data }));

            updateFeedbackDisplay({
                gesture: data.gesture,
                confidence: data.confidence,
                speed: data.speed
            });

            if (resultImage) {
                resultImage.src = photoCanvas.toDataURL('image/jpeg', 0.8);
                resultImage.style.display = 'block';
            }

            resultContainer.classList.remove('hidden');
            showClearFeedbackBtn();
        }
    }

    function captureGesture() {
        hideError();

        if (!navigator.mediaDevices?.getUserMedia) {
            showError('Your browser does not support camera access.');
            return;
        }

        if (!canTranslateNow()) {
            return;
        }

        if (!isCapturing) {
            if (!cameraFeed.videoWidth || !cameraFeed.videoHeight) {
                showError('Camera is not ready yet. Please wait a moment and try again.');
                return;
            }

            isCapturing = true;
            frameBuffer = [];
            captureBtn.textContent = 'Recording...';
            captureBtn.style.background = 'red';

            captureInterval = setInterval(() => {
                const ctx = photoCanvas.getContext('2d');
                photoCanvas.width = cameraFeed.videoWidth;
                photoCanvas.height = cameraFeed.videoHeight;
                ctx.drawImage(cameraFeed, 0, 0);
                frameBuffer.push(photoCanvas.toDataURL('image/jpeg', 0.8));
            }, 100);

            showSuccess('Recording gesture...');
            return;
        }

        isCapturing = false;
        clearInterval(captureInterval);
        captureInterval = null;
        captureBtn.textContent = 'Capture Gesture';
        captureBtn.style.background = '';

        if (frameBuffer.length > 0) {
            processMotionGesture();
        } else {
            showError('No frames captured');
        }
    }

    async function processMotionGesture() {
        try {
            showLoading(true);
            const response = await fetch(`${TRANSLATOR_API_BASE}/translate-motion`, {
                method: 'POST',
                headers: buildHeaders(),
                body: JSON.stringify({
                    gesture_frames: frameBuffer,
                    target_language: targetLanguage.value,
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                handleTranslationError(response, data);
                throw new Error(data.error || 'Translation failed');
            }

            handleSuccessfulTranslation(data);
        } catch (error) {
            showError(error.message);
        } finally {
            showLoading(false);
            frameBuffer = [];
        }
    }

    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        if (!canTranslateNow()) {
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = function (loadEvent) {
            currentImageData = loadEvent.target.result;
            processImageGesture();
        };
        reader.readAsDataURL(file);
    }

    async function processImageGesture() {
        try {
            showLoading(true);
            const response = await fetch(`${TRANSLATOR_API_BASE}/translate`, {
                method: 'POST',
                headers: buildHeaders(),
                body: JSON.stringify({
                    gesture_image: currentImageData,
                    target_language: targetLanguage.value,
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                handleTranslationError(response, data);
                throw new Error(data.error || 'Translation failed');
            }

            handleSuccessfulTranslation(data);
        } catch (error) {
            showError(error.message);
        } finally {
            showLoading(false);
        }
    }

    function handleSuccessfulTranslation(data) {
        displayResult(data);
        if (typeof recordTranslation === 'function') {
            recordTranslation(data.subscription);
        }
        refreshHistoryCount();
    }

    function displayResult(data) {
        console.log("DISPLAY RESULT DATA:", data);
        console.log("DISPLAY RESULT DATA:", data);
        detectedGesture.textContent = formatGestureName(data.gesture) || '-';
        translationResult.textContent = data.translation || '-';
        document.dispatchEvent(new CustomEvent('translation:result', { detail: data }));

        updateFeedbackDisplay({
            gesture: data.gesture,
            confidence: data.confidence,
            speed: data.speed
        });

        if (resultImage) {
            resultImage.src = currentImageData || photoCanvas.toDataURL('image/jpeg', 0.8);
            resultImage.style.display = resultImage.src ? 'block' : 'none';
        }

        resultContainer.classList.remove('hidden');
        showClearFeedbackBtn();
    }

    function resetUI() {
        console.trace("RESET UI CALLED");
        frameBuffer = [];
        currentImageData = null;
        if (feedbackContainer) feedbackContainer.classList.add('hidden');
    }

    function showLoading(state) {
        loadingIndicator.classList.toggle('hidden', !state);
        captureBtn.disabled = state;
        
    }

    function showError(message) {
        errorContainer.classList.remove('hidden');
        document.getElementById('errorMessage').textContent = message;
    }

    function hideError() {
        errorContainer.classList.add('hidden');
    }

    function updateFeedbackDisplay(feedbackData) {
        const gestureValueEl = document.getElementById('gestureValue');
        const confidenceValueEl = document.getElementById('confidenceValue');
        const langValueEl = document.getElementById('langValue');

        if (gestureValueEl) {
            gestureValueEl.textContent = feedbackData.gesture ? formatGestureName(feedbackData.gesture) : '-';
        }
        if (confidenceValueEl) {
            const confidence = feedbackData.confidence;
            confidenceValueEl.textContent = confidence ? `${Math.round(confidence * 100)}%` : '-';
        }
        if (langValueEl) {
            langValueEl.textContent = feedbackData.language || '-';
        }
    }

    // Called after a result is shown; the old "clear feedback" button no longer exists,
    // so this just reveals the feedback panel.
    function showClearFeedbackBtn() {
        if (feedbackContainer) feedbackContainer.classList.remove('hidden');
    }

    function clearFeedback() {
        const gestureValueEl = document.getElementById('gestureValue');
        const confidenceValueEl = document.getElementById('confidenceValue');
        const langValueEl = document.getElementById('langValue');

        if (gestureValueEl) gestureValueEl.textContent = '-';
        if (confidenceValueEl) confidenceValueEl.textContent = '-';
        if (langValueEl) langValueEl.textContent = '-';
    }

    function showSuccess(message) {
        console.log(message);
    }

    function handleLearningVideoUpload(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        const url = URL.createObjectURL(file);
        learningVideoPreview.src = url;
        learningVideoPreviewContainer.classList.remove('hidden');
    }

    async function loadLearningLessons() {
        if (!learningLessons) {
            return;
        }

        try {
            const response = await fetch(`${TRANSLATOR_API_BASE}/learning/basic-gestures`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to load lessons');
            }

            const lessons = data.lessons || [];
            if (lessons.length === 0) {
                learningLessons.innerHTML = '<p class="loading">No lessons available yet.</p>';
                return;
            }

            learningLessons.innerHTML = lessons.map((lesson) => `
                <div class="result-item">
                    <h4>${formatGestureName(lesson.gesture_name)} - ${lesson.english_meaning}</h4>
                    <p>Luganda: ${lesson.luganda_meaning}</p>
                    <p>${lesson.description || 'Practice slowly and keep your hand visible.'}</p>
                    <p>${(lesson.practice_tips || []).join(' ')}</p>
                </div>
            `).join('');
        } catch (error) {
            learningLessons.innerHTML = `<p class="loading">${error.message}</p>`;
        }
    }

    function updateTranslationLabel() {
        if (!translationLabel || !targetLanguage) {
            return;
        }
        const language = targetLanguage.value === 'luganda' ? 'Luganda' : 'English';
        translationLabel.textContent = `Translation (${language}):`;
    }

    function refreshHistoryCount() {
        if (!historyCountValue) {
            return;
        }

        const subscription = safeParse(localStorage.getItem('userSubscription'));
        historyCountValue.textContent = String(subscription?.translationsUsed || 0);
    }

    function canTranslateNow() {
        if (localStorage.getItem('is_logged_in') !== 'true') {
            showError('Please sign in before translating.');
            return false;
        }

        if (typeof canMakeTranslation === 'function' && !canMakeTranslation()) {
            if (typeof showSubscriptionModal === 'function') {
                showSubscriptionModal();
            } else {
                showError('Your current plan has reached its translation limit.');
            }
            return false;
        }
        return true;
    }

    function handleTranslationError(response, data) {
        if (data.subscription && typeof recordTranslation === 'function') {
            recordTranslation(data.subscription);
            refreshHistoryCount();
        }

        if (response.status === 403 && typeof showSubscriptionModal === 'function') {
            showSubscriptionModal();
        }
    }

    function buildHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };

        const token = localStorage.getItem('user_token');
        if (token) {
            headers.Authorization = token;
        }

        return headers;
    }

    function formatGestureName(gesture) {
        return (gesture || '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function safeParse(value) {
        try {
            return value ? JSON.parse(value) : null;
        } catch (error) {
            return null;
        }
    }
});
