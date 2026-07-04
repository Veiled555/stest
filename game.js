const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const fireBtn = document.getElementById('fireButton');
const resetBtn = document.getElementById('resetBtn');
const formulaInput = document.getElementById('formulaInput');
const errorDisplay = document.getElementById('errorDisplay');
const turnDisplay = document.getElementById('turnDisplay');
const controlBar = document.getElementById('controlBar'); 

// ⚠️ URLの末尾にスラッシュがないか再確認してください
const socket = io('https://stest-5wts.onrender.com');

let myPlayerId = null;
let currentRoomCode = "";
let isGameReady = false; 

let originX, originY;
let terrainCircles = [];    
let destroyedCircles = [];  
let players = [];           
let currentPlayerIndex = 0; 
let isAnimating = false;    
let explosionParticles = [];

// 🔧 デバッグログを画面上に強制的に書き出す関数
function logToScreen(text, color = "#00ff00") {
    const consoleEl = document.getElementById('debugLog');
    if (consoleEl) {
        consoleEl.innerHTML += `<br><span style="color:${color};">${text}</span>`;
        consoleEl.scrollTop = consoleEl.scrollHeight; // 常に最新のログにスクロール
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
        logToScreen(`👑 あなたがホストです。初期化処理を開始します...`);
        try {
            initGame(); 
            logToScreen(`✨ ホストのゲーム初期化（地形生成等）が正常に完了しました！`);
        } catch(e) {
            logToScreen(`❌ ホスト初期化中にエラー発生: ${e.message}`, "#ff3333");
        }
        isGameReady = false; 
        disableControlsTemporarily(); 
        turnDisplay.innerText = "対戦相手が参加するのを待っています...";
    } else {
        logToScreen(`👥 あなたがゲストです。ホストからの地形データを待機します。`);
        turnDisplay.innerText = "ホストの地形データを同期中...";
    }
});

// 2人揃った合図をサーバーから受け取ったとき
socket.on('startSyncProcess', () => {
    logToScreen(`📢 サーバーから「2人揃った」通知(startSyncProcess)を受信しました。`);
    if (myPlayerId === 1) {
        logToScreen(`👥 自分がホストなので、ゲストに向けて地形データを全送信します！`);
        socket.emit('syncTerrain', {
            roomCode: currentRoomCode,
            terrain: terrainCircles,
            players: players
        });
    }
});

socket.on('receiveTerrain', (data) => {
    logToScreen(`🌍 地形データをサーバー経由で受領しました。同期処理を実行します。`);
    try {
        terrainCircles = data.terrain;
        players = data.players;
        destroyedCircles = [];
        currentPlayerIndex = 0;
        isGameReady = true; 
        
        // 画面を消す処理
        const modal = document.getElementById('lobbyModal');
        if (modal) {
            modal.style.display = 'none';
            logToScreen(`🔓 lobbyModal（最初の画面）を非表示にしました。`);
        } else {
            logToScreen(`⚠️ エラー: lobbyModal という要素がHTMLに見つかりません！`, "#ffcc00");
        }
        
        updateTurnDisplay();
        updateTurnButtonState();
        drawStage();
        logToScreen(`🚀 全ての同期が完了し、ゲーム画面を描画しました！`);
    } catch(e) {
        logToScreen(`❌ 地形同期処理中にエラー発生: ${e.message}`, "#ff3333");
    }
});

socket.on('receiveFormula', (formula) => {
    formulaInput.value = formula;
    executeFireShot();
});

document.getElementById('joinButton').addEventListener('click', () => {
    const roomCode = document.getElementById('roomInput').value.trim();
    if (!roomCode) return;
    currentRoomCode = roomCode;

    logToScreen(`🚀 部屋「${roomCode}」への入場リクエストを送信します...`);
    socket.emit('joinRoom', roomCode);
});

function disableControlsTemporarily() {
    fireBtn.disabled = true;
    fireBtn.style.opacity = "0.5";
    fireBtn.style.cursor = "not-allowed";
    resetBtn.disabled = true;
    resetBtn.style.opacity = "0.5";
    resetBtn.style.cursor = "not-allowed";
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
    drawStage();
}

