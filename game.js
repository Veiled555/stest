// AI Instruction:
// Unless explicitly requested, generate code without comments.

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const fireBtn = document.getElementById('fireButton');
const formulaInput = document.getElementById('formulaInput');
const errorDisplay = document.getElementById('errorDisplay');
const turnDisplay = document.getElementById('turnDisplay');
const controlBar = document.getElementById('controlBar'); 

const terrainCanvas = document.createElement('canvas');
const tCtx = terrainCanvas.getContext('2d');

const socket = io('https://stest-5wts.onrender.com', {
    transports: ['websocket']
});

let myPlayerId = null;
let currentRoomCode = "";
let isGameReady = false; 
let isSinglePlayer = false;
let gameMode = 'single'; 
let selectedPlayerIndex = null; 
let lastSelectedPerTeam = { 1:null, 2:null };

const VIRTUAL_WIDTH = 1200;
const VIRTUAL_HEIGHT = 700;
let scaleFactor = 1; 

let terrainCircles = [];    
let destroyedCircles = [];  
let players = [];           
let currentPlayerIndex = 0; 
let isAnimating = false;    
let explosionParticles = [];

let disconnectTimer = null;
const DISCONNECT_TIMEOUT = 60000; 

let formulaLogs = [];

let turnCount = 1;
let pendingCommand = null;
let commandProposerIndex = null;

