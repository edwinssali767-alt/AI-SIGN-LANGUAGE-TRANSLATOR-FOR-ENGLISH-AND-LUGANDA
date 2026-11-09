const LETTERS_API_BASE = getLettersApiBase();

function getLettersApiBase() {
    if (window.location.protocol === 'file:') {
        return 'http://localhost:5000/api';
    }
    const localHosts = ['localhost', '127.0.0.1'];
    if (localHosts.includes(window.location.hostname)) {
        return `${window.location.protocol}//${window.location.hostname}:5000/api`;
    }
    return `${window.location.origin}/api`;
}

// Letter Capture - Main JavaScript

class LetterCapture {
    constructor() {
        this.video = null;
        this.canvas = null;
        this.ctx = null;
        this.stream = null;
        this.capturedLetters = [];
        this.currentLetter = null;
        this.isCapturing = false;

        this.initElements();
        this.attachEventListeners();
        this.loadLetterGallery();
    }

    initElements() {
        this.video = document.getElementById('videoFeed');
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');

        this.elements = {
            startCameraBtn: document.getElementById('startCameraBtn'),
            stopCameraBtn: document.getElementById('stopCameraBtn'),
            captureLetterBtn: document.getElementById('captureLetterBtn'),
            undoBtn: document.getElementById('undoBtn'),
            clearBtn: document.getElementById('clearBtn'),
            copyBtn: document.getElementById('copyBtn'),
            translateBtn: document.getElementById('translateBtn'),
            targetLanguage: document.getElementById('targetLanguage'),
            letterDisplay: document.getElementById('letterDisplay'),
            currentLetter: document.getElementById('currentLetter'),
            wordInput: document.getElementById('wordInput'),
            letterCount: document.getElementById('letterCount'),
            wordLength: document.getElementById('wordLength'),
            recognitionStatus: document.getElementById('recognitionStatus'),
            letterGallery: document.getElementById('letterGallery'),
            translationResult: document.getElementById('translationResult'),
            resultWord: document.getElementById('resultWord'),
            resultLanguage: document.getElementById('resultLanguage')
        };
    }

    attachEventListeners() {
        this.elements.startCameraBtn.addEventListener('click', () => this.startCamera());
        this.elements.stopCameraBtn.addEventListener('click', () => this.stopCamera());
        this.elements.captureLetterBtn.addEventListener('click', () => this.captureLetter());
        this.elements.undoBtn.addEventListener('click', () => this.undoLastLetter());
        this.elements.clearBtn.addEventListener('click', () => this.clearAllLetters());
        this.elements.copyBtn.addEventListener('click', () => this.copyWord());
        this.elements.translateBtn.addEventListener('click', () => this.translateWord());
    }