function generateTerrain() {
    terrainCircles = []; destroyedCircles = [];
    const targetCircles = 7; let attempts = 0;
    
    if (canvas.width === 0 || canvas.height === 0) {
        logToScreen(`⚠️ 警告: Canvasの横幅または縦幅が0です。(W:${canvas.width}, H:${canvas.height})`, "#ffcc00");
        return;
    }
    
    while (terrainCircles.length < targetCircles && attempts < 1000) {
        attempts++;
        const newCircle = {
            x: canvas.width * 0.1 + Math.random() * canvas.width * 0.8,
            y: canvas.height * 0.4 + Math.random() * canvas.height * 0.4, 
            r: 40 + Math.random() * 60 
        };
        let tooClose = false;
        for (let c of terrainCircles) {
            const dist = Math.sqrt((newCircle.x - c.x)**2 + (newCircle.y - c.y)**2);
            if (dist < (newCircle.r + c.r + 40)) { tooClose = true; break; }
        }
        if (!tooClose) terrainCircles.push(newCircle);
    }
    logToScreen(`🌳 地形を生成しました。円の数: ${terrainCircles.length}個 (試行回数: ${attempts})`);
}

// (中略 - 既存のゲームロジック関数はそのまま維持して安全に動かします)
function isInTerrain(px, py) {
    const inAnyTerrain = terrainCircles.some(c => ((px - c.x)**2 + (py - c.y)**2) < c.r**2);
    const inAnyDestroyed = destroyedCircles.some(c => ((px - c.x)**2 + (py - c.y)**2) < c.r**2);
    return inAnyTerrain && !inAnyDestroyed;
}

function placePlayers() {
    players = [];
    for (let i = 0; i < 2; i++) {
        let px = (i === 0) ? canvas.width * 0.12 : canvas.width * 0.88; 
        let py = canvas.height * 0.1; let isPlaced = false;
        while (py < canvas.height - 20) {
            if (isInTerrain(px, py)) {
                py = py - 40; if (py < 20) py = 30;
                players.push({ x: px, y: py, r: 8, id: i + 1, isAlive: true });
                isPlaced = true; break;
            }
            py++;
        }
        if (!isPlaced) {
            players.push({ x: px, y: canvas.height * 0.4, r: 8, id: i + 1, isAlive: true });
        }
    }
    logToScreen(`🏃 プレイヤーを配置しました。数: ${players.length}人`);
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

function drawStage(camX = canvas.width / 2, camY = canvas.height / 2, zoom = 1) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    originX = canvas.width / 2; originY = canvas.height / 2;
    ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.scale(zoom, zoom); ctx.translate(-camX, -camY);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)'; ctx.lineWidth = 1;
    for (let x = originX; x < canvas.width + 200; x += 40) { ctx.moveTo(x, -2000); ctx.lineTo(x, 4000); }
    for (let x = originX; x > -200; x -= 40) { ctx.moveTo(x, -2000); ctx.lineTo(x, 4000); }
    for (let y = originY; y < 4000; y += 40) { ctx.moveTo(-200, y); ctx.lineTo(canvas.width + 200, y); }
    for (let y = originY; y > -2000; y -= 40) { ctx.moveTo(-200, y); ctx.lineTo(canvas.width + 200, y); }
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
            if (p.id === players[currentPlayerIndex].id) {
                 ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2); ctx.stroke();
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

function fireShot() {
    if (!isGameReady || isAnimating || !players[currentPlayerIndex].isAlive) return;
    if (myPlayerId !== (currentPlayerIndex + 1)) return;
    socket.emit('sendFormula', { roomCode: currentRoomCode, formula: formulaInput.value });
    executeFireShot();
}