function logToScreen(text, color = "#00aa00") {
    const consoleEl = document.getElementById('debugLog');
    if (consoleEl) {
        consoleEl.innerHTML += `<br><span style="color:${color};">${text}</span>`;
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

function addFormulaLog(playerName, formula) {
    const logContainer = document.getElementById('formulaLogContainer');
    if (!logContainer) return;

    formulaLogs.push({ name: playerName, formula: formula });
    if (formulaLogs.length > 50) {
        formulaLogs.shift();
    }

    logContainer.innerHTML = formulaLogs.map(log => {
        return `<div style="margin-bottom: 2px;"><strong>${log.name}</strong>: <span>${log.formula}</span></div>`;
    }).join('');
    
    logContainer.scrollTop = logContainer.scrollHeight;
}

const modeSelectStep = document.getElementById('modeSelectStep');
const inputStep = document.getElementById('inputStep');
const roomInputGroup = document.getElementById('roomInputGroup');
const joinButton = document.getElementById('joinButton');
const singleNameGroup = document.getElementById('singleNameGroup');
const multiNameGroup = document.getElementById('multiNameGroup');

document.getElementById('singlePlayBtn').addEventListener('click', () => {
    isSinglePlayer = true;
    modeSelectStep.style.display = 'none';
    inputStep.style.display = 'block';
    singleNameGroup.style.display = 'block';
    multiNameGroup.style.display = 'none';
    roomInputGroup.style.display = 'none';
    joinButton.innerText = "1人で遊ぶ (スタート)";
});

document.getElementById('multiPlayBtn').addEventListener('click', () => {
    isSinglePlayer = false;
    modeSelectStep.style.display = 'none';
    inputStep.style.display = 'block';
    singleNameGroup.style.display = 'none';
    multiNameGroup.style.display = 'block';
    roomInputGroup.style.display = 'block';
    joinButton.innerText = "対戦部屋に入る";
});

document.getElementById('backToModeBtn').addEventListener('click', () => {
    inputStep.style.display = 'none';
    modeSelectStep.style.display = 'block';
});

const waitingStep = document.getElementById('waitingStep');
const waitingStatusText = document.getElementById('waitingStatusText');
const cancelWaitBtn = document.getElementById('cancelWaitBtn');

joinButton.addEventListener('click', () => {
    const modeSelect = document.getElementById('gameModeSelect');
    if (modeSelect) gameMode = modeSelect.value;

    if (isSinglePlayer) {
        myPlayerId = 1;
        initGame();
        
        const p1Name = getSinglePlayerName(1);
        const p2Name = getSinglePlayerName(2);
        
        players.forEach(p => {
            p.name = (p.id === 1) ? p1Name : p2Name;
        });

        isGameReady = true;
        isAnimating = false;

        document.getElementById('lobbyModal').style.display = 'none';
        
        autoSelectActivePlayer();
        updateScale();
        updateTurnDisplay();
        updateTurnButtonState();
        drawStage();
    } else {
        const rawRoomCode = document.getElementById('roomInput').value.trim();
        if (!rawRoomCode) {
            alert("合言葉を入力してください");
            return;
        }
        currentRoomCode = `${gameMode}:${rawRoomCode}`;

        inputStep.style.display = 'none';
        waitingStep.style.display = 'block';
        waitingStatusText.innerText = `部屋「${rawRoomCode}」(${gameMode === 'trio' ? '3v3 Squads' : '1v1 Duels'}) で対戦相手を待っています...`;

        socket.emit('joinRoom', currentRoomCode, (response) => {
            if (response && response.status === 'ok') {
                logToScreen(`✅ サーバーが要請を受信しました。`, "#00ff00");
            }
        });
    }
});

cancelWaitBtn.addEventListener('click', () => {
    if (currentRoomCode) {
        socket.emit('leaveRoom', { roomCode: currentRoomCode });
        currentRoomCode = "";
    }
    
    myPlayerId = null; 
    waitingStep.style.display = 'none';
    inputStep.style.display = 'block';
});

function getSinglePlayerName(teamId) {
    const inputId = teamId === 1 ? 'p1NameInput' : 'p2NameInput';
    const nameInput = document.getElementById(inputId);
    if (nameInput && nameInput.value.trim() !== "") {
        return nameInput.value.trim();
    }
    return `Player ${teamId}`;
}

function getMyName() {
    const nameInput = document.getElementById('playerNameInput');
    if (nameInput && nameInput.value.trim() !== "") {
        return nameInput.value.trim();
    }
    return myPlayerId ? `Player ${myPlayerId}` : "Player";
}

socket.on('connect', () => {
    if(!myPlayerId) {
        turnDisplay.innerText = "接続成功。部屋を入力してください";
    }
});

socket.on('connect_error', (err) => {
    logToScreen(`❌ 通信接続エラー: ${err.message}`, "#ff3333");
});

socket.on('roomJoined', (data) => {
    myPlayerId = data.playerId;

    if (myPlayerId === 1 && !data.isReady) {
        waitingStep.style.display = 'block';
        inputStep.style.display = 'none';
    }
});

// startSyncProcess 内で自分の名前を維持・同期するように修正
socket.on('startSyncProcess', () => {
    if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
    }

    waitingStep.style.display = 'none';
    const lobbyModal = document.getElementById('lobbyModal');
    if (lobbyModal) lobbyModal.style.display = 'none';

    if (myPlayerId === 1) {
        initGame(); 
        const firstIndex = Math.floor(Math.random() * 2);
        currentPlayerIndex = firstIndex;
        const myName = getMyName();
        players.forEach(p => {
            if (p.id === 1) p.name = myName;
        });

        socket.emit('syncTerrain', {
            roomCode: currentRoomCode,
            terrain: terrainCircles,
            players: players,
            startingPlayerIndex: firstIndex 
        });
    }
});

socket.on('roomError', (msg) => {
    alert(msg); 
});

socket.on('receiveTerrain', (data) => {
    terrainCircles = data.terrain;
    players = data.players;
    destroyedCircles = [];

    if (data && typeof data.startingPlayerIndex === 'number') {
        currentPlayerIndex = data.startingPlayerIndex;
    } else {
        currentPlayerIndex = 0;
    }

    const myName = getMyName();
    players.forEach(p => {
        if (p.id === myPlayerId) p.name = myName;
    });

    isGameReady = true; 
    isAnimating = false; 
    turnCount = 1;
    pendingCommand = null;
    commandProposerIndex = null;
    
    if (formulaInput) formulaInput.value = "";
    
    document.getElementById('lobbyModal').style.display = 'none';
    document.getElementById('resultModal').style.display = 'none'; 
    
    autoSelectActivePlayer();
    updateScale(); 
    updateTurnDisplay();
    updateTurnButtonState();
    drawStage();
});

// 相手が再戦を押した時の処理
socket.on('opponentWantsRematch', () => {
    // リザルト画面内のメッセージを直接更新
    const resultMsg = document.getElementById('resultMessage');
    if (resultMsg) {
        resultMsg.innerText = "相手が再戦を希望しています！";
        resultMsg.style.color = "#ffdd57"; // 目立つように黄色に変更
        resultMsg.style.fontWeight = "bold";
    }

    // もし自分がまだ再戦ボタンを押していなければ、ボタンの表示も変えてアピール
    const rematchBtn = document.getElementById('rematchButton');
    if (rematchBtn && !rematchBtn.disabled) {
        rematchBtn.innerText = "相手が再戦希望中！ (タップして再戦)";
        rematchBtn.style.background = "#27ae60"; // 緑色を強調
    }
});


socket.on('receiveFormula', (data) => {
    const formula = (data && data.formula) ? data.formula : data;
    const senderName = (data && data.senderName) ? data.senderName : null;
    const remoteShooterIndex = (data && typeof data.shooterIndex === 'number') ? data.shooterIndex : null;

    if (remoteShooterIndex !== null && players[remoteShooterIndex]) {
        selectedPlayerIndex = remoteShooterIndex;
        if (senderName) {
            const remoteTeamId = players[remoteShooterIndex].id;
            players.forEach(p => {
                if (p.id === remoteTeamId) p.name = senderName;
            });
        }
    }
    
    executeFireShot(formula, true); 
});

socket.on('receiveCommand', (data) => {
    const { command, senderIndex } = data;
    const cmdKey = command.replace('--', '');

    if (command === '--skip') {
        addFormulaLog(getTeamName(senderIndex + 1), '--skip');
        switchTurn();
    } else if (command === '--reset' || command === '--end') {
        // ★ 自分がすでに提案済みで、相手が同じコマンドで応答してきた場合（合意成立）
        if (pendingCommand === cmdKey && commandProposerIndex !== senderIndex) {
            const nameToLog = getTeamName(senderIndex + 1);
            addFormulaLog(nameToLog, command);

            pendingCommand = null;
            commandProposerIndex = null;

            if (cmdKey === 'reset') {
                if (myPlayerId === 1) {
                    initGame();
                    currentPlayerIndex = Math.floor(Math.random() * 2);
                    socket.emit('syncTerrain', {
                        roomCode: currentRoomCode,
                        terrain: terrainCircles,
                        players: players,
                        startingPlayerIndex: currentPlayerIndex
                    });
                }
            } else if (cmdKey === 'end') {
                const team1Count = countTeamAlive(1);
                const team2Count = countTeamAlive(2);
                const team1Name = getTeamName(1);
                const team2Name = getTeamName(2);
                let endMsg = `合意により終了しました。(${team1Name}: ${team1Count}体 / ${team2Name}: ${team2Count}体)`;
                if (team1Count > team2Count) endMsg += ` → ${team1Name} の勝利！`;
                else if (team2Count > team1Count) endMsg += ` → ${team2Name} の勝利！`;
                else endMsg += " → 引き分け！";

                showResultMenu("GAME OVER", endMsg);
            }
        } 
        // ★ 相手から新たに提案が届いた場合
        else {
            addFormulaLog(getTeamName(senderIndex + 1), command);
            pendingCommand = cmdKey;
            commandProposerIndex = senderIndex;
            switchTurn();
        }
    }
});

socket.on('commandCancelled', (data) => {
    errorDisplay.innerText = "コマンド要求は相手によって拒否されました。";
    pendingCommand = null;
    commandProposerIndex = null;
    updateTurnDisplay();
    updateTurnButtonState();
});

socket.on('opponentDisconnected', () => {
    if (disconnectTimer) return; 

    turnDisplay.innerText = "⚠️ 相手の通信切断：再接続を待機中（60秒）";
    disableControlsTemporarily();

    disconnectTimer = setTimeout(() => {
        showResultMenu("対戦中断", "相手の通信が1分以上途絶えたため、ゲームを終了しました。");
        isGameReady = false;
    }, DISCONNECT_TIMEOUT);
});

socket.on('receiveAngleSync', (data) => {
    if (players[data.playerIndex]) {
        players[data.playerIndex].angle = data.angle;
        if (data.senderName) {
            const senderTeamId = players[data.playerIndex].id;
            players.forEach(p => {
                if (p.id === senderTeamId) p.name = data.senderName;
            });
        }
        drawStage();
    }
});

document.getElementById('rematchButton').addEventListener('click', () => {
    if (isSinglePlayer) {
        initGame();
        const p1Name = getSinglePlayerName(1);
        const p2Name = getSinglePlayerName(2);
        players.forEach(p => {
            p.name = (p.id === 1) ? p1Name : p2Name;
        });
        isGameReady = true;
        document.getElementById('resultModal').style.display = 'none';
        autoSelectActivePlayer();
        updateTurnDisplay();
        updateTurnButtonState();
    } else {
        socket.emit('requestRematch', { roomCode: currentRoomCode, myPlayerId: myPlayerId });
        
        // リザルト画面内で待機状態であることを明示
        const resultMsg = document.getElementById('resultMessage');
        if (resultMsg) {
            resultMsg.innerText = "相手の再戦同意を待っています...";
            resultMsg.style.color = "#aaa";
        }
        
        // 自分のボタンを押せないように固定
        const rematchBtn = document.getElementById('rematchButton');
        if (rematchBtn) {
            rematchBtn.disabled = true;
            rematchBtn.innerText = "相手の同意を待っています...";
            rematchBtn.style.opacity = "0.6";
        }
    }
});

document.getElementById('leaveButton').addEventListener('click', () => {
    location.reload(); 
});

function showResultMenu(title, message) {
    if (disconnectTimer) clearTimeout(disconnectTimer); 
    
    const resultTitle = document.getElementById('resultTitle');
    const resultMsg = document.getElementById('resultMessage');
    const rematchBtn = document.getElementById('rematchButton');

    if (resultTitle) resultTitle.innerText = title;
    if (resultMsg) {
        resultMsg.innerText = message;
        resultMsg.style.color = "#aaa"; // 色をデフォルトに戻す
    }
    
    if (rematchBtn) {
        rematchBtn.disabled = false;
        rematchBtn.innerText = "もう一度対戦（再戦）";
        rematchBtn.style.opacity = "1.0";
        rematchBtn.style.background = "#4a7c59";
    }

    document.getElementById('resultModal').style.display = 'flex';
}

function disableControlsTemporarily() {
    fireBtn.disabled = true;
    fireBtn.style.opacity = "0.5";
    fireBtn.style.cursor = "not-allowed";
}

function autoSelectActivePlayer() {
    const currentTeam = currentPlayerIndex + 1;
    let targetIndex = lastSelectedPerTeam[currentTeam];

    if (targetIndex !== null && players[targetIndex] && players[targetIndex].id === currentTeam && players[targetIndex].isAlive) {
        selectedPlayerIndex = targetIndex;
        syncAngleInput();
        return;
    }

    const foundIndex = players.findIndex(p => p.id === currentTeam && p.isAlive);
    selectedPlayerIndex = (foundIndex !== -1) ? foundIndex : null;
    lastSelectedPerTeam[currentTeam] = selectedPlayerIndex;

    syncAngleInput();
}

function syncAngleInput() {
    const angleInput = document.getElementById('angleInput');
    if (angleInput && selectedPlayerIndex !== null && players[selectedPlayerIndex]) {
        angleInput.value = players[selectedPlayerIndex].angle || 0;
    }
}

function switchTurn() {
    currentPlayerIndex = (currentPlayerIndex + 1) % 2;
    turnCount++;
    autoSelectActivePlayer();
    updateTurnDisplay();
    updateTurnButtonState();
}

function getTeamName(teamId) {
    const p = players.find(player => player.id === teamId);
    if (p && p.name) return p.name;
    return `Player ${teamId}`;
}

function checkTeamAlive(teamId) {
    return players.some(p => p.id === teamId && p.isAlive);
}

function countTeamAlive(teamId) {
    return players.filter(p => p.id === teamId && p.isAlive).length;
}

canvas.addEventListener('click', (e) => {
    if (!isGameReady || isAnimating) return;

    const activeTeam = currentPlayerIndex + 1;

    if (!isSinglePlayer && myPlayerId !== activeTeam) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const clickY = (e.clientY - rect.top) * (canvas.height / rect.height);

    const camX = VIRTUAL_WIDTH / 2;
    const camY = VIRTUAL_HEIGHT / 2;

    const worldClickX = (clickX - canvas.width / 2) / scaleFactor + camX;
    const worldClickY = (clickY - canvas.height / 2) / scaleFactor + camY;

    players.forEach((p, idx) => {
        if (p.id === activeTeam && p.isAlive) {
            const dist = Math.sqrt((worldClickX - p.x)**2 + (worldClickY - p.y)**2);
            if (dist < p.r + 30) {
                selectedPlayerIndex = idx;
                lastSelectedPerTeam[activeTeam] = idx;
                syncAngleInput();
                drawStage();
            }
        }
    });
});

function fireShot() {
    if (!isGameReady || isAnimating || disconnectTimer) return;
    
    if (!isSinglePlayer && myPlayerId !== (currentPlayerIndex + 1)) return;

    const currentFormula = formulaInput.value.trim();
    
    if (currentFormula === "") {
        errorDisplay.innerText = "数式またはコマンドを入力してください。";
        return;
    }

    if (currentFormula.startsWith('--')) {
        handleCommandInput(currentFormula.toLowerCase());
        return;
    }

    if (pendingCommand !== null) {
        if (currentPlayerIndex !== commandProposerIndex) {
            const proposerIdx = commandProposerIndex;
            pendingCommand = null;
            commandProposerIndex = null;

            if (!isSinglePlayer) {
                socket.emit('cancelCommand', { roomCode: currentRoomCode });
            }

            currentPlayerIndex = proposerIdx;
            formulaInput.value = "";
            errorDisplay.innerText = "コマンドを拒否し、相手にターンを戻しました。";
            autoSelectActivePlayer();
            updateTurnDisplay();
            updateTurnButtonState();
            return;
        }
    }

    const isFirstDeriv = currentFormula.toLowerCase().replace(/\s+/g, '').startsWith("y'=");
    const isSecondDeriv = currentFormula.toLowerCase().replace(/\s+/g, '').startsWith("y''=");
    const formulaString = parseFormula(currentFormula); 
    
    try { 
        if (isSecondDeriv) {
            new Function('x', 'y', 'dy', `return ${formulaString};`);
        } else if (isFirstDeriv) {
            new Function('x', 'y', `return ${formulaString};`);
        } else {
            new Function('x', `return ${formulaString};`); 
        }
    } catch(e) { 
        errorDisplay.innerText = `[構文エラー]: ${e.message}`; 
        return; 
    }

    const myName = getMyName();
    
    if (!isSinglePlayer) {
        socket.emit('sendFormula', { 
            roomCode: currentRoomCode, 
            formula: currentFormula,
            senderName: myName,
            shooterIndex: selectedPlayerIndex
        });
    }
    
    executeFireShot(currentFormula, false);
}

function handleCommandInput(cmdStr) {
    errorDisplay.innerText = "";
    
    if (cmdStr === '--skip') {
        const shooter = players[selectedPlayerIndex];
        addFormulaLog(shooter ? shooter.name : getTeamName(currentPlayerIndex + 1), '--skip');
        if (!isSinglePlayer) {
            socket.emit('sendCommand', {
                roomCode: currentRoomCode,
                command: '--skip',
                senderIndex: currentPlayerIndex
            });
        }
        formulaInput.value = "";
        switchTurn();
        return;
    }

    if (cmdStr === '--reset') {
/*
        if (turnCount > 1) {
            errorDisplay.innerText = "--reset はゲーム開始後の1ターン目のみ使用可能です。";
            return;
        }
*/

        executeOrProposeCommand('--reset', 'reset');
        return;
    }

    if (cmdStr === '--end') {
        executeOrProposeCommand('--end', 'end');
        return;
    }

    errorDisplay.innerText = `無効なコマンドです: ${cmdStr}`;
}

function executeOrProposeCommand(fullCmd, cmdKey) {
    const shooter = players[selectedPlayerIndex];
    const nameToLog = shooter ? shooter.name : getTeamName(currentPlayerIndex + 1);

    if (pendingCommand === cmdKey && commandProposerIndex !== currentPlayerIndex) {
        addFormulaLog(nameToLog, fullCmd);
        
        if (!isSinglePlayer) {
            socket.emit('sendCommand', {
                roomCode: currentRoomCode,
                command: fullCmd,
                senderIndex: currentPlayerIndex
            });
        }

        formulaInput.value = "";
        pendingCommand = null;
        commandProposerIndex = null;

        if (cmdKey === 'reset') {
            if (isSinglePlayer) {
                initGame();
                const p1Name = getSinglePlayerName(1);
                const p2Name = getSinglePlayerName(2);
                players.forEach(p => {
                    p.name = (p.id === 1) ? p1Name : p2Name;
                });
                autoSelectActivePlayer();
                updateTurnDisplay();
                updateTurnButtonState();
            } else if (myPlayerId === 1) {
                initGame();
                currentPlayerIndex = Math.floor(Math.random() * 2);
                socket.emit('syncTerrain', {
                    roomCode: currentRoomCode,
                    terrain: terrainCircles,
                    players: players,
                    startingPlayerIndex: currentPlayerIndex
                });
            }
        } else if (cmdKey === 'end') {
            const team1Count = countTeamAlive(1);
            const team2Count = countTeamAlive(2);
            const team1Name = getTeamName(1);
            const team2Name = getTeamName(2);
            let endMsg = `合意により終了しました。(${team1Name}: ${team1Count}体 / ${team2Name}: ${team2Count}体)`;
            if (team1Count > team2Count) endMsg += ` → ${team1Name} の勝利！`;
            else if (team2Count > team1Count) endMsg += ` → ${team2Name} の勝利！`;
            else endMsg += " → 引き分け！";

            showResultMenu("GAME OVER", endMsg);
        }
    } 
    else {
        addFormulaLog(nameToLog, fullCmd);
        pendingCommand = cmdKey;
        commandProposerIndex = currentPlayerIndex;

        if (!isSinglePlayer) {
            socket.emit('sendCommand', {
                roomCode: currentRoomCode,
                command: fullCmd,
                senderIndex: currentPlayerIndex
            });
        }

        formulaInput.value = "";
        switchTurn();
    }
}

function updateScale() {
    if (canvas.width === 0 || canvas.height === 0) return;
    const scaleX = canvas.width / VIRTUAL_WIDTH;
    const scaleY = canvas.height / VIRTUAL_HEIGHT;
    scaleFactor = Math.min(scaleX, scaleY);
}

function parseFormula(inputText) {
    let str = inputText.toLowerCase().replace(/\s+/g, '');
    if (str.startsWith('y=') && !str.includes("y'")) str = str.substring(2);
    if (str.startsWith("y'=") || str.startsWith("y''=")) {
        str = str.split('=')[1];
    }
    str = str.replace(/sin/g, 'Math.sin').replace(/cos/g, 'Math.cos').replace(/tan/g, 'Math.tan');
    str = str.replace(/abs/g, 'Math.abs').replace(/exp/g, 'Math.exp').replace(/sqrt/g, 'Math.sqrt').replace(/pi/g, 'Math.PI');
    str = str.replace(/log/g, 'Math.log10').replace(/ln/g, 'Math.log');
    str = str.replace(/\(([^()]+)\)\^([0-9.]+)/g, 'Math.pow(($1),$2)').replace(/([x0-9.y]+)\^([0-9.-]+)/g, 'Math.pow($1,$2)');
    str = str.replace(/(?<!Math\.)pow/g, 'Math.pow').replace(/([0-9])([a-z(])/g, '$1*$2').replace(/\)([0-9a-z])/g, ')*$1').replace(/x\(/g, 'x*(');
    return str;
}

function executeFireShot(targetFormula, isRemote = false) {
    errorDisplay.innerText = ""; 
    const isFirstDeriv = targetFormula.toLowerCase().replace(/\s+/g, '').startsWith("y'=");
    const isSecondDeriv = targetFormula.toLowerCase().replace(/\s+/g, '').startsWith("y''=");
    const formulaString = parseFormula(targetFormula); 

    if (selectedPlayerIndex === null || !players[selectedPlayerIndex] || !players[selectedPlayerIndex].isAlive) {
        autoSelectActivePlayer();
    }
    const p = players[selectedPlayerIndex];
    if (!p) return;
    
    const activePlayerName = p.name || `Player ${p.id}`;
    addFormulaLog(activePlayerName, targetFormula);

    let calculate;
    try { 
        if (isSecondDeriv) {
            calculate = new Function('x', 'y', 'dy', `return ${formulaString};`);
        } else if (isFirstDeriv) {
            calculate = new Function('x', 'y', `return ${formulaString};`);
        } else {
            calculate = new Function('x', `return ${formulaString};`); 
        }
    } catch(e) { 
        errorDisplay.innerText = `[エラー]: ${e.message}`; 
        isAnimating = false;
        updateTurnButtonState();
        return; 
    }
    
    const vOriginX = VIRTUAL_WIDTH / 2;
    const vOriginY = VIRTUAL_HEIGHT / 2;

    const dir = (p.x < VIRTUAL_WIDTH / 2) ? 1 : -1;
    const baseAngleRad = (p.angle || 0) * Math.PI / 180;
    
    const vx = Math.cos(baseAngleRad) * dir;
    const vy = -Math.sin(baseAngleRad); 

    let t = 0; 
    const step = 0.075;
    
    let currentBulletX = p.x;
    let currentBulletY = p.y;

    let lastFormulaY = (vOriginY - p.y) / 40; 
    let currentDY_Formula = 0; 

    isAnimating = true; 
    disableControlsTemporarily();
    let shotPath = []; 

    function checkShotResultAndEnd(finalX, finalY) {
        const team1Alive = checkTeamAlive(1);
        const team2Alive = checkTeamAlive(2);
        const team1Name = getTeamName(1);
        const team2Name = getTeamName(2);

        if (!team1Alive && !team2Alive) {
            playImpactCinematic(finalX, finalY, () => {
                turnDisplay.innerText = "DRAW GAME!";
                showResultMenu("GAME OVER", "両プレイヤーのユニットが全滅しました！引き分けです。");
            });
        } else if (!team1Alive) {
            playImpactCinematic(finalX, finalY, () => {
                turnDisplay.innerText = `${team2Name} WINS!!`;
                showResultMenu("GAME OVER", `${team2Name} の勝利です！`);
            });
        } else if (!team2Alive) {
            playImpactCinematic(finalX, finalY, () => {
                turnDisplay.innerText = `${team1Name} WINS!!`;
                showResultMenu("GAME OVER", `${team1Name} の勝利です！`);
            });
        } else {
            playImpactCinematic(finalX, finalY, () => { 
                switchTurn();
            });
        }
    }

    function playImpactCinematic(finalX, finalY, onComplete) {
        let duration = 60; let frame = 0; let currentZoom = 1.0;
        disableControlsTemporarily();
        function zoomAnimation() {
            frame++; currentZoom = 1.0 - (Math.sin((frame / duration) * (Math.PI / 2)) * 0.48);
            drawStage(finalX, finalY, currentZoom);
            
            ctx.save(); 
            ctx.translate(canvas.width / 2, canvas.height / 2); 
            ctx.scale(scaleFactor * currentZoom, scaleFactor * currentZoom); 
            ctx.translate(-finalX, -finalY);
            
            ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 2.5 / currentZoom; ctx.beginPath();
            shotPath.forEach((pt, idx) => { if (idx === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
            ctx.stroke(); ctx.restore();

            if (frame < duration) { 
                requestAnimationFrame(zoomAnimation); 
            } else {
                setTimeout(() => {
                    delete canvas.dataset.camX;
                    delete canvas.dataset.camY;

                    drawStage(); 
                    onComplete(); 
                    isAnimating = false; 
                    updateTurnButtonState();
                }, 400); 
            }
        }
        zoomAnimation();
    }

    function animate() {
        const baseX = p.x + vx * t * 40;
        const baseY = p.y + vy * t * 40;

        const worldX_Formula = (baseX - vOriginX) / 40;

        let finalCanvasX = baseX;
        let finalCanvasY = baseY;

        try {
            if (isSecondDeriv) {
                let ddy = calculate(worldX_Formula, lastFormulaY, currentDY_Formula);
                currentDY_Formula += ddy * step * dir;
                lastFormulaY += currentDY_Formula * step * dir;
                finalCanvasY = vOriginY - (lastFormulaY * 40);
            } else if (isFirstDeriv) {
                let dy = calculate(worldX_Formula, lastFormulaY);
                lastFormulaY += dy * step * dir;
                finalCanvasY = vOriginY - (lastFormulaY * 40);
            } else {
                const worldY_Formula = calculate(worldX_Formula);
                
                if (isNaN(worldY_Formula) || !isFinite(worldY_Formula)) {
                    throw new Error("数値が定義されていません");
                }
                
                const startX_Formula = (p.x - vOriginX) / 40;
                const startY_Formula = (vOriginY - p.y) / 40;
                const formulaAtStart = calculate(startX_Formula);
                const offsetY = startY_Formula - formulaAtStart;
                const currentMathY = worldY_Formula + offsetY;
                finalCanvasY = vOriginY - (currentMathY * 40);
            }
        } catch (e) {
            errorDisplay.innerText = `[実行エラー]: ${e.message}`; 
            isAnimating = false; 
            updateTurnButtonState(); 
            return; 
        }

        currentBulletX = finalCanvasX;
        currentBulletY = finalCanvasY;
        
        if (isNaN(currentBulletX) || !isFinite(currentBulletX) || isNaN(currentBulletY) || !isFinite(currentBulletY)) {
            checkShotResultAndEnd(p.x, p.y);
            return;
        }
        
        shotPath.push({ x: currentBulletX, y: currentBulletY });
        if (t === 0) { canvas.dataset.camX = currentBulletX; canvas.dataset.camY = currentBulletY; }
        let currentCamX = parseFloat(canvas.dataset.camX) || vOriginX; 
        let currentCamY = parseFloat(canvas.dataset.camY) || vOriginY;
        currentCamX += (currentBulletX - currentCamX) * 0.15; 
        currentCamY += (currentBulletY - currentCamY) * 0.15;
        canvas.dataset.camX = currentCamX; 
        canvas.dataset.camY = currentCamY;

        drawStage(currentCamX, currentCamY, 1.0);
        
        ctx.save(); 
        ctx.translate(canvas.width / 2, canvas.height / 2); 
        ctx.scale(scaleFactor, scaleFactor); 
        ctx.translate(-currentCamX, -currentCamY); 
        
        ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 2.5; ctx.beginPath();
        shotPath.forEach((pt, idx) => { if (idx === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.stroke(); ctx.fillStyle = '#ff3366'; ctx.beginPath(); ctx.arc(currentBulletX, currentBulletY, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();

        players.forEach((targetP, idx) => {
            if (targetP.isAlive) {
                if (targetP.id === p.id) return;

                const dist = Math.sqrt((currentBulletX - targetP.x)**2 + (currentBulletY - targetP.y)**2);
                if (dist < targetP.r + 2) {
                    targetP.isAlive = false;
                    explode(currentBulletX, currentBulletY, 20);
                }
            }
        });

        if (currentBulletX > VIRTUAL_WIDTH + 200 || currentBulletX < -200 || currentBulletY > VIRTUAL_HEIGHT * 2 || currentBulletY < -VIRTUAL_HEIGHT * 2) {
            checkShotResultAndEnd(currentBulletX, currentBulletY);
            return;
        }
        
        if (isInTerrain(currentBulletX, currentBulletY)) {
            explode(currentBulletX, currentBulletY, 20);
            checkShotResultAndEnd(currentBulletX, currentBulletY);
            return;
        }

        t += step; requestAnimationFrame(animate);
    }
    drawStage(p.x, p.y, 1.0); animate();
}

function updateTurnDisplay() {
    if (myPlayerId === null || !isGameReady) return;
    if (disconnectTimer) return; 
    
    let messageExtra = "";
    if (pendingCommand !== null) {
        const cmdText = `--${pendingCommand}`;
        const actionName = (pendingCommand === 'reset') ? 'リセット' : '終了';
        messageExtra = ` 【${actionName}要求中】${cmdText}で同意 / 式入力で拒否`;
    }

    const activeTeam = currentPlayerIndex + 1;
    const teamLabel = getTeamName(activeTeam);

    if (isSinglePlayer) {
        turnDisplay.innerText = `【${teamLabel}】のターンです！${messageExtra}`;
    } else {
        const isMyTurn = (currentPlayerIndex + 1 === myPlayerId);
        let identityText = `【あなた: ${getTeamName(myPlayerId)}】`;

        if (isMyTurn) { 
            turnDisplay.innerText = `${identityText} あなたのターンです！(操作ユニットを選択可)${messageExtra}`; 
        } else { 
            turnDisplay.innerText = `${identityText} 相手のターンを待っています...${messageExtra}`; 
        }
    }

    drawStage();
}

function updateTurnButtonState() {
    if (!isGameReady || disconnectTimer) { disableControlsTemporarily(); return; }
    const angleInput = document.getElementById('angleInput');
    const formulaInput = document.getElementById('formulaInput');

    const isMyTurn = isSinglePlayer || (myPlayerId === (currentPlayerIndex + 1));
    const isTeamAlive = checkTeamAlive(currentPlayerIndex + 1);

    if (!isAnimating && isTeamAlive && isMyTurn) {
        fireBtn.disabled = false; 
        fireBtn.style.opacity = "1.0"; 
        fireBtn.style.cursor = "pointer";
    } else {
        fireBtn.disabled = true;
        fireBtn.style.opacity = "0.5";
        fireBtn.style.cursor = "not-allowed";
    }

    if (angleInput) {
        syncAngleInput();
        angleInput.disabled = !isMyTurn;
        angleInput.style.opacity = isMyTurn ? "1.0" : "0.5";
    }

    if (formulaInput) {
        formulaInput.disabled = false;
        formulaInput.style.opacity = "1.0";
        formulaInput.style.cursor = "text";
    }

    document.querySelectorAll('.formula-preset').forEach(btn => {
        btn.style.opacity = "1.0";
        btn.style.cursor = "pointer";
    });
}

function initGame() {
    if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
    isAnimating = false; errorDisplay.innerText = "";
    turnCount = 1;
    lastSelectedPerTeam = { 1:null, 2:null };
    pendingCommand = null;
    commandProposerIndex = null;

    resizeCanvas();

    generateTerrain(); 
    placePlayers(); 
    
    const angleInput = document.getElementById('angleInput');
    if (angleInput) angleInput.value = "0";
    if (formulaInput) formulaInput.value = "";
    
    drawStage();
}

function createExplosionEffects(ex, ey) {
    for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 5;
        explosionParticles.push({
            x: ex, y: ey,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            radius: 3 + Math.random() * 4, alpha: 1.0,
            color: `rgba(255, ${50 + Math.floor(Math.random() * 100)}, 0, ` 
        });
    }
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    updateScale(); 
    drawStage();
}

function generateTerrain() {
    terrainCircles = []; 
    destroyedCircles = [];
    
    const targetCircles = Math.floor(10 + Math.random() * 6);
    
    let attempts = 0;
    let leftCount = 0;
    let rightCount = 0;

    while (terrainCircles.length < targetCircles && attempts < 3000) {
        attempts++;
        
        let isLeft;
        if (leftCount < 4 && terrainCircles.length >= targetCircles - 4) {
            isLeft = true;
        } else if (rightCount < 4 && terrainCircles.length >= targetCircles - 4) {
            isLeft = false;
        } else {
            isLeft = Math.random() < 0.5;
        }

        let rx = 0;
        if (isLeft) {
            rx = Math.random() * (VIRTUAL_WIDTH * 0.5); 
        } else {
            rx = (VIRTUAL_WIDTH * 0.5) + Math.random() * (VIRTUAL_WIDTH * 0.5); 
        }
        
        const newCircle = {
            x: rx,
            y: Math.random() * VIRTUAL_HEIGHT, 
            r: 50 + Math.random() * 60 
        };
        
        if (newCircle.x > VIRTUAL_WIDTH * 0.46 && newCircle.x < VIRTUAL_WIDTH * 0.54) {
            continue;
        }

        let tooClose = false;
        for (let c of terrainCircles) {
            const dist = Math.sqrt((newCircle.x - c.x)**2 + (newCircle.y - c.y)**2);
            const minCenterDistance = 100; 
            
            if (dist < minCenterDistance) { 
                tooClose = true; 
                break; 
            }
        }

        if (!tooClose) {
            terrainCircles.push(newCircle);
            if (isLeft) leftCount++; else rightCount++;
        }
    }
}

function placePlayers() {
    players = [];
    const countPerTeam = (gameMode === 'trio') ? 3 : 1;
    const minPlayerDistance = 3 * 40; 

    for (let team = 1; team <= 2; team++) {
        for (let i = 0; i < countPerTeam; i++) {
            players.push({
                id: team,
                unitIndex: i,
                x: 0,
                y: 0,
                r: 8,
                isAlive: true,
                angle: 0,
                name: `Player ${team}`
            });
        }
    }

    let validPlacement = false;
    let attempts = 0;

    while (!validPlacement && attempts < 10000) {
        attempts++;
        let p1IsLeft = Math.random() < 0.5;

        for (let p of players) {
            let isLeft = (p.id === 1) ? p1IsLeft : !p1IsLeft;
            let xMin = isLeft ? 0.05 : 0.65;
            p.x = VIRTUAL_WIDTH * xMin + Math.random() * (VIRTUAL_WIDTH * 0.30);
            p.y = VIRTUAL_HEIGHT * 0.15 + Math.random() * (VIRTUAL_HEIGHT * 0.70);
        }

        let tooClose = false;
        for (let i = 0; i < players.length; i++) {
            for (let j = i + 1; j < players.length; j++) {
                let dist = Math.hypot(players[i].x - players[j].x, players[i].y - players[j].y);
                if (dist < minPlayerDistance) {
                    tooClose = true;
                    break;
                }
            }
            if (tooClose) break;
        }
        if (tooClose) continue;

        let buried = false;
        for (let p of players) {
            const safeRadius = p.r + 20; 
            for (let c of terrainCircles) {
                let dist = Math.hypot(p.x - c.x, p.y - c.y);
                if (dist < (c.r + safeRadius)) {
                    buried = true;
                    break;
                }
            }
            if (buried) break;
        }

        if (!buried) validPlacement = true;
    }
}

function isInTerrain(px, py) {
    const inAnyTerrain = terrainCircles.some(c => ((px - c.x)**2 + (py - c.y)**2) < c.r**2);
    const inAnyDestroyed = destroyedCircles.some(c => ((px - c.x)**2 + (py - c.y)**2) < c.r**2);
    return inAnyTerrain && !inAnyDestroyed;
}

function drawStage(camX = VIRTUAL_WIDTH / 2, camY = VIRTUAL_HEIGHT / 2, zoom = 1) {
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const originX = VIRTUAL_WIDTH / 2; 
    const originY = VIRTUAL_HEIGHT / 2;

    ctx.save(); 
    ctx.translate(canvas.width / 2, canvas.height / 2); 
    ctx.scale(scaleFactor * zoom, scaleFactor * zoom); 
    ctx.translate(-camX, -camY);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4000, originY); ctx.lineTo(6000, originY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(originX, -4000); ctx.lineTo(originX, 6000); ctx.stroke();

    const baseFontSize = 20;
    ctx.font = `bold ${baseFontSize}px "Comic Sans MS", "Chalkboard SE", "Arial Rounded MT Bold", sans-serif`;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.fillStyle = '#000000';

    const xValues = [-15, -10, -5, 5, 10, 15];
    ctx.textAlign = 'center';
    xValues.forEach(val => {
        const canvasX = originX + (val * 40);
        const canvasY = originY - 10;
        
        ctx.strokeText(`${val}`, canvasX, canvasY);
        ctx.fillText(`${val}`, canvasX, canvasY);
    });

    const yValues = [-15, -10, -5, 5, 10, 15];
    ctx.textAlign = 'left';
    yValues.forEach(val => {
        const canvasX = originX + 10;
        const canvasY = originY - (val * 40) + (baseFontSize / 3);
        
        ctx.strokeText(`${val}`, canvasX, canvasY);
        ctx.fillText(`${val}`, canvasX, canvasY);
    });

    ctx.restore(); 

    terrainCanvas.width = canvas.width;
    terrainCanvas.height = canvas.height;
    
    tCtx.clearRect(0, 0, terrainCanvas.width, terrainCanvas.height);
    tCtx.save();
    tCtx.translate(canvas.width / 2, canvas.height / 2); 
    tCtx.scale(scaleFactor * zoom, scaleFactor * zoom); 
    tCtx.translate(-camX, -camY);

    tCtx.fillStyle = '#4a7c59'; 
    tCtx.beginPath();
    terrainCircles.forEach(c => { tCtx.moveTo(c.x + c.r, c.y); tCtx.arc(c.x, c.y, c.r, 0, Math.PI * 2); });
    tCtx.fill();
    
    tCtx.globalCompositeOperation = 'destination-out'; 
    tCtx.fillStyle = 'rgba(0, 0, 0, 1)'; 
    tCtx.beginPath();
    destroyedCircles.forEach(c => { tCtx.moveTo(c.x + c.r, c.y); tCtx.arc(c.x, c.y, c.r, 0, Math.PI * 2); });
    tCtx.fill(); 
    tCtx.restore();

    ctx.drawImage(terrainCanvas, 0, 0);

    ctx.save(); 
    ctx.translate(canvas.width / 2, canvas.height / 2); 
    ctx.scale(scaleFactor * zoom, scaleFactor * zoom); 
    ctx.translate(-camX, -camY);

    players.forEach((p, idx) => {
        if (p.isAlive) {
            let finalColor = (p.id === 1) ? '#0088cc' : '#e65100';

            ctx.fillStyle = finalColor; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
            
            if (idx === selectedPlayerIndex) {
                ctx.strokeStyle = '#000000'; 
                ctx.lineWidth = 3; 
                ctx.beginPath(); 
                ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2); 
                ctx.stroke();
            }

            ctx.save();
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.strokeText(p.name || `Player ${p.id}`, p.x, p.y - 18);
            
            ctx.fillStyle = '#000000';
            ctx.fillText(p.name || `Player ${p.id}`, p.x, p.y - 18);
            ctx.restore();

            const rad = ((p.angle || 0) * Math.PI) / 180;
            const dirX = (p.x < VIRTUAL_WIDTH / 2) ? 1 : -1;

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'; ctx.lineWidth = 2.5; ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + Math.cos(rad) * 30 * dirX, p.y - Math.sin(rad) * 30 * dirX);
            ctx.stroke();
        }
    });

    for (let i = explosionParticles.length - 1; i >= 0; i--) {
        let p = explosionParticles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.alpha -= 0.02; 
        if (p.alpha <= 0) { explosionParticles.splice(i, 1); continue; }
        ctx.save(); ctx.fillStyle = p.color + p.alpha + ")"; ctx.shadowBlur = 5; ctx.shadowColor = "#ff5500"; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.restore(); 
}

function explode(ex, ey, er) {
    destroyedCircles.push({x: ex, y: ey, r: er});
    createExplosionEffects(ex, ey);
}

function detectDevice() {
    const gameContainer = document.getElementById('game');
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) { gameContainer.classList.add('hud-touch'); } 
    else { gameContainer.classList.remove('hud-touch'); }
}

document.querySelectorAll('.formula-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!isGameReady) return; 
        formulaInput.value = e.target.getAttribute('data-formula');
    });
});

fireBtn.addEventListener('click', fireShot);
formulaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        fireShot();
    }
});

document.body.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'angleInput') {
        if (selectedPlayerIndex !== null && players[selectedPlayerIndex]) {
            const val = parseFloat(e.target.value) || 0;
            players[selectedPlayerIndex].angle = val;
            drawStage();
            if (!isSinglePlayer && currentRoomCode) {
                socket.emit('syncAngle', {
                    roomCode: currentRoomCode,
                    playerIndex: selectedPlayerIndex,
                    angle: val,
                    senderName: getMyName()
                });
            }
        }
    }
});

window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
    detectDevice();
    resizeCanvas();
});
