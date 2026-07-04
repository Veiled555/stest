const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const fireBtn = document.getElementById('fireButton');
const formulaInput = document.getElementById('formulaInput');
const errorDisplay = document.getElementById('errorDisplay');
const turnDisplay = document.getElementById('turnDisplay');
const controlBar = document.getElementById('controlBar'); 

const socket = io('https://stest-5wts.onrender.com', {
    transports: ['websocket']
});

let myPlayerId = null;
let currentRoomCode = "";
let isGameReady = false; 

const VIRTUAL_WIDTH = 1200;
const VIRTUAL_HEIGHT = 700;
let scaleFactor = 1; 

let terrainCircles = [];    
let destroyedCircles = [];  
let players = [];           
let currentPlayerIndex = 0; 
let isAnimating = false;    
let explosionParticles = [];

let selectedPlayerIndex = null; 

let disconnectTimer = null;
const DISCONNECT_TIMEOUT = 60000; 

function logToScreen(text, color = "#00ff00") {
    const consoleEl = document.getElementById('debugLog');
    if (consoleEl) {
        consoleEl.innerHTML += `<br><span style="color:${color};">${text}</span>`;
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

socket.on('connect', () => {
    if(!myPlayerId) {
        turnDisplay.innerText = "接続成功。部屋を入力してください";
    }
    logToScreen(`✅ サーバーと通信が繋がりました！`);
});

socket.on('roomJoined', (data) => {
    myPlayerId = data.playerId;
    logToScreen(`🎉 正式に部屋に入りました (PLAYER ${myPlayerId})`);
    
    if (data.isHost) {
        logToScreen(`👑 あなたがホストです。相手を待ちます...`);
        initGame(); 
        isGameReady = false; 
        disableControlsTemporarily(); 
        turnDisplay.innerText = "対戦相手が参加するのを待っています...";
    } else {
        logToScreen(`👥 あなたがゲストです。ホストから地形を貰います...`);
        turnDisplay.innerText = "ホストの地形データを同期中...";
    }
});

socket.on('startSyncProcess', () => {
    if (myPlayerId === 1) {
        logToScreen(`👥 相手が揃いました。ランダム先行・地形データを送信します。`);
        currentPlayerIndex = Math.random() < 0.5 ? 0 : 1;

        socket.emit('syncTerrain', {
            roomCode: currentRoomCode,
            terrain: terrainCircles,
            players: players,
            currentPlayerIndex: currentPlayerIndex 
        });
    }
});

socket.on('receiveTerrain', (data) => {
    logToScreen(`🌍 地形・先行後攻が完全同期されました！ゲーム開始！`);
    terrainCircles = data.terrain;
    players = data.players;
    destroyedCircles = [];
    
    currentPlayerIndex = data.currentPlayerIndex !== undefined ? data.currentPlayerIndex : 0;
    
    isGameReady = true; 
    isAnimating = false; 
    
    selectFirstAliveUnit();

    document.getElementById('lobbyModal').style.display = 'none';
    document.getElementById('resultModal').style.display = 'none'; 
    
    updateScale(); 
    updateTurnDisplay();
    updateTurnButtonState();
    drawStage();
});

socket.on('receiveActiveUnit', (unitIndex) => {
    const opponentTeam = (myPlayerId === 1) ? 2 : 1;
    if (players[unitIndex] && players[unitIndex].team === opponentTeam) {
        logToScreen(`🎯 相手がユニットを変更しました。`);
        drawStage();
    }
});

socket.on('receiveFormula', (data) => {
    logToScreen(`📢 相手が数式を送信しました。発射シーケンスを開始します。`);
    executeFireShot(data.formula, data.shooterIndex, data.angle);
});

function selectFirstAliveUnit() {
    selectedPlayerIndex = null;
    for (let i = 0; i < players.length; i++) {
        if (players[i].team === myPlayerId && players[i].isAlive) {
            selectedPlayerIndex = i;
            const angleInput = document.getElementById('angleInput');
            if (angleInput) angleInput.value = players[i].angle || 0;
            break;
        }
    }
}

canvas.addEventListener('click', (e) => {
    if (!isGameReady || isAnimating || myPlayerId !== (currentPlayerIndex + 1)) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const vCamX = VIRTUAL_WIDTH / 2;
    const vCamY = VIRTUAL_HEIGHT / 2;

    const mouseVX = (clickX - canvas.width / 2) / scaleFactor + vCamX;
    const mouseVY = (clickY - canvas.height / 2) / scaleFactor + vCamY;

    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (p.team === myPlayerId && p.isAlive) {
            const dist = Math.sqrt((mouseVX - p.x)**2 + (mouseVY - p.y)**2);
            if (dist < p.r + 25) { 
                selectedPlayerIndex = i;
                logToScreen(`🎯 ユニット選択変更: Unit [${i}]`);
                
                const angleInput = document.getElementById('angleInput');
                if (angleInput) angleInput.value = p.angle || 0;

                socket.emit('selectUnit', { roomCode: currentRoomCode, unitIndex: i });
                
                drawStage();
                break;
            }
        }
    }
});

document.getElementById('joinButton').addEventListener('click', () => {
    const roomCode = document.getElementById('roomInput').value.trim();
    if (!roomCode) return;
    currentRoomCode = roomCode;
    socket.emit('joinRoom', roomCode, (response) => {});
});

document.getElementById('rematchButton').addEventListener('click', () => {
    socket.emit('requestRematch', { roomCode: currentRoomCode, myPlayerId: myPlayerId });
    if (myPlayerId === 1) {
        initGame();
        currentPlayerIndex = Math.random() < 0.5 ? 0 : 1;
        socket.emit('syncTerrain', { roomCode: currentRoomCode, terrain: terrainCircles, players: players, currentPlayerIndex: currentPlayerIndex });
    }
});

document.getElementById('leaveButton').addEventListener('click', () => { location.reload(); });

function showResultMenu(title, message) {
    document.getElementById('resultTitle').innerText = title;
    document.getElementById('resultMessage').innerText = message;
    document.getElementById('resultModal').style.display = 'flex';
}

function disableControlsTemporarily() {
    fireBtn.disabled = true; fireBtn.style.opacity = "0.5";
    document.querySelectorAll('.formula-preset').forEach(btn => { btn.style.opacity = "0.5"; btn.style.cursor = "not-allowed"; });
}

function fireShot() {
    if (!isGameReady || isAnimating || selectedPlayerIndex === null) return;
    if (myPlayerId !== (currentPlayerIndex + 1)) return;

    const currentFormula = formulaInput.value;
    const angleInput = document.getElementById('angleInput');
    const currentAngle = angleInput ? parseFloat(angleInput.value) || 0 : 0;

    players[selectedPlayerIndex].angle = currentAngle;

    socket.emit('sendFormula', { 
        roomCode: currentRoomCode, 
        formula: currentFormula,
        shooterIndex: selectedPlayerIndex,
        angle: currentAngle
    });

    executeFireShot(currentFormula, selectedPlayerIndex, currentAngle);
}

function updateScale() {
    if (canvas.width === 0 || canvas.height === 0) return;
    scaleFactor = Math.min(canvas.width / VIRTUAL_WIDTH, canvas.height / VIRTUAL_HEIGHT);
}

function executeFireShot(targetFormula, shooterIndex, shotAngle) {
    errorDisplay.innerText = ""; 
    const formulaString = parseFormula(targetFormula); 
    const p = players[shooterIndex]; 
    
    let t = 0; 
    let dir = (p.team === 1) ? 1 : -1; 
    let calculate;
    
    try { 
        calculate = new Function('x', `return ${formulaString};`); 
    } catch(e) { 
        errorDisplay.innerText = `[構文エラー]: ${e.message}`; 
        isAnimating = false; updateTurnButtonState(); return; 
    }
    
    const vOriginX = VIRTUAL_WIDTH / 2;
    const vOriginY = VIRTUAL_HEIGHT / 2;

    const rad = (shotAngle * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    const startX_Formula = (p.x - vOriginX) / 20; 
    const startY_Formula = (vOriginY - p.y) / 20;
    let formulaY_AtPlayer = 0;
    
    try {
        formulaY_AtPlayer = calculate(startX_Formula);
        if (isNaN(formulaY_AtPlayer) || !isFinite(formulaY_AtPlayer)) { 
            errorDisplay.innerText = `[計算エラー]`; isAnimating = false; updateTurnButtonState(); return; 
        }
    } catch(e) { errorDisplay.innerText = `[実行エラー]`; isAnimating = false; updateTurnButtonState(); return; }

    const offsetByFormula = startY_Formula - formulaY_AtPlayer;
    
    isAnimating = true; 
    disableControlsTemporarily();
    let shotPath = []; 

    function playImpactCinematic(finalX, finalY, onComplete) {
        let duration = 50; let frame = 0;
        function zoomAnimation() {
            frame++; let currentZoom = 1.0 - (Math.sin((frame / duration) * (Math.PI / 2)) * 0.4);
            drawStage(finalX, finalY, currentZoom);
            if (frame < duration) { requestAnimationFrame(zoomAnimation); } 
            else { setTimeout(() => { drawStage(); onComplete(); isAnimating = false; updateTurnButtonState(); }, 300); }
        }
        zoomAnimation();
    }

    function animate() {
        const baseFormulaX = startX_Formula + (t * dir); 
        let baseFormulaY;
        try { 
            baseFormulaY = calculate(baseFormulaX) + offsetByFormula; 
        } catch (e) { isAnimating = false; updateTurnButtonState(); return; }
        
        const relX = (baseFormulaX - startX_Formula) * 20;
        const relY = -(baseFormulaY - startY_Formula) * 20; 
        
        const rotatedRelX = relX * cosA - relY * sinA;
        const rotatedRelY = relX * sinA + relY * cosA;

        const canvasX = p.x + rotatedRelX;
        const canvasY = p.y + rotatedRelY;
        
        if (isNaN(canvasX) || !isFinite(canvasX)) {
            playImpactCinematic(p.x, p.y, () => { nextTurn(); }); return;
        }
        
        shotPath.push({ x: canvasX, y: canvasY });
        drawStage(canvasX, canvasY, 1.0);
        
        ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.scale(scaleFactor, scaleFactor); ctx.translate(-canvasX, -canvasY); 
        ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 2.5; ctx.beginPath();
        shotPath.forEach((pt, idx) => { if (idx === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(canvasX, canvasY, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();

        if (canvasX > VIRTUAL_WIDTH + 300 || canvasX < -300 || canvasY > VIRTUAL_HEIGHT * 2 || canvasY < -VIRTUAL_HEIGHT * 2) {
            playImpactCinematic(canvasX, canvasY, () => { nextTurn(); }); return;
        }
        
        for (let target of players) {
            if (target.isAlive && Math.sqrt((canvasX - target.x)**2 + (canvasY - target.y)**2) < target.r + 2) {
                if (t < 0.8 && target === p) continue;

                target.isAlive = false; 
                explode(canvasX, canvasY, 25);
                
                playImpactCinematic(canvasX, canvasY, () => { checkGameEnd(); }); 
                return;
            }
        }
        
        if (isInTerrain(canvasX, canvasY)) {
            explode(canvasX, canvasY, 25);
            playImpactCinematic(canvasX, canvasY, () => { nextTurn(); }); return;
        }
        t += 0.15; requestAnimationFrame(animate);
    }
    drawStage(p.x, p.y, 1.0); animate();
}

// 💡 (このコメントだけ残します。処理上必要な関数のため)
function nextTurn() {
    currentPlayerIndex = (currentPlayerIndex + 1) % 2;
    selectFirstAliveUnit();
    updateTurnDisplay();
    updateTurnButtonState();
    drawStage();
}

function checkGameEnd() {
    const team1Alive = players.some(p => p.team === 1 && p.isAlive);
    const team2Alive = players.some(p => p.team === 2 && p.isAlive);

    if (!team1Alive && !team2Alive) {
        showResultMenu("GAME OVER", "まさかの引き分け（相打ち）です！");
        isGameReady = false;
    } else if (!team2Alive) {
        showResultMenu("GAME OVER", "PLAYER 1 (チーム青) の勝利です！");
        isGameReady = false;
    } else if (!team1Alive) {
        showResultMenu("GAME OVER", "PLAYER 2 (チーム黄) の勝利です！");
        isGameReady = false;
    } else {
        nextTurn();
    }
}

function updateTurnDisplay() {
    if (myPlayerId === null || !isGameReady) return;
    let identityText = (myPlayerId === 1) ? "【あなた: PLAYER 1 (青チーム)】" : "【あなた: PLAYER 2 (黄チーム)】";
    if (currentPlayerIndex + 1 === myPlayerId) { turnDisplay.innerText = `${identityText} あなたのターン！操作ユニットをタップできます`; } 
    else { turnDisplay.innerText = `${identityText} 相手のターンを待っています...`; }
}

function updateTurnButtonState() {
    if (!isGameReady) { disableControlsTemporarily(); return; }
    if (!isAnimating && myPlayerId === (currentPlayerIndex + 1) && selectedPlayerIndex !== null) {
        fireBtn.disabled = false; fireBtn.style.opacity = "1.0"; fireBtn.style.cursor = "pointer";
        document.querySelectorAll('.formula-preset').forEach(btn => { btn.style.opacity = "1.0"; btn.style.cursor = "pointer"; });
    } else {
        disableControlsTemporarily();
    }
}

function initGame() {
    isAnimating = false; errorDisplay.innerText = "";
    if (canvas.width === 0 || canvas.height === 0) {
        const containerRect = document.getElementById('game').getBoundingClientRect();
        canvas.width = containerRect.width; canvas.height = containerRect.height;
    }
    updateScale();
    generateTerrain(); 
    placePlayers(); 
    drawStage();
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect(); canvas.width = rect.width; canvas.height = rect.height;
    updateScale(); drawStage();
}

function generateTerrain() {
    terrainCircles = []; destroyedCircles = [];
    const targetCircles = 8; let attempts = 0;
    while (terrainCircles.length < targetCircles && attempts < 1000) {
        attempts++;
        const newCircle = {
            x: VIRTUAL_WIDTH * 0.18 + Math.random() * VIRTUAL_WIDTH * 0.64,
            y: VIRTUAL_HEIGHT * 0.35 + Math.random() * VIRTUAL_HEIGHT * 0.45, 
            r: 45 + Math.random() * 65 
        };
        let tooClose = false;
        for (let c of terrainCircles) {
            if (Math.sqrt((newCircle.x - c.x)**2 + (newCircle.y - c.y)**2) < (newCircle.r + c.r + 30)) { tooClose = true; break; }
        }
        if (!tooClose) terrainCircles.push(newCircle);
    }
}

function isInTerrain(px, py) {
    const inAnyTerrain = terrainCircles.some(c => ((px - c.x)**2 + (py - c.y)**2) < c.r**2);
    const inAnyDestroyed = destroyedCircles.some(c => ((px - c.x)**2 + (py - c.y)**2) < c.r**2);
    return inAnyTerrain && !inAnyDestroyed;
}

function placePlayers() {
    players = [];
    const UNITS_PER_TEAM = 3;

    for (let k = 0; k < UNITS_PER_TEAM; k++) {
        let px = VIRTUAL_WIDTH * 0.06 + Math.random() * (VIRTUAL_WIDTH * 0.22);
        let py = VIRTUAL_HEIGHT * 0.10 + Math.random() * (VIRTUAL_HEIGHT * 0.55);
        let isPlaced = false;
        while (py < VIRTUAL_HEIGHT - 20) {
            if (isInTerrain(px, py)) {
                py = py - 12;
                players.push({ x: px, y: py, r: 9, team: 1, isAlive: true, angle: 0 });
                isPlaced = true; break;
            }
            py += 2;
        }
        if (!isPlaced) players.push({ x: px, y: VIRTUAL_HEIGHT * 0.3, r: 9, team: 1, isAlive: true, angle: 0 });
    }

    for (let k = 0; k < UNITS_PER_TEAM; k++) {
        let px = VIRTUAL_WIDTH * 0.72 + Math.random() * (VIRTUAL_WIDTH * 0.22);
        let py = VIRTUAL_HEIGHT * 0.10 + Math.random() * (VIRTUAL_HEIGHT * 0.55);
        let isPlaced = false;
        while (py < VIRTUAL_HEIGHT - 20) {
            if (isInTerrain(px, py)) {
                py = py - 12;
                players.push({ x: px, y: py, r: 9, team: 2, isAlive: true, angle: 0 });
                isPlaced = true; break;
            }
            py += 2;
        }
        if (!isPlaced) players.push({ x: px, y: VIRTUAL_HEIGHT * 0.3, r: 9, team: 2, isAlive: true, angle: 0 });
    }
}

function parseFormula(inputText) {
    let str = inputText.toLowerCase().replace(/\s+/g, '');
    if (str.startsWith('y=')) str = str.substring(2);
    str = str.replace(/sin/g, 'Math.sin').replace(/cos/g, 'Math.cos').replace(/tan/g, 'Math.tan');
    str = str.replace(/abs/g, 'Math.abs').replace(/exp/g, 'Math.exp').replace(/sqrt/g, 'Math.sqrt').replace(/pi/g, 'Math.PI');
    str = str.replace(/\(([^()]+)\)\^([0-9.]+)/g, 'Math.pow(($1),$2)').replace(/([x0-9.]+)\^([0-9.]+)/g, 'Math.pow($1,$2)');
    str = str.replace(/(?<!Math\.)pow/g, 'Math.pow').replace(/([0-9])([a-z(])/g, '$1*$2').replace(/\)([0-9a-z])/g, ')*$1').replace(/x\(/g, 'x*(');
    return str;
}

function drawStage(camX = VIRTUAL_WIDTH / 2, camY = VIRTUAL_HEIGHT / 2, zoom = 1) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    originX = VIRTUAL_WIDTH / 2; originY = VIRTUAL_HEIGHT / 2;
    ctx.save(); 
    ctx.translate(canvas.width / 2, canvas.height / 2); 
    ctx.scale(scaleFactor * zoom, scaleFactor * zoom); 
    ctx.translate(-camX, -camY);

    ctx.fillStyle = '#4a7c59'; ctx.beginPath();
    terrainCircles.forEach(c => { ctx.moveTo(c.x + c.r, c.y); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); });
    ctx.fill();
    
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.beginPath();
    destroyedCircles.forEach(c => { ctx.moveTo(c.x + c.r, c.y); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); });
    ctx.fill(); ctx.restore();

    players.forEach((p, index) => {
        if (p.isAlive) {
            ctx.fillStyle = (p.team === 1) ? '#00ffff' : '#ffdd00';
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();

            if (index === selectedPlayerIndex && p.team === (currentPlayerIndex + 1)) {
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; 
                ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2); ctx.stroke();

                const rad = ((p.angle || 0) * Math.PI) / 180;
                const dirX = (p.team === 1) ? 1 : -1;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'; ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x + Math.cos(rad) * 25 * dirX, p.y - Math.sin(rad) * 25);
                ctx.stroke();
            }
        }
    });

    for (let i = explosionParticles.length - 1; i >= 0; i--) {
        let p = explosionParticles[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.alpha -= 0.02; 
        if (p.alpha <= 0) { explosionParticles.splice(i, 1); continue; }
        ctx.save(); ctx.fillStyle = p.color + p.alpha + ")"; ctx.shadowBlur = 10; ctx.shadowColor = "#ff5500"; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.restore(); 
}

function explode(ex, ey, er) {
    destroyedCircles.push({x: ex, y: ey, r: er});
    for (let i = 0; i < 35; i++) {
        const angle = Math.random() * Math.PI * 2; const speed = 2 + Math.random() * 5;
        explosionParticles.push({
            x: ex, y: ey, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            radius: 3 + Math.random() * 4, alpha: 1.0, color: `rgba(255, ${120 + Math.floor(Math.random() * 135)}, 0, `
        });
    }
}

function detectDevice() {
    const gameContainer = document.getElementById('game');
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) { gameContainer.classList.add('hud-touch'); } 
}

document.body.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'angleInput') {
        if (selectedPlayerIndex !== null && players[selectedPlayerIndex]) {
            players[selectedPlayerIndex].angle = parseFloat(e.target.value) || 0;
            drawStage();
        }
    }
});

document.querySelectorAll('.formula-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!isGameReady || myPlayerId !== (currentPlayerIndex + 1) || isAnimating) return;
        formulaInput.value = e.target.getAttribute('data-formula');
    });
});

fireBtn.addEventListener('click', fireShot);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
    detectDevice();
    const rect = canvas.getBoundingClientRect(); canvas.width = rect.width; canvas.height = rect.height;
    updateScale(); drawStage();
});
