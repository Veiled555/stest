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
    logToScreen(`✅ サーバーと通信が繋がりました！(SocketID: ${socket.id})`);
});

socket.on('connect_error', (err) => {
    logToScreen(`❌ 通信接続エラー: ${err.message}`, "#ff3333");
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

socket.on('roomError', (msg) => {
    logToScreen(`⚠️ 部屋エラー: ${msg}`, "#ff3333");
    turnDisplay.innerText = `⚠️ ${msg}`;
    alert(msg); 
});

socket.on('startSyncProcess', () => {
    if (disconnectTimer) {
        logToScreen(`✨ 对戦相手が再接続しました。タイマーを解除します。`, "#00ff00");
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
    }

    if (myPlayerId === 1) {
        logToScreen(`👥 相手が揃いました。地形データを送信します。`);
        socket.emit('syncTerrain', {
            roomCode: currentRoomCode,
            terrain: terrainCircles,
            players: players
        });
    }
});

socket.on('receiveTerrain', (data) => {
    logToScreen(`🌍 地形が完全同期されました！ゲーム開始！`);
    terrainCircles = data.terrain;
    players = data.players;
    destroyedCircles = [];
    currentPlayerIndex = 0;
    isGameReady = true; 
    isAnimating = false; 
    
    document.getElementById('lobbyModal').style.display = 'none';
    document.getElementById('resultModal').style.display = 'none'; 
    
    updateScale(); 
    updateTurnDisplay();
    updateTurnButtonState();
    drawStage();
});

socket.on('receiveFormula', (formula) => {
    logToScreen(`📢 相手が数式を送信しました。発射シーケンスを開始します。`);
    executeFireShot(formula);
});

socket.on('opponentDisconnected', () => {
    if (disconnectTimer) return; 

    logToScreen(`⚠️ 对戦相手の接続が切れました。1分間再接続を待ちます...`, "#ffcc00");
    turnDisplay.innerText = "⚠️ 相手の通信切断：再接続を待機中（60秒）";
    disableControlsTemporarily();

    disconnectTimer = setTimeout(() => {
        logToScreen(`⏰ 1分が経過しました。ゲームを終了します。`, "#ff3333");
        showResultMenu("対戦中断", "相手の通信が1分以上途絶えたため、ゲームを終了しました。");
        isGameReady = false;
    }, DISCONNECT_TIMEOUT);
});

socket.on('opponentWantsRematch', () => {
    logToScreen(`🔔 对戦相手が「再戦」を希望しています！`, "#ffdd00");
    if (myPlayerId === 1) {
        logToScreen(`👑 あなたがホストなので、新しいステージを作成してゲームを再開します...`);
        initGame();
        socket.emit('syncTerrain', {
            roomCode: currentRoomCode,
            terrain: terrainCircles,
            players: players
        });
    }
});

document.getElementById('joinButton').addEventListener('click', () => {
    const roomCode = document.getElementById('roomInput').value.trim();
    if (!roomCode) return;
    currentRoomCode = roomCode;

    logToScreen(`🚀 部屋「${roomCode}」への入場リクエストを送信します...`);
    socket.emit('joinRoom', roomCode, (response) => {
        if (response && response.status === 'ok') {
            logToScreen(`✅ サーバーが要請を受信しました。`, "#00ff00");
        }
    });
});

document.getElementById('rematchButton').addEventListener('click', () => {
    logToScreen(`🔄 再戦リクエストを送信しました...`);
    socket.emit('requestRematch', { roomCode: currentRoomCode, myPlayerId: myPlayerId });
    
    if (myPlayerId === 1) {
        initGame();
        socket.emit('syncTerrain', {
            roomCode: currentRoomCode,
            terrain: terrainCircles,
            players: players
        });
    } else {
        turnDisplay.innerText = "ホストが再戦を受け入れるのを待っています...";
    }
});

document.getElementById('leaveButton').addEventListener('click', () => {
    location.reload(); 
});

function showResultMenu(title, message) {
    if (disconnectTimer) clearTimeout(disconnectTimer); 
    document.getElementById('resultTitle').innerText = title;
    document.getElementById('resultMessage').innerText = message;
    document.getElementById('resultModal').style.display = 'flex';
}

function disableControlsTemporarily() {
    fireBtn.disabled = true;
    fireBtn.style.opacity = "0.5";
    fireBtn.style.cursor = "not-allowed";
    
    const angleInput = document.getElementById('angleInput');
    if (angleInput) {
        angleInput.disabled = true;
        angleInput.style.opacity = "0.5";
        angleInput.style.cursor = "not-allowed";
    }

    document.querySelectorAll('.formula-preset').forEach(btn => {
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
    });
}

function fireShot() {
    if (!isGameReady || isAnimating || disconnectTimer) return;
    if (myPlayerId !== (currentPlayerIndex + 1)) return;

    const currentFormula = formulaInput.value;
    socket.emit('sendFormula', { roomCode: currentRoomCode, formula: currentFormula });
    executeFireShot(currentFormula);
}

function updateScale() {
    if (canvas.width === 0 || canvas.height === 0) return;
    const scaleX = canvas.width / VIRTUAL_WIDTH;
    const scaleY = canvas.height / VIRTUAL_HEIGHT;
    scaleFactor = Math.min(scaleX, scaleY);
}

function executeFireShot(targetFormula) {
    errorDisplay.innerText = ""; 
    const formulaString = parseFormula(targetFormula); 
    const p = players[currentPlayerIndex];
    
    let t = 0; 
    let dir = (currentPlayerIndex === 0) ? 1 : -1;
    let calculate;
    
    try { 
        calculate = new Function('x', `return ${formulaString};`); 
    } catch(e) { 
        errorDisplay.innerText = `[構文エラー]: ${e.message}`; 
        isAnimating = false;
        updateTurnButtonState();
        return; 
    }
    
    const vOriginX = VIRTUAL_WIDTH / 2;
    const vOriginY = VIRTUAL_HEIGHT / 2;

    const rad = (-(p.angle || 0) * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    const startX_Formula = (p.x - vOriginX) / 20; 
    const startY_Formula = (vOriginY - p.y) / 20;
    let formulaY_AtPlayer = 0;
    
    try {
        formulaY_AtPlayer = calculate(startX_Formula);
        if (isNaN(formulaY_AtPlayer) || !isFinite(formulaY_AtPlayer)) { 
            errorDisplay.innerText = `[計算エラー]: 発射位置での値が不正です。`; 
            isAnimating = false;
            updateTurnButtonState();
            return; 
        }
    } catch(e) { 
        errorDisplay.innerText = `[実行エラー]: ${e.message}`; 
        isAnimating = false;
        updateTurnButtonState();
        return; 
    }

    const offsetByFormula = startY_Formula - formulaY_AtPlayer;
    
    isAnimating = true; 
    disableControlsTemporarily();
    let shotPath = []; 

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
        const baseFormulaX = startX_Formula + (t * dir); 
        let baseFormulaY;
        try { 
            baseFormulaY = calculate(baseFormulaX) + offsetByFormula; 
        } catch (e) { 
            errorDisplay.innerText = `[計算エラー]: ${e.message}`; 
            isAnimating = false; 
            updateTurnButtonState();
            return; 
        }
        
        const relX = (baseFormulaX - startX_Formula) * 20;
        const relY = -(baseFormulaY - startY_Formula) * 20;
        
        const rotatedRelX = relX * cosA - relY * sinA;
        const rotatedRelY = relX * sinA + relY * cosA;

        const canvasX = p.x + rotatedRelX;
        const canvasY = p.y + rotatedRelY;
        
        if (isNaN(canvasX) || isNaN(canvasY) || !isFinite(canvasX) || !isFinite(canvasY)) {
            playImpactCinematic(p.x, p.y, () => { 
                currentPlayerIndex = (currentPlayerIndex + 1) % 2; 
                updateTurnDisplay(); 
            }); 
            return;
        }
        
        shotPath.push({ x: canvasX, y: canvasY });
        if (t === 0) { canvas.dataset.camX = canvasX; canvas.dataset.camY = canvasY; }
        let currentCamX = parseFloat(canvas.dataset.camX) || vOriginX; 
        let currentCamY = parseFloat(canvas.dataset.camY) || vOriginY;
        currentCamX += (canvasX - currentCamX) * 0.15; 
        currentCamY += (canvasY - currentCamY) * 0.15;
        canvas.dataset.camX = currentCamX; 
        canvas.dataset.camY = currentCamY;

        drawStage(currentCamX, currentCamY, 1.0);
        
        ctx.save(); 
        ctx.translate(canvas.width / 2, canvas.height / 2); 
        ctx.scale(scaleFactor, scaleFactor); 
        ctx.translate(-currentCamX, -currentCamY); 
        
        ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 2.5; ctx.beginPath();
        shotPath.forEach((pt, idx) => { if (idx === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(canvasX, canvasY, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();

        if (canvasX > VIRTUAL_WIDTH + 200 || canvasX < -200 || canvasY > VIRTUAL_HEIGHT * 2 || canvasY < -VIRTUAL_HEIGHT * 2) {
            playImpactCinematic(canvasX, canvasY, () => { 
                currentPlayerIndex = (currentPlayerIndex + 1) % 2; 
                updateTurnDisplay(); 
            }); 
            return;
        }
        
        const targetPlayerIndex = (currentPlayerIndex + 1) % 2; 
        const target = players[targetPlayerIndex];
        
        if (target.isAlive && Math.sqrt((canvasX - target.x)**2 + (canvasY - target.y)**2) < target.r + 2) {
            target.isAlive = false; explode(canvasX, canvasY, 20);
            playImpactCinematic(canvasX, canvasY, () => { 
                turnDisplay.innerText = `PLAYER ${p.id} WINS!!`; 
                showResultMenu("GAME OVER", `PLAYER ${p.id} の勝利です！`);
            }); return;
        }
        if (t > 0.8 && Math.sqrt((canvasX - p.x)**2 + (canvasY - p.y)**2) < p.r + 2) {
            p.isAlive = false; explode(canvasX, canvasY, 20);
            playImpactCinematic(canvasX, canvasY, () => { 
                turnDisplay.innerText = `PLAYER ${p.id} SUICIDE!`; 
                showResultMenu("GAME OVER", `PLAYER ${p.id} が自爆しました。`);
            }); return;
        }
        
        if (isInTerrain(canvasX, canvasY)) {
            explode(canvasX, canvasY, 20);
            playImpactCinematic(canvasX, canvasY, () => { 
                currentPlayerIndex = (currentPlayerIndex + 1) % 2; 
                updateTurnDisplay(); 
            }); return;
        }
        t += 0.15; requestAnimationFrame(animate);
    }
    drawStage(p.x, p.y, 1.0); animate();
}

function updateTurnDisplay() {
    if (myPlayerId === null || !isGameReady) return;
    if (disconnectTimer) return; 
    let identityText = (myPlayerId === 1) ? "【あなた: PLAYER 1 (左)】" : "【あなた: PLAYER 2 (右)】";
    if (currentPlayerIndex + 1 === myPlayerId) { turnDisplay.innerText = `${identityText} あなたのターンです！`; } 
    else { turnDisplay.innerText = `${identityText} 相手のターンを待っています...`; }
}

function updateTurnButtonState() {
    if (!isGameReady || disconnectTimer) { disableControlsTemporarily(); return; }
    
    const angleInput = document.getElementById('angleInput');

    if (!isAnimating && players[0].isAlive && players[1].isAlive && myPlayerId === (currentPlayerIndex + 1)) {
        fireBtn.disabled = false; 
        fireBtn.style.opacity = "1.0"; 
        fireBtn.style.cursor = "pointer";
        if (angleInput) {
            angleInput.disabled = false;
            angleInput.style.opacity = "1.0";
            angleInput.style.cursor = "text";
        }
    } else {
        fireBtn.disabled = true;
        fireBtn.style.opacity = "0.5";
        fireBtn.style.cursor = "not-allowed";
        if (angleInput) {
            angleInput.disabled = true;
            angleInput.style.opacity = "0.5";
            angleInput.style.cursor = "not-allowed";
        }
    }

    document.querySelectorAll('.formula-preset').forEach(btn => {
        if (!isAnimating) {
            btn.style.opacity = "1.0";
            btn.style.cursor = "pointer";
        } else {
            btn.style.opacity = "0.5";
            btn.style.cursor = "not-allowed";
        }
    });
}

function initGame() {
    if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
    isAnimating = false; errorDisplay.innerText = "";
    if (canvas.width === 0 || canvas.height === 0) {
        const containerRect = document.getElementById('game').getBoundingClientRect();
        canvas.width = containerRect.width || window.innerWidth;
        canvas.height = containerRect.height || window.innerHeight;
    }
    updateScale();
    generateTerrain(); 
    placePlayers(); 
    currentPlayerIndex = 0; 
    
    const angleInput = document.getElementById('angleInput');
    if (angleInput) angleInput.value = "0";
    
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
            color: `rgba(255, ${100 + Math.floor(Math.random() * 155)}, 0, `
        });
    }
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    updateScale(); 
    drawStage();
}

function generateTerrain() {
    terrainCircles = []; destroyedCircles = [];
    const targetCircles = 7; let attempts = 0;
    while (terrainCircles.length < targetCircles && attempts < 1000) {
        attempts++;
        const newCircle = {
            x: VIRTUAL_WIDTH * 0.22 + Math.random() * VIRTUAL_WIDTH * 0.56,
            y: VIRTUAL_HEIGHT * 0.35 + Math.random() * VIRTUAL_HEIGHT * 0.45, 
            r: 45 + Math.random() * 60 
        };
        let tooClose = false;
        for (let c of terrainCircles) {
            const dist = Math.sqrt((newCircle.x - c.x)**2 + (newCircle.y - c.y)**2);
            if (dist < (newCircle.r + c.r + 40)) { tooClose = true; break; }
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
    
    const p1BaseX = VIRTUAL_WIDTH * 0.10 + Math.random() * (VIRTUAL_WIDTH * 0.12); 
    const p1BaseY = VIRTUAL_HEIGHT * 0.15 + Math.random() * (VIRTUAL_HEIGHT * 0.45); 

    const p2BaseX = VIRTUAL_WIDTH * 0.78 + Math.random() * (VIRTUAL_WIDTH * 0.12);
    const p2BaseY = VIRTUAL_HEIGHT * 0.15 + Math.random() * (VIRTUAL_HEIGHT * 0.45);

    for (let i = 0; i < 2; i++) {
        let px = (i === 0) ? p1BaseX : p2BaseX; 
        let py = (i === 0) ? p1BaseY : p2BaseY; 
        let isPlaced = false;
        
        while (py < VIRTUAL_HEIGHT - 20) {
            if (isInTerrain(px, py)) {
                py = py - 12; 
                players.push({ x: px, y: py, r: 8, id: i + 1, isAlive: true, angle: 0 });
                isPlaced = true; break;
            }
            py += 2;
        }
        if (!isPlaced) {
            py = (i === 0) ? p1BaseY : p2BaseY;
            players.push({ x: px, y: py, r: 8, id: i + 1, isAlive: true, angle: 0 });
        }
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
    
    originX = VIRTUAL_WIDTH / 2; 
    originY = VIRTUAL_HEIGHT / 2;

    ctx.save(); 
    ctx.translate(canvas.width / 2, canvas.height / 2); 
    ctx.scale(scaleFactor * zoom, scaleFactor * zoom); 
    ctx.translate(-camX, -camY);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)'; ctx.lineWidth = 1;
    for (let x = originX; x < VIRTUAL_WIDTH + 2000; x += 40) { ctx.moveTo(x, -2000); ctx.lineTo(x, 4000); }
    for (let x = originX; x > -2000; x -= 40) { ctx.moveTo(x, -2000); ctx.lineTo(x, 4000); }
    for (let y = originY; y < 4000; y += 40) { ctx.moveTo(-2000, y); ctx.lineTo(VIRTUAL_WIDTH + 2000, y); }
    for (let y = originY; y > -2000; y -= 40) { ctx.moveTo(-2000, y); ctx.lineTo(VIRTUAL_WIDTH + 2000, y); }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath(); ctx.moveTo(-4000, originY); ctx.lineTo(6000, originY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(originX, -4000); ctx.lineTo(originX, 6000); ctx.stroke();

    ctx.fillStyle = '#4a7c59'; ctx.beginPath();
    terrainCircles.forEach(c => { ctx.moveTo(c.x + c.r, c.y); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); });
    ctx.fill();
    
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.beginPath();
    destroyedCircles.forEach(c => { ctx.moveTo(c.x + c.r, c.y); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); });
    ctx.fill(); ctx.restore();

    players.forEach(p => {
        if (p.isAlive) {
            let finalColor = '#ffffff'; 
            if (myPlayerId === 1) { finalColor = (p.id === 1) ? '#00ffff' : '#ffffff'; }
            else if (myPlayerId === 2) { finalColor = (p.id === 2) ? '#ffdd00' : '#ffffff'; }
            else { finalColor = (p.id === 1) ? '#00ffff' : '#ffdd00'; }

            ctx.fillStyle = finalColor; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
            
            if (players[currentPlayerIndex] && p.id === players[currentPlayerIndex].id) {
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2); ctx.stroke();

                const rad = ((p.angle || 0) * Math.PI) / 180;
                const dirX = (p.id === 1) ? 1 : -1;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; ctx.lineWidth = 2.5; ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x + Math.cos(rad) * 30 * dirX, p.y - Math.sin(rad) * 30);
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
    createExplosionEffects(ex, ey);
}

function detectDevice() {
    const gameContainer = document.getElementById('game');
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) { gameContainer.classList.add('hud-touch'); } 
    else { gameContainer.classList.remove('hud-touch'); }
}

document.querySelectorAll('.formula-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!isGameReady || isAnimating) return;
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
        const activePlayer = players[currentPlayerIndex];
        if (activePlayer && activePlayer.id === myPlayerId) {
            activePlayer.angle = parseFloat(e.target.value) || 0;
            drawStage();
        }
    }
});

window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
    detectDevice();
    const rect = canvas.getBoundingClientRect(); canvas.width = rect.width; canvas.height = rect.height;
    updateScale();
    drawStage();
});