    // Camera Management
    async startCamera() {
        try {
            this.updateStatus('Opening camera...');

            const constraints = {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                }
            };

            this.stream = await requestCameraStream(constraints);
            this.video.srcObject = this.stream;

            this.isCapturing = true;
            this.elements.startCameraBtn.disabled = true;
            this.elements.stopCameraBtn.disabled = false;
            this.elements.captureLetterBtn.disabled = false;

            this.updateStatus('Ready to capture');
        } catch (error) {
            console.error('Camera error:', error);
            this.updateStatus('Error: Cannot access camera');
            alert('Cannot access camera. Please check permissions.');
        }
    }

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        this.isCapturing = false;
        this.elements.startCameraBtn.disabled = false;
        this.elements.stopCameraBtn.disabled = true;
        this.elements.captureLetterBtn.disabled = true;
        this.video.srcObject = null;

        this.updateStatus('Camera stopped');
    }

    // Letter Capture
    async captureLetter() {
        if (!this.video || this.video.readyState < this.video.HAVE_ENOUGH_DATA) {
            alert('Camera not ready');
            return;
        }

        if (localStorage.getItem('is_logged_in') !== 'true') {
            alert('Please sign in before translating.');
            return;
        }

        if (typeof canMakeTranslation === 'function' && !canMakeTranslation()) {
            if (typeof showSubscriptionModal === 'function') {
                showSubscriptionModal();
            } else {
                alert('Your subscription has reached its translation limit.');
            }
            return;
        }

        try {
            this.updateStatus('Capturing...');

            // Draw video frame to canvas
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            this.ctx.drawImage(this.video, 0, 0);

            const imageData = this.canvas.toDataURL('image/jpeg', 0.8);

            // Send to backend for letter recognition
            const response = await fetch(`${LETTERS_API_BASE}/recognize-letter`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.getAuthToken()
                },
                body: JSON.stringify({
                    gesture_image: imageData
                })
            });

            const result = await response.json();

            if (response.ok && result.letter) {
                this.currentLetter = result.letter;
                this.capturedLetters.push(result.letter);

                this.updateDisplay();
                this.updateStatus(`Recognized: ${result.letter}`);

                // Play sound effect
                this.playSuccessSound();
            } else {
                this.updateStatus('Letter not recognized');
            }
        } catch (error) {
            console.error('Capture error:', error);
            this.updateStatus('Error capturing letter');
        }
    }

    // Display Updates
    updateDisplay() {
        // Update letter count
        this.elements.letterCount.textContent = this.capturedLetters.length;

        // Update letter display
        if (this.capturedLetters.length === 0) {
            this.elements.letterDisplay.innerHTML = '<span class="placeholder">Captured letters will appear here...</span>';
            this.elements.currentLetter.textContent = '-';
            this.elements.wordInput.value = '';
        } else {
            this.elements.letterDisplay.innerHTML = this.capturedLetters
                .map(letter => `<span class="letter-badge">${letter}</span>`)
                .join('');

            this.elements.currentLetter.textContent = this.currentLetter || '-';
            this.elements.wordInput.value = this.capturedLetters.join('');
        }

        // Update word length
        this.elements.wordLength.textContent = this.capturedLetters.length;

        // Update button states
        this.elements.undoBtn.disabled = this.capturedLetters.length === 0;
        this.elements.clearBtn.disabled = this.capturedLetters.length === 0;
        this.elements.copyBtn.disabled = this.capturedLetters.length === 0;
        this.elements.translateBtn.disabled = this.capturedLetters.length === 0;
    }

    updateStatus(message) {
        this.elements.recognitionStatus.textContent = message;

        // Update status class
        if (message.includes('Error')) {
            this.elements.recognitionStatus.className = 'status-error';
        } else if (message.includes('Capturing')) {
            this.elements.recognitionStatus.className = 'status-capturing';
        } else {
            this.elements.recognitionStatus.className = 'status-ready';
        }
    }

    // Letter Management
    undoLastLetter() {
        if (this.capturedLetters.length > 0) {
            this.capturedLetters.pop();
            this.currentLetter = this.capturedLetters[this.capturedLetters.length - 1] || null;
            this.updateDisplay();
            this.updateStatus('Letter removed');
        }
    }

    clearAllLetters() {
        if (confirm('Clear all letters?')) {
            this.capturedLetters = [];
            this.currentLetter = null;
            this.elements.translationResult.style.display = 'none';
            this.updateDisplay();
            this.updateStatus('All letters cleared');
        }
    }

    copyWord() {
        const word = this.elements.wordInput.value;
        if (word) {
            navigator.clipboard.writeText(word).then(() => {
                this.updateStatus('Word copied to clipboard!');
            }).catch(() => {
                alert('Failed to copy');
            });
        }
    }

    // Translation
    async translateWord() {
        const word = this.elements.wordInput.value.trim();
        const targetLanguage = this.elements.targetLanguage.value;

        if (!word) {
            alert('No word to translate');
            return;
        }

        if (localStorage.getItem('is_logged_in') !== 'true') {
            alert('Please sign in before translating.');
            return;
        }

        if (typeof canMakeTranslation === 'function' && !canMakeTranslation()) {
            if (typeof showSubscriptionModal === 'function') {
                showSubscriptionModal();
            } else {
                alert('Your subscription has reached its translation limit.');
            }
            return;
        }

        try {
            this.updateStatus('Translating...');

            const response = await fetch(`${LETTERS_API_BASE}/translate-word`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.getAuthToken()
                },
                body: JSON.stringify({
                    word: word,
                    target_language: targetLanguage
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.displayTranslationResult(word, targetLanguage);
                if (typeof recordTranslation === 'function') {
                    recordTranslation(result.subscription);
                }
                this.updateStatus('Translation complete');
            } else {
                if (result.subscription && typeof recordTranslation === 'function') {
                    recordTranslation(result.subscription);
                }
                if (response.status === 403 && typeof showSubscriptionModal === 'function') {
                    showSubscriptionModal();
                }
                this.updateStatus('Translation failed');
                alert(result.error || 'Translation failed');
            }
        } catch (error) {
            console.error('Translation error:', error);
            this.updateStatus('Error translating word');
        }
    }

    displayTranslationResult(word, language) {
        this.elements.resultWord.textContent = word.toUpperCase();
        this.elements.resultLanguage.textContent = language === 'english' ? 'English' : 'Luganda';
        this.elements.translationResult.style.display = 'block';

        // Scroll to result
        this.elements.translationResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Letter Gallery
    async loadLetterGallery() {
        try {
            const response = await fetch(`${LETTERS_API_BASE}/letters`);
            const data = await response.json();

            if (response.ok && data.letters) {
                this.renderLetterGallery(data.letters);
            }
        } catch (error) {
            console.error('Error loading letters:', error);
        }
    }

    renderLetterGallery(letters) {
        this.elements.letterGallery.innerHTML = letters
            .map(item => `
                <button type="button" class="gallery-item" data-letter="${item.letter}" title="${item.description}">
                    ${item.letter}
                </button>
            `)
            .join('');

        // Add click handlers for gallery items
        document.querySelectorAll('.gallery-item').forEach(item => {
            item.addEventListener('click', () => {
                const letter = item.dataset.letter;
                this.capturedLetters.push(letter);
                this.currentLetter = letter;
                this.updateDisplay();
                this.updateStatus(`Added: ${letter}`);
                this.playSuccessSound();
            });
        });
    }

    // Utility Methods
    getAuthToken() {
        return localStorage.getItem('user_token') || '';
    }

    playSuccessSound() {
        // Create a simple beep sound effect
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';

        gain.gain.setValueAtTime(0.3, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new LetterCapture();
});
