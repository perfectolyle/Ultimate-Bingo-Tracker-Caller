document.addEventListener('DOMContentLoaded', () => {
    const grids = {
        B: document.getElementById('grid-B'),
        I: document.getElementById('grid-I'),
        N: document.getElementById('grid-N'),
        G: document.getElementById('grid-G'),
        O: document.getElementById('grid-O')
    };

    const numInput = document.getElementById('number-input');
    const addBtn = document.getElementById('add-btn');
    const resetBtn = document.getElementById('reset-btn');
    const historyList = document.getElementById('history-list');
    const calledCountDisplay = document.getElementById('called-count');
    const remainingCountDisplay = document.getElementById('remaining-count');
    const currentNumberDisplay = document.getElementById('current-number-display');
    const undoBtn = document.getElementById('undo-btn');
    const speechToggle = document.getElementById('speech-toggle');
    // Audio state tracking
    let currentAudio = null;

    const announceNumber = async (num) => {
        console.log("announceNumber called for:", num);

        // Stop any currently playing audio/speech immediately
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
        }
        window.speechSynthesis.cancel();

        if (!speechToggle.checked) {
            console.log("Speech toggle is off");
            return;
        }

        const letter = getBingoLetter(num);
        const text = `${letter} ${num}`;

        if (useElevenLabs && elevenLabsApiKey) {
            try {
                console.log("Fetching ElevenLabs audio...");
                // Optimize latency: 4 is max speed (lowest stability, but fine for short numbers)
                const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?optimize_streaming_latency=4`, {
                    method: 'POST',
                    headers: {
                        'xi-api-key': elevenLabsApiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        text: text,
                        model_id: "eleven_turbo_v2",
                        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                    })
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    const audio = new Audio(url);
                    audio.playbackRate = 1;
                    currentAudio = audio; // Track it
                    try {
                        await audio.play();
                    } catch (playErr) {
                        console.error("Audio playback failed:", playErr);
                    }
                    return;
                } else {
                    console.error("ElevenLabs Error (falling back):", response.status);
                    if (response.status === 401) useElevenLabs = false;
                    if (response.status === 429) useElevenLabs = false;
                }
            } catch (err) {
                console.error("ElevenLabs Network Error:", err);
            }
        }

        // Fast Fallback logic
        console.log("Using browser TTS fallback");
        const utterance = new SpeechSynthesisUtterance(text);

        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v =>
            v.name.includes('Google US English') ||
            v.name.includes('Microsoft Zira') ||
            v.name.includes('Natural')
        );

        if (preferredVoice) utterance.voice = preferredVoice;

        utterance.rate = 1.4;
        utterance.pitch = 1.2;
        window.speechSynthesis.speak(utterance);
    };
    const elevenLabsKeyInput = document.getElementById('elevenlabs-key');
    const useElevenLabsCheckbox = document.getElementById('use-elevenlabs');

    // ElevenLabs Default Config
    const ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel
    let elevenLabsApiKey = ''; // paste your api inside
    let useElevenLabs = true;

    let calledNumbers = new Set();
    let history = [];
    let userCards = [];
    let winningPatterns = [];

    // Initialize the main grid
    const initGrid = () => {
        const ranges = {
            B: [1, 15],
            I: [16, 30],
            N: [31, 45],
            G: [46, 60],
            O: [61, 75]
        };

        Object.keys(grids).forEach(col => {
            grids[col].innerHTML = '';
            const [min, max] = ranges[col];
            for (let i = min; i <= max; i++) {
                const cell = document.createElement('div');
                cell.className = 'number-cell';
                cell.textContent = i;
                cell.dataset.number = i;
                cell.addEventListener('click', () => toggleNumber(i));
                grids[col].appendChild(cell);
            }
        });
    };

    const updateStats = () => {
        calledCountDisplay.textContent = calledNumbers.size;
        remainingCountDisplay.textContent = 75 - calledNumbers.size;
    };

    const updateHistory = () => {
        if (history.length === 0) {
            historyList.innerHTML = '<div class="empty-history">No numbers called yet</div>';
            currentNumberDisplay.textContent = '--';
            return;
        }

        historyList.innerHTML = '';
        const recentNums = [...history].reverse();

        // Update HUD
        const lastNum = history[history.length - 1];
        const letter = getBingoLetter(lastNum);
        currentNumberDisplay.textContent = `${letter}-${lastNum}`;
        document.querySelector('.now-calling-hud').classList.remove('new-number');
        void document.querySelector('.now-calling-hud').offsetWidth; // Trigger reflow
        document.querySelector('.now-calling-hud').classList.add('new-number');

        recentNums.slice(0, 20).forEach((num, index) => {
            const item = document.createElement('div');
            item.className = 'history-item' + (index === 0 ? ' latest' : '');
            item.textContent = num;
            historyList.appendChild(item);
        });
    };

    const getBingoLetter = (num) => {
        if (num <= 15) return 'B';
        if (num <= 30) return 'I';
        if (num <= 45) return 'N';
        if (num <= 60) return 'G';
        return 'O';
    };

    const toggleNumber = (num) => {
        if (num < 1 || num > 75) return;

        const cell = document.querySelector(`.number-cell[data-number="${num}"]`);

        if (calledNumbers.has(num)) {
            calledNumbers.delete(num);
            history = history.filter(h => h !== num);
            if (cell) cell.classList.remove('active', 'latest-grid');
        } else {
            calledNumbers.add(num);
            history.push(num);
            document.querySelectorAll('.number-cell.latest-grid').forEach(el => el.classList.remove('latest-grid'));
            if (cell) cell.classList.add('active', 'latest-grid');
            announceNumber(num);
        }

        updateStats();
        updateHistory();
        renderCards();
        checkBingo();
        saveToStorage();
    };

    const checkBingo = () => {
        if (userCards.length === 0 || winningPatterns.length === 0) return;

        let hasBingo = false;

        userCards.forEach(card => {
            winningPatterns.forEach(patternObj => {
                const patternIndices = patternObj.cells || patternObj; // Handle both old and new formats
                if (patternIndices.length === 0) return;

                const isWinner = patternIndices.every(idx => {
                    if (idx === 12) return true; // Free space
                    const numString = card.numbers[idx];
                    const numVal = parseInt(numString);
                    return !isNaN(numVal) && calledNumbers.has(numVal);
                });

                if (isWinner) hasBingo = true;
            });
        });

        if (hasBingo) {
            bingoOverlay.classList.remove('hidden');
        }
    };

    const markNumber = () => {
        const val = parseInt(numInput.value);
        if (isNaN(val) || val < 1 || val > 75) {
            numInput.classList.add('shake');
            setTimeout(() => numInput.classList.remove('shake'), 500);
            return;
        }

        if (!calledNumbers.has(val)) {
            toggleNumber(val);
        }

        numInput.value = '';
        numInput.focus();
    };

    addBtn.addEventListener('click', markNumber);
    numInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') markNumber();
    });

    undoBtn.addEventListener('click', () => {
        if (history.length > 0) {
            const lastNum = history[history.length - 1];
            toggleNumber(lastNum);
        }
    });

    resetBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset the entire grid?')) {
            calledNumbers.clear();
            history = [];
            document.querySelectorAll('.number-cell').forEach(cell => cell.classList.remove('active', 'latest-grid'));
            updateStats();
            updateHistory();
            renderCards();
            saveToStorage();
        }
    });

    // View Switching
    const viewGridBtn = document.getElementById('view-grid');
    const viewCardBtn = document.getElementById('view-card');
    const viewPatternBtn = document.getElementById('view-pattern');
    const gridView = document.getElementById('grid-view');
    const myCardView = document.getElementById('my-card-view');
    const patternView = document.getElementById('pattern-view');
    const gridControls = document.getElementById('grid-controls');

    const switchView = (view) => {
        [viewGridBtn, viewCardBtn, viewPatternBtn].forEach(btn => btn.classList.remove('active'));
        [gridView, myCardView, patternView].forEach(view => view.classList.add('hidden'));

        if (view === 'grid') {
            viewGridBtn.classList.add('active');
            gridView.classList.remove('hidden');
            gridControls.classList.remove('hidden');
        } else if (view === 'card') {
            viewCardBtn.classList.add('active');
            myCardView.classList.remove('hidden');
            gridControls.classList.remove('hidden');
        } else {
            viewPatternBtn.classList.add('active');
            patternView.classList.remove('hidden');
            gridControls.classList.add('hidden');
        }
    };

    viewGridBtn.addEventListener('click', () => switchView('grid'));
    viewCardBtn.addEventListener('click', () => switchView('card'));
    viewPatternBtn.addEventListener('click', () => switchView('pattern'));



    // --- User Cards Logic ---
    const userCardsList = document.getElementById('user-cards-list');
    const addCardBtn = document.getElementById('add-card-btn');

    const createEmptyCard = () => {
        const themes = ['red-theme', 'blue-theme', 'purple-theme', 'green-theme'];
        const randomTheme = themes[Math.floor(Math.random() * themes.length)];
        const id = 'GC' + Math.floor(Math.random() * 1000);

        const numbers = Array(25).fill('');
        numbers[12] = 'FREE';

        return { id, theme: randomTheme, numbers, locked: false, manualMarks: [], hideNumbers: false };
    };

    const randomizeCard = (cardIdx) => {
        const ranges = {
            0: [1, 15],
            1: [16, 30],
            2: [31, 45],
            3: [46, 60],
            4: [61, 75]
        };
        const newNums = Array(25).fill('');
        for (let col = 0; col < 5; col++) {
            const [min, max] = ranges[col];
            const pool = [];
            for (let i = min; i <= max; i++) pool.push(i);
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            for (let row = 0; row < 5; row++) {
                const idx = row * 5 + col;
                if (idx === 12) continue;
                newNums[idx] = pool[row];
            }
        }
        newNums[12] = 'FREE';
        userCards[cardIdx].numbers = newNums;
        userCards[cardIdx].manualMarks = [];
    };

    const renderCards = () => {
        userCardsList.innerHTML = '';
        userCards.forEach((card, cardIdx) => {
            const cardEl = document.createElement('div');
            cardEl.className = `user-card-container ${card.theme}`;
            if (card.hideNumbers) cardEl.classList.add('numbers-hidden');

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-delete-card';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.onclick = () => {
                if (confirm('Delete this card?')) {
                    userCards.splice(cardIdx, 1);
                    renderCards();
                    saveToStorage();
                }
            };
            cardEl.appendChild(deleteBtn);



            const grid = document.createElement('div');
            grid.className = 'user-card-grid';

            card.numbers.forEach((num, numIdx) => {
                const cell = document.createElement('div');
                cell.className = 'user-card-cell';
                if (num === 'FREE') {
                    cell.classList.add('free-space', 'marked');
                    cell.textContent = 'FREE';
                } else {
                    cell.contentEditable = !card.locked;
                    cell.textContent = num;

                    const val = parseInt(num);
                    if ((!isNaN(val) && calledNumbers.has(val)) || (card.manualMarks && card.manualMarks.includes(numIdx))) {
                        cell.classList.add('marked');
                    }

                    // Manual marking disabled per request
                    // cell.onclick = () => { ... };

                    cell.addEventListener('blur', () => {
                        card.numbers[numIdx] = cell.textContent.trim();
                        renderCards();
                        saveToStorage();
                    });

                    cell.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            cell.blur();
                        }
                    });
                }
                grid.appendChild(cell);
            });
            cardEl.appendChild(grid);

            const footer = document.createElement('div');
            footer.className = 'user-card-footer';

            // Randomize & Lock Actions
            const actions = document.createElement('div');
            actions.className = 'user-card-actions';

            const randBtn = document.createElement('button');
            randBtn.className = 'btn-card-action secondary';
            randBtn.textContent = 'RANDOMIZE';
            randBtn.onclick = () => {
                randomizeCard(cardIdx);
                renderCards();
                saveToStorage();
            };

            const lockBtn = document.createElement('button');
            lockBtn.className = `btn-card-action ${card.locked ? 'active' : ''}`;
            lockBtn.textContent = card.locked ? 'UNLOCK' : 'LOCK';
            lockBtn.onclick = () => {
                card.locked = !card.locked;
                renderCards();
                saveToStorage();
            };

            const hideBtn = document.createElement('button');
            hideBtn.className = `btn-card-action ${card.hideNumbers ? 'active' : ''}`;
            hideBtn.textContent = card.hideNumbers ? 'SHOW' : 'HIDE';
            hideBtn.onclick = () => {
                card.hideNumbers = !card.hideNumbers;
                renderCards();
                saveToStorage();
            };

            actions.appendChild(randBtn);
            actions.appendChild(lockBtn);
            actions.appendChild(hideBtn);

            // Theme Picker
            const themePicker = document.createElement('div');
            themePicker.className = 'theme-picker';
            ['red-theme', 'blue-theme', 'purple-theme', 'green-theme'].forEach(t => {
                const dot = document.createElement('div');
                dot.className = `theme-dot ${t} ${card.theme === t ? 'active' : ''}`;
                dot.style.backgroundColor = getThemeHex(t);
                dot.onclick = () => {
                    card.theme = t;
                    renderCards();
                    saveToStorage();
                };
                themePicker.appendChild(dot);
            });

            footer.appendChild(actions);
            footer.appendChild(themePicker);
            cardEl.appendChild(footer);

            userCardsList.appendChild(cardEl);
        });
    };

    const getThemeHex = (theme) => {
        const colors = {
            'red-theme': '#e13437',
            'blue-theme': '#2161b4',
            'purple-theme': '#8b5cf6',
            'green-theme': '#10b981'
        };
        return colors[theme] || '#ccc';
    };

    addCardBtn.addEventListener('click', () => {
        userCards.push(createEmptyCard());
        renderCards();
        saveToStorage();
    });

    // --- Patterns Logic ---
    const patternsList = document.getElementById('patterns-list');
    const addPatternBtn = document.getElementById('add-pattern-btn');

    const renderPatterns = () => {
        patternsList.innerHTML = '';
        winningPatterns.forEach((patternObj, pIdx) => {
            // Convert old array format to object format if necessary
            if (Array.isArray(patternObj)) {
                winningPatterns[pIdx] = { name: `Pattern #${pIdx + 1}`, cells: patternObj };
                patternObj = winningPatterns[pIdx];
            }

            const item = document.createElement('div');
            item.className = 'pattern-item';

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-delete-pattern';
            delBtn.innerHTML = 'DELETE';
            delBtn.onclick = () => {
                winningPatterns.splice(pIdx, 1);
                renderPatterns();
                saveToStorage();
            };
            item.appendChild(delBtn);

            const nameInput = document.createElement('input');
            nameInput.className = 'pattern-name-input';
            nameInput.value = patternObj.name || `Pattern #${pIdx + 1}`;
            nameInput.onblur = () => {
                patternObj.name = nameInput.value;
                saveToStorage();
            };
            nameInput.onkeypress = (e) => { if (e.key === 'Enter') nameInput.blur(); };
            item.appendChild(nameInput);

            const grid = document.createElement('div');
            grid.className = 'pattern-grid';

            for (let i = 0; i < 25; i++) {
                const cell = document.createElement('div');
                cell.className = 'pattern-cell';
                cell.dataset.index = i;
                if (patternObj.cells.includes(i) || i === 12) cell.classList.add('active');

                if (i !== 12) {
                    cell.onclick = () => {
                        const index = i;
                        if (patternObj.cells.includes(index)) {
                            patternObj.cells = patternObj.cells.filter(x => x !== index);
                        } else {
                            patternObj.cells.push(index);
                        }
                        renderPatterns();
                        saveToStorage();
                    };
                }
                grid.appendChild(cell);
            }
            item.appendChild(grid);
            patternsList.appendChild(item);
        });
    };

    // Preset Handlers
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.onclick = () => {
            const type = btn.dataset.preset;
            let name = "New Pattern";
            let cells = [];

            if (type === 'corners') {
                name = "Four Corners";
                cells = [0, 4, 20, 24];
            } else if (type === 'line-h') {
                name = "Middle Horizontal";
                cells = [10, 11, 13, 14];
            } else if (type === 'line-v') {
                name = "Middle Vertical";
                cells = [2, 7, 17, 22];
            } else if (type === 'x') {
                name = "Big X";
                cells = [0, 4, 6, 8, 16, 18, 20, 24];
            } else if (type === 'blackout') {
                name = "Blackout";
                cells = Array.from({ length: 25 }, (_, i) => i).filter(i => i !== 12);
            }

            winningPatterns.push({ name, cells });
            renderPatterns();
            saveToStorage();
        };
    });

    addPatternBtn.addEventListener('click', () => {
        winningPatterns.push({ name: "Custom Pattern", cells: [] });
        renderPatterns();
        saveToStorage();
    });

    // --- Settings Listeners ---
    useElevenLabsCheckbox.addEventListener('change', (e) => {
        useElevenLabs = e.target.checked;
        localStorage.setItem('bingo_use_elevenlabs', useElevenLabs);
        if (useElevenLabs) {
            elevenLabsKeyInput.classList.remove('hidden');
            elevenLabsKeyInput.focus();
        } else {
            elevenLabsKeyInput.classList.add('hidden');
        }
    });

    elevenLabsKeyInput.addEventListener('change', (e) => {
        elevenLabsApiKey = e.target.value.trim();
        localStorage.setItem('bingo_elevenlabs_key', elevenLabsApiKey);
    });

    // --- Storage ---
    const saveToStorage = () => {
        localStorage.setItem('bingo_called', JSON.stringify([...calledNumbers]));
        localStorage.setItem('bingo_history', JSON.stringify(history));
        localStorage.setItem('bingo_user_cards', JSON.stringify(userCards));
        localStorage.setItem('bingo_patterns', JSON.stringify(winningPatterns));
    };

    const loadFromStorage = () => {
        const storedCalled = localStorage.getItem('bingo_called');
        const storedHistory = localStorage.getItem('bingo_history');
        const storedCards = localStorage.getItem('bingo_user_cards');
        const storedPatterns = localStorage.getItem('bingo_patterns');
        const storedKey = localStorage.getItem('bingo_elevenlabs_key');
        const storedUseEleven = localStorage.getItem('bingo_use_elevenlabs');

        if (storedKey) {
            elevenLabsApiKey = storedKey;
        }
        elevenLabsKeyInput.value = elevenLabsApiKey;

        if (storedUseEleven !== null) {
            useElevenLabs = storedUseEleven === 'true';
        }

        useElevenLabsCheckbox.checked = useElevenLabs;
        if (useElevenLabs) {
            elevenLabsKeyInput.classList.remove('hidden');
        } else {
            elevenLabsKeyInput.classList.add('hidden');
        }

        if (storedCalled) calledNumbers = new Set(JSON.parse(storedCalled));
        if (storedHistory) history = JSON.parse(storedHistory);

        if (storedCards) {
            userCards = JSON.parse(storedCards);
        } else {
            // Default Card
            userCards = [{
                id: 'GC637',
                theme: 'red-theme',
                numbers: [8, 20, 35, 46, 62, 15, 21, 34, 49, 65, 13, 19, 'FREE', 53, 67, 2, 29, 32, 52, 64, 5, 18, 31, 51, 74]
            }];
        }

        if (storedPatterns) {
            winningPatterns = JSON.parse(storedPatterns);
        } else {
            // Default Patterns
            winningPatterns = [
                { name: "Horizontal Line", cells: [10, 11, 13, 14] },
                { name: "Vertical Line", cells: [2, 7, 17, 22] }
            ];
        }

        // Update Grid UI
        document.querySelectorAll('.number-cell').forEach(cell => {
            const num = parseInt(cell.dataset.number);
            if (calledNumbers.has(num)) {
                cell.classList.add('active');
            }
        });
        if (history.length > 0) {
            const lastNum = history[history.length - 1];
            const lastCell = document.querySelector(`.number-cell[data-number="${lastNum}"]`);
            if (lastCell) lastCell.classList.add('latest-grid');
        }

        updateStats();
        updateHistory();
        renderCards();
        renderPatterns();
    };

    // Shared Tab Sync
    window.addEventListener('storage', (e) => {
        if (e.key.startsWith('bingo_')) {
            loadFromStorage();
        }
    });

    initGrid();
    loadFromStorage();

    console.log("Bingo App Initialized");
    console.log("Speech Toggle:", speechToggle.checked);
    console.log("Use ElevenLabs:", useElevenLabs);
    console.log("API Key present:", !!elevenLabsApiKey);
    if (elevenLabsApiKey) console.log("Key prefix:", elevenLabsApiKey.substring(0, 4) + "...");
});
