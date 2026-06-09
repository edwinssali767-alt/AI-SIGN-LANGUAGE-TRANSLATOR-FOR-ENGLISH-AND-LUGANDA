const TRANSLATOR_API_BASE = getTranslatorApiBase();

function getTranslatorApiBase() {
    const localHosts = ['localhost', '127.0.0.1'];
    if (localHosts.includes(window.location.hostname)) {
        return `${window.location.protocol}//${window.location.hostname}:5000/api`;
    }
    return `${window.location.origin}/api`;
}

let mediaStream = null;
let currentImageData = null;
let frameBuffer = [];
let captureInterval = null;
let isCapturing = false;
let feedbackUpdateInterval = null;

const feedbackElements = {
    currentSign: document.getElementById('currentSign'),
    confidenceLevel: document.getElementById('confidenceLevel'),
    translationSpeed: document.getElementById('translationSpeed'),
    clearFeedbackBtn: document.getElementById('clearFeedbackBtn')
};

document.addEventListener('DOMContentLoaded', function () {
    const startCameraBtn = document.getElementById('startCameraBtn');
    const captureBtn = document.getElementById('captureBtn');
    const stopCameraBtn = document.getElementById('stopCameraBtn');
    const cameraFeed = document.getElementById('cameraFeed');
    const photoCanvas = document.getElementById('photoCanvas');
    const gestureUpload = document.getElementById('gestureUpload');
    const targetLanguage = document.getElementById('targetLanguage');
    const translationLabel = document.getElementById('translationLabel');
    const resultContainer = document.getElementById('resultContainer');
    const errorContainer = document.getElementById('errorContainer');
    const loadingIndicator = document.getElementById('loadingIndicator');
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

    if (!startCameraBtn || !captureBtn || !stopCameraBtn || !detectedGesture || !translationResult) {
        console.error('Translator page is missing required DOM elements');
        return;
    }

    resultContainer.classList.add('hidden');
    updateTranslationLabel();
    refreshHistoryCount();
    loadLearningLessons();

    targetLanguage.addEventListener('change', updateTranslationLabel);
    startCameraBtn.addEventListener('click', startCamera);
    stopCameraBtn.addEventListener('click', stopCamera);
    captureBtn.addEventListener('click', captureGesture);
    gestureUpload.addEventListener('change', handleFileUpload);
    newTranslationBtn.style.display = 'none';
    if (closeErrorBtn) {
        closeErrorBtn.addEventListener('click', hideError);
    }
    if (learningVideoUpload) {
        learningVideoUpload.addEventListener('change', handleLearningVideoUpload);
    }
    if (feedbackElements.clearFeedbackBtn) {
        feedbackElements.clearFeedbackBtn.addEventListener('click', clearFeedback);
    }

    async function startCamera() {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' },
                audio: false,
            });

            cameraFeed.srcObject = mediaStream;
            await cameraFeed.play();

            startCameraBtn.disabled = true;
            captureBtn.disabled = false;
            stopCameraBtn.disabled = false;
            showSuccess('Camera started');
        } catch (error) {
            showError(`Camera error: ${error.message}`);
        }
    }

    function stopCamera() {
        if (captureInterval) {
            clearInterval(captureInterval);
            captureInterval = null;
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
        captureBtn.textContent = 'Capture Gesture';
        captureBtn.style.background = '';
        showSuccess('Camera stopped');
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
        if (gestureUpload) {
            gestureUpload.value = '';
        }
    }

    function showLoading(state) {
        loadingIndicator.classList.toggle('hidden', !state);
        captureBtn.disabled = state;
        gestureUpload.disabled = state;
    }

    function showError(message) {
        errorContainer.classList.remove('hidden');
        document.getElementById('errorMessage').textContent = message;
    }

    function hideError() {
        errorContainer.classList.add('hidden');
    }

    function showClearFeedbackBtn() {
        if (feedbackElements.clearFeedbackBtn) {
            feedbackElements.clearFeedbackBtn.classList.remove('hidden');
        }
    }

    function hideClearFeedbackBtn() {
        if (feedbackElements.clearFeedbackBtn) {
            feedbackElements.clearFeedbackBtn.classList.add('hidden');
        }
    }

    function updateFeedbackDisplay(feedbackData) {
        if (feedbackElements.currentSign) {
            feedbackElements.currentSign.textContent = feedbackData.gesture ? formatGestureName(feedbackData.gesture) : '-';
        }
        if (feedbackElements.confidenceLevel) {
            const confidence = feedbackData.confidence;
            feedbackElements.confidenceLevel.textContent = confidence ? `${Math.round(confidence * 100)}%` : '-';
        }
        if (feedbackElements.translationSpeed) {
            const speed = feedbackData.speed;
            feedbackElements.translationSpeed.textContent = speed ? `${speed.toFixed(2)}ms` : '-';
        }
    }

    function clearFeedback() {
        if (feedbackElements.currentSign) feedbackElements.currentSign.textContent = '-';
        if (feedbackElements.confidenceLevel) feedbackElements.confidenceLevel.textContent = '-';
        if (feedbackElements.translationSpeed) feedbackElements.translationSpeed.textContent = '-';
        hideClearFeedbackBtn();
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