function executeFireShot() {
    errorDisplay.innerText = ""; const formulaString = parseFormula(formulaInput.value); const p = players[currentPlayerIndex];
    let t = 0; let dir = (currentPlayerIndex === 0) ? 1 : -1;
    let calculate;
    try { calculate = new Function('x', `return ${formulaString};`); } catch(e) { errorDisplay.innerText = `[構文エラー]: ${e.message}`; return; }
    const startX_Formula = (p.x - (canvas.width / 2)) / 20; const startY_Formula = ((canvas.height / 2) - p.y) / 20;
    let formulaY_AtPlayer = 0;
    try {
        formulaY_AtPlayer = calculate(startX_Formula);
        if (isNaN(formulaY_AtPlayer) || !isFinite(formulaY_AtPlayer)) { errorDisplay.innerText = `[計算エラー]: 発射位置での値が不正です。`; return; }
    } catch(e) { errorDisplay.innerText = `[実行エラー]: ${e.message}`; return; }

    const offsetByFormula = startY_Formula - formulaY_AtPlayer;
    isAnimating = true; disableControlsTemporarily();
    let shotPath = []; 

    function playImpactCinematic(finalX, finalY, onComplete) {
        let duration = 60; let frame = 0; let currentZoom = 1.0;
        disableControlsTemporarily();
        function zoomAnimation() {
            frame++; currentZoom = 1.0 - (Math.sin((frame / duration) * (Math.PI / 2)) * 0.48);
            const camX = finalX; const camY = finalY;
            drawStage(camX, camY, currentZoom);
            ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.scale(currentZoom, currentZoom); ctx.translate(-camX, -camY);
            ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 2.5 / currentZoom; ctx.beginPath();
            shotPath.forEach((pt, idx) => { if (idx === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
            ctx.stroke(); ctx.restore();

            if (frame < duration) { requestAnimationFrame(zoomAnimation); } 
            else {
                setTimeout(() => {
                    drawStage(); onComplete(); updateTurnButtonState();
                    if(myPlayerId === 1) { resetBtn.disabled = false; resetBtn.style.opacity = "1.0"; resetBtn.style.cursor = "pointer"; }
                }, 400); 
            }
        }
        zoomAnimation();
    }

    function animate() {
        const currentFormulaX = startX_Formula + (t * dir); let currentFormulaY;
        try { currentFormulaY = calculate(currentFormulaX) + offsetByFormula; } catch (e) { errorDisplay.innerText = `[計算エラー]: ${e.message}`; isAnimating = false; return; }
        const canvasX = (canvas.width / 2) + (currentFormulaX * 20); const canvasY = (canvas.height / 2) - (currentFormulaY * 20);
        if (isNaN(canvasX) || isNaN(canvasY) || !isFinite(canvasX) || !isFinite(canvasY)) {
            isAnimating = false; drawStage(); currentPlayerIndex = (currentPlayerIndex + 1) % 2; updateTurnDisplay(); return;
        }
        shotPath.push({ x: canvasX, y: canvasY });
        if (t === 0) { canvas.dataset.camX = canvasX; canvas.dataset.camY = canvasY; }
        let currentCamX = parseFloat(canvas.dataset.camX) || (canvas.width / 2); let currentCamY = parseFloat(canvas.dataset.camY) || (canvas.height / 2);
        currentCamX += (canvasX - currentCamX) * 0.15; currentCamY += (canvasY - currentCamY) * 0.15;
        canvas.dataset.camX = currentCamX; canvas.dataset.camY = currentCamY;

        drawStage(currentCamX, currentCamY, 1.0);
        ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.translate(-currentCamX, -currentCamY); 
        ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 2.5; ctx.beginPath();
        shotPath.forEach((pt, idx) => { if (idx === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(canvasX, canvasY, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();

        if (canvasX > canvas.width + 200 || canvasX < -200 || canvasY > canvas.height * 2 || canvasY < -canvas.height * 2) {
            isAnimating = false; playImpactCinematic(canvasX, canvasY, () => { currentPlayerIndex = (currentPlayerIndex + 1) % 2; updateTurnDisplay(); }); return;
        }
        const targetPlayerIndex = (currentPlayerIndex + 1) % 2; const target = players[targetPlayerIndex];
        if (target.isAlive && Math.sqrt((canvasX - target.x)**2 + (canvasY - target.y)**2) < target.r + 2) {
            target.isAlive = false; explode(canvasX, canvasY, 20); isAnimating = false;
            playImpactCinematic(canvasX, canvasY, () => { turnDisplay.innerText = `PLAYER ${p.id} WINS!!`; }); return;
        }
        if (t > 0.8 && Math.sqrt((canvasX - p.x)**2 + (canvasY - p.y)**2) < p.r + 2) {
            p.isAlive = false; explode(canvasX, canvasY, 20); isAnimating = false;
            playImpactCinematic(canvasX, canvasY, () => { turnDisplay.innerText = `PLAYER ${p.id} SUICIDE!`; }); return;
        }
        if (isInTerrain(canvasX, canvasY)) {
            explode(canvasX, canvasY, 20); isAnimating = false;
            playImpactCinematic(canvasX, canvasY, () => { currentPlayerIndex = (currentPlayerIndex + 1) % 2; updateTurnDisplay(); }); return;
        }
        t += 0.15; requestAnimationFrame(animate);
    }
    drawStage(p.x, p.y, 1.0); animate();
}

function updateTurnDisplay() {
    if (myPlayerId === null || !isGameReady) return;
    let identityText = (myPlayerId === 1) ? "【あなた: PLAYER 1 (左)】" : "【あなた: PLAYER 2 (右)】";
    if (currentPlayerIndex + 1 === myPlayerId) { turnDisplay.innerText = `${identityText} あなたのターンです！`; } 
    else { turnDisplay.innerText = `${identityText} 相手のターンを待っています...`; }
}

function updateTurnButtonState() {
    if (!isGameReady) { disableControlsTemporarily(); return; }
    if (players[0].isAlive && players[1].isAlive && myPlayerId === (currentPlayerIndex + 1)) {
        fireBtn.disabled = false; fireBtn.style.opacity = "1.0"; fireBtn.style.cursor = "pointer";
    } else {
        fireBtn.disabled = true; fireBtn.style.opacity = "0.5"; fireBtn.style.cursor = "not-allowed";
    }
    if (myPlayerId === 1 && !isAnimating) {
        resetBtn.disabled = false; resetBtn.style.opacity = "1.0"; resetBtn.style.cursor = "pointer";
    } else {
        resetBtn.disabled = true; resetBtn.style.opacity = "0.5"; resetBtn.style.cursor = "not-allowed";
    }
}

function initGame() {
    isAnimating = false; errorDisplay.innerText = "";
    
    // 💡 iPad等で最初ここが0になって失敗するケースを防ぐため、強制的に親要素のサイズを参照する安全策
    if (canvas.width === 0 || canvas.height === 0) {
        const containerRect = document.getElementById('game').getBoundingClientRect();
        canvas.width = containerRect.width || window.innerWidth;
        canvas.height = containerRect.height || window.innerHeight;
        logToScreen(`📏 Canvasのサイズを緊急強制設定しました (W:${canvas.width}, H:${canvas.height})`);
    }

    generateTerrain(); 
    placePlayers(); 
    currentPlayerIndex = 0; 
    drawStage();
}

function detectDevice() {
    const gameContainer = document.getElementById('game');
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) { gameContainer.classList.add('hud-touch'); } 
    else { gameContainer.classList.remove('hud-touch'); }
}

document.querySelectorAll('.formula-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!isGameReady || myPlayerId !== (currentPlayerIndex + 1)) return;
        formulaInput.value = e.target.getAttribute('data-formula');
    });
});

fireBtn.addEventListener('click', fireShot);
resetBtn.addEventListener('click', () => {
    if (myPlayerId === 1 && isGameReady) {
        initGame();
        socket.emit('syncTerrain', { roomCode: currentRoomCode, terrain: terrainCircles, players: players });
    }
});
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
    detectDevice();
    const rect = canvas.getBoundingClientRect(); canvas.width = rect.width; canvas.height = rect.height;
    drawStage();
});

