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
let unitsPerTeam = 3; 

let selectedPlayerIndex = null; 

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
        const modeEl = document.querySelector('input[name="unitMode"]:checked');
        unitsPerTeam = modeEl ? parseInt(modeEl.value) : 3;
        
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
            currentPlayerIndex: currentPlayerIndex,
            unitsPerTeam: unitsPerTeam
        });
    }
});

socket.on('receiveTerrain', (data) => {
    logToScreen(`🌍 地形・先行後攻が完全同期されました！ゲーム開始！`);
    terrainCircles = data.terrain;
    players = data.players;
    unitsPerTeam = data.unitsPerTeam || 3;
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
    drawStage();
});

// サーバーから「誰かが撃った」という情報が部屋全体（自分含む）に届いた
socket.on('receiveFormula', (data) => {
    logToScreen(`📢 弾道計算シミュレーションを開始します。`);
    if (players[data.shooterIndex]) {
        players[data.shooterIndex].angle = data.angle;
    }
    // 全員の画面で同時に全く同じ条件の発射関数を実行する
    executeFireShot(data.formula, data.shooterIndex, data.angle, data.startX, data.startY, data.shooterTeam);
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
    if (!isGameReady || isAnimating) return;

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
            if (dist < p.r + 20) { 
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
    const p = players[selectedPlayerIndex];

    // ローカルで即発射せず、一度サーバーに送信して「部屋全員で同時に発射」させる
    socket.emit('sendFormula', { 
        roomCode: currentRoomCode, 
        formula: currentFormula,
        shooterIndex: selectedPlayerIndex,
        angle: currentAngle,
        startX: p.x,
        startY: p.y,
        shooterTeam: p.team
    });
}

function updateScale() {
    if (canvas.width === 0 || canvas.height === 0) return;
    scaleFactor = Math.min(canvas.width / VIRTUAL_WIDTH, canvas.height / VIRTUAL_HEIGHT);
}

function executeFireShot(targetFormula, shooterIndex, shotAngle, startX, startY, shooterTeam) {
    errorDisplay.innerText = ""; 
    const formulaString = parseFormula(targetFormula); 
    
    let t = 0; 
    let dir = (shooterTeam === 1) ? 1 : -1; 
    let calculate;
    
    try { 
        calculate = new Function('x', `return ${formulaString};`); 
    } catch(e) { 
        errorDisplay.innerText = `[構文エラー]: ${e.message}`; 
        isAnimating = false; updateTurnButtonState(); return; 
    }
    
    const vOriginX = 600;
    const vOriginY = 350;

    const rad = (-shotAngle * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    const startX_Formula = (startX - vOriginX) / 20; 
    const startY_Formula = (vOriginY - startY) / 20;
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
    let hitPlayersMap = new Set();

    function playImpactCinematic(finalX, finalY, onComplete) {
        let duration = 25; let frame = 0;
        function zoomAnimation() {
            frame++; let currentZoom = 1.0 - (Math.sin((frame / duration) * (Math.PI / 2)) * 0.15);
            drawStage(finalX, finalY, currentZoom);
            if (frame < duration) { requestAnimationFrame(zoomAnimation); } 
            else { setTimeout(() => { drawStage(); onComplete(); }, 100); }
        }
        zoomAnimation();
    }

    function animate() {
        const baseFormulaX = startX_Formula + (t * dir); 
        let baseFormulaY;
        try { 
            baseFormulaY = calculate(baseFormulaX) + offsetByFormula; 
        } catch (e) { 
            handleLocalProjectileEnd();
            return; 
        }
        
        const relX = (baseFormulaX - startX_Formula) * 20;
        const relY = -(baseFormulaY - startY_Formula) * 20; 
        
        const rotatedRelX = relX * cosA - relY * sinA;
        const rotatedRelY = relX * sinA + relY * cosA;

        const canvasX = startX + rotatedRelX;
        const canvasY = startY + rotatedRelY;
        
        // 画面外判定
        if (isNaN(canvasX) || !isFinite(canvasX) || canvasX > VIRTUAL_WIDTH + 300 || canvasX < -300 || canvasY > VIRTUAL_HEIGHT + 300 || canvasY < -300) {
            playImpactCinematic(startX, startY, () => { 
                handleLocalProjectileEnd();
            }); 
            return;
        }
        
        shotPath.push({ x: canvasX, y: canvasY });
        drawStage(canvasX, canvasY, 1.0);
        
        ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.scale(scaleFactor, scaleFactor); ctx.translate(-canvasX, -canvasY); 
        ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 2.5; ctx.beginPath();
        shotPath.forEach((pt, idx) => { if (idx === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(canvasX, canvasY, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();

        // プレイヤーへの当たり判定
        for (let i = 0; i < players.length; i++) {
            let target = players[i];
            if (target.isAlive && !hitPlayersMap.has(i)) {
                if (t < 0.8 && target.x === startX && target.y === startY) continue;
                if (Math.sqrt((canvasX - target.x)**2 + (canvasY - target.y)**2) < target.r + 4) {
                    target.isAlive = false; 
                    hitPlayersMap.add(i);
                    explode(canvasX, canvasY, 20);
                }
            }
        }
        
        // 地形への衝突判定
        if (isInTerrain(canvasX, canvasY)) {
            explode(canvasX, canvasY, 25);
            playImpactCinematic(canvasX, canvasY, () => { 
                handleLocalProjectileEnd();
            }); 
            return;
        }
        
        t += 0.2; requestAnimationFrame(animate);
    }
    drawStage(startX, startY, 1.0); animate();
}

// 弾道計算がそれぞれの画面で終わった時に、各自の端末で独立して実行するターン変更ロジック
function handleLocalProjectileEnd() {
    isAnimating = false;
    
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
        // 次のターンへ移行（お互いの画面で同時にインデックスを切り替える）
        currentPlayerIndex = (currentPlayerIndex + 1) % 2;
        selectFirstAliveUnit();
        updateTurnDisplay();
        updateTurnButtonState();
        drawStage();
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
    const MIN_DISTANCE = 80;

    for (let k = 0; k < unitsPerTeam; k++) {
        let px, py, valid;
        let attempts = 0;
        do {
            valid = true;
            attempts++;
            px = VIRTUAL_WIDTH * 0.05 + Math.random() * (VIRTUAL_WIDTH * 0.25);
            py = VIRTUAL_HEIGHT * 0.15 + Math.random() * (VIRTUAL_HEIGHT * 0.7);

            if (isInTerrain(px, py)) {
                valid = false;
                continue;
            }
            for (let tc of terrainCircles) {
                let distToTerrain = Math.sqrt((px - tc.x)**2 + (py - tc.y)**2);
                if (distToTerrain < tc.r + 35) {
                    valid = false;
                    break;
                }
            }
            for (let existing of players) {
                let distToPlayer = Math.sqrt((px - existing.x)**2 + (py - existing.y)**2);
                if (distToPlayer < MIN_DISTANCE) {
                    valid = false;
                    break;
                }
            }
        } while (!valid && attempts < 300);
        players.push({ x: px, y: py, r: 9, team: 1, isAlive: true, angle: 0 });
    }

    for (let k = 0; k < unitsPerTeam; k++) {
        let px, py, valid;
        let attempts = 0;
        do {
            valid = true;
            attempts++;
            px = VIRTUAL_WIDTH * 0.70 + Math.random() * (VIRTUAL_WIDTH * 0.25);
            py = VIRTUAL_HEIGHT * 0.15 + Math.random() * (VIRTUAL_HEIGHT * 0.7);

            if (isInTerrain(px, py)) {
                valid = false;
                continue;
            }
            for (let tc of terrainCircles) {
                let distToTerrain = Math.sqrt((px - tc.x)**2 + (py - tc.y)**2);
                if (distToTerrain < tc.r + 35) {
                    valid = false;
                    break;
                }
            }
            for (let existing of players) {
                let distToPlayer = Math.sqrt((px - existing.x)**2 + (py - existing.y)**2);
                if (distToPlayer < MIN_DISTANCE) {
                    valid = false;
                    break;
                }
            }
        } while (!valid && attempts < 300);
        players.push({ x: px, y: py, r: 9, team: 2, isAlive: true, angle: 0 });
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
    
    const vOriginX = 600; 
    const vOriginY = 350; 
    
    ctx.save(); 
    ctx.translate(canvas.width / 2, canvas.height / 2); 
    ctx.scale(scaleFactor * zoom, scaleFactor * zoom); 
    ctx.translate(-camX, -camY);

    ctx.strokeStyle = '#2d3238'; ctx.lineWidth = 1;
    
    for (let x = vOriginX; x <= VIRTUAL_WIDTH; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, VIRTUAL_HEIGHT); ctx.stroke();
    }
    for (let x = vOriginX - 40; x >= 0; x -= 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, VIRTUAL_HEIGHT); ctx.stroke();
    }
    for (let y = vOriginY; y <= VIRTUAL_HEIGHT; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VIRTUAL_WIDTH, y); ctx.stroke();
    }
    for (let y = vOriginY - 40; y >= 0; y -= 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VIRTUAL_WIDTH, y); ctx.stroke();
    }

    ctx.strokeStyle = '#5c6370'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, vOriginY); ctx.lineTo(VIRTUAL_WIDTH, vOriginY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(vOriginX, 0); ctx.lineTo(vOriginX, VIRTUAL_HEIGHT); ctx.stroke();

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
