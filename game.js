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

let originX, originY;
let terrainCircles = [];    
let destroyedCircles = [];  
let players = [];           
let currentPlayerIndex = 0; 
let isAnimating = false;    
let explosionParticles = [];

// 💡 追加：切断検知用タイマーの管理変数
let disconnectTimer = null;
const DISCONNECT_TIMEOUT = 60000; // 1分（60秒）

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

socket.on('startSyncProcess', () => {
    // 💡 相手が（再起動などで）戻ってきた場合はタイマーを解除する
    if (disconnectTimer) {
        logToScreen(`✨ 対戦相手が再接続しました。タイマーを解除します。`, "#00ff00");
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
    isAnimating = false; // アニメーションロックも解除
    
    document.getElementById('lobbyModal').style.display = 'none';
    document.getElementById('resultModal').style.display = 'none'; 
    
    updateTurnDisplay();
    updateTurnButtonState();
    drawStage();
});

// 💡 修正①：相手が撃った数式が自分の入力欄を上書きしないように修正
socket.on('receiveFormula', (formula) => {
    logToScreen(`📢 相手が数式を送信しました。発射シーケンスを開始します。`);
    // 自分の入力欄（formulaInput.value）は書き換えず、引数として渡して実行する
    executeFireShot(formula);
});

// 💡 修正③：相手の通信が切れたら1分間のカウントダウンを開始する
socket.on('opponentDisconnected', () => {
    if (disconnectTimer) return; // 既にタイマーが動いていれば何もしない

    logToScreen(`⚠️ 対戦相手の接続が切れました。1分間再接続を待ちます...`, "#ffcc00");
    turnDisplay.innerText = "⚠️ 相手の通信切断：再接続を待機中（60秒）";
    
    // 相手が切れている間は操作できないようにロック
    disableControlsTemporarily();

    disconnectTimer = setTimeout(() => {
        logToScreen(`⏰ 1分が経過しました。ゲームを終了します。`, "#ff3333");
        showResultMenu("対戦中断", "相手の通信が1分以上途絶えたため、ゲームを終了しました。");
        isGameReady = false;
    }, DISCONNECT_TIMEOUT);
});

socket.on('opponentWantsRematch', () => {
    logToScreen(`🔔 対戦相手が「再戦」を希望しています！`, "#ffdd00");
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
    logToScreen(`🔄 再戦リクエストを送信しました。相手の同意を待ちます...`);
    socket.emit('requestRematch', { roomCode: currentRoomCode, myPlayerId: myPlayerId });
});

document.getElementById('leaveButton').addEventListener('click', () => {
    location.reload(); 
});

function showResultMenu(title, message) {
    if (disconnectTimer) clearTimeout(disconnectTimer); // タイマーが残っていれば消す
    document.getElementById('resultTitle').innerText = title;
    document.getElementById('resultMessage').innerText = message;
    document.getElementById('resultModal').style.display = 'flex';
}

function disableControlsTemporarily() {
    fireBtn.disabled = true;
    fireBtn.style.opacity = "0.5";
    fireBtn.style.cursor = "not-allowed";
}

// 💡 修正②：自分のターンかつ、アニメーション中でないか、相手の通信待機中でないかを厳密にチェック
function fireShot() {
    if (!isGameReady || isAnimating || disconnectTimer) return;
    
    // 自分のターン（currentPlayerIndex + 1 === myPlayerId）でなければ絶対に発射させない
    if (myPlayerId !== (currentPlayerIndex + 1)) {
        logToScreen(`⚠️ あなたのターンではありません！`, "#ffcc00");
        return;
    }

    const currentFormula = formulaInput.value;
    // 相手に数式を送る
    socket.emit('sendFormula', { roomCode: currentRoomCode, formula: currentFormula });
    // 自分側の画面で発射処理を走らせる
    executeFireShot(currentFormula);
}

// 💡 修正①・②：数式を引数（targetFormula）として受け取る形にして独立化
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
    
    const startX_Formula = (p.x - (canvas.width / 2)) / 20; 
    const startY_Formula = ((canvas.height / 2) - p.y) / 20;
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
    
    // 🚀 アニメーションロックをここで強制ON
    isAnimating = true; 
    disableControlsTemporarily();
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

            if (frame < duration) { 
                requestAnimationFrame(zoomAnimation); 
            } else {
                setTimeout(() => {
                    drawStage(); 
                    onComplete(); 
                    // 💥 アニメーションが完全に終わったのでロックを解除して次のターンのボタン判定へ
                    isAnimating = false; 
                    updateTurnButtonState();
                }, 400); 
            }
        }
        zoomAnimation();
    }

    function animate() {
        const currentFormulaX = startX_Formula + (t * dir); 
        let currentFormulaY;
        try { 
            currentFormulaY = calculate(currentFormulaX) + offsetByFormula; 
        } catch (e) { 
            errorDisplay.innerText = `[計算エラー]: ${e.message}`; 
            isAnimating = false; 
            updateTurnButtonState();
            return; 
        }
        
        const canvasX = (canvas.width / 2) + (currentFormulaX * 20); 
        const canvasY = (canvas.height / 2) - (currentFormulaY * 20);
        
        if (isNaN(canvasX) || isNaN(canvasY) || !isFinite(canvasX) || !isFinite(canvasY)) {
            playImpactCinematic(p.x, p.y, () => { 
                currentPlayerIndex = (currentPlayerIndex + 1) % 2; 
                updateTurnDisplay(); 
            }); 
            return;
        }
        
        shotPath.push({ x: canvasX, y: canvasY });
        if (t === 0) { canvas.dataset.camX = canvasX; canvas.dataset.camY = canvasY; }
        let currentCamX = parseFloat(canvas.dataset.camX) || (canvas.width / 2); 
        let currentCamY = parseFloat(canvas.dataset.camY) || (canvas.height / 2);
        currentCamX += (canvasX - currentCamX) * 0.15; 
        currentCamY += (canvasY - currentCamY) * 0.15;
        canvas.dataset.camX = currentCamX; 
        canvas.dataset.camY = currentCamY;

        drawStage(currentCamX, currentCamY, 1.0);
        ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.translate(-currentCamX, -currentCamY); 
        ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 2.5; ctx.beginPath();
        shotPath.forEach((pt, idx) => { if (idx === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(canvasX, canvasY, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();

        if (canvasX > canvas.width + 200 || canvasX < -200 || canvasY > canvas.height * 2 || canvasY < -canvas.height * 2) {
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
    if (disconnectTimer) return; // 💡 切断待機中は表示を固定する
    let identityText = (myPlayerId === 1) ? "【あなた: PLAYER 1 (左)】" : "【あなた: PLAYER 2 (右)】";
    if (currentPlayerIndex + 1 === myPlayerId) { turnDisplay.innerText = `${identityText} あなたのターンです！`; } 
    else { turnDisplay.innerText = `${identityText} 相手のターンを待っています...`; }
}

function updateTurnButtonState() {
    if (!isGameReady || disconnectTimer) { disableControlsTemporarily(); return; }
    
    // 💡 修正②：自分のターン、かつ弾が飛んでいない（isAnimatingがfalse）の時だけボタンを有効化
    if (!isAnimating && players[0].isAlive && players[1].isAlive && myPlayerId === (currentPlayerIndex + 1)) {
        fireBtn.disabled = false; fireBtn.style.opacity = "1.0"; fireBtn.style.cursor = "pointer";
    } else {
        disableControlsTemporarily();
    }
}

function initGame() {
    if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
    isAnimating = false; errorDisplay.innerText = "";
    if (canvas.width === 0 || canvas.height === 0) {
        const containerRect = document.getElementById('game').getBoundingClientRect();
        canvas.width = containerRect.width || window.innerWidth;
        canvas.height = containerRect.height || window.innerHeight;
    }
    generateTerrain(); placePlayers(); currentPlayerIndex = 0; drawStage();
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
    if (canvas.width === 0 || canvas.height === 0) return;
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
}

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
            if (players[currentPlayerIndex] && p.id === players[currentPlayerIndex].id) {
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

function detectDevice() {
    const gameContainer = document.getElementById('game');
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) { gameContainer.classList.add('hud-touch'); } 
    else { gameContainer.classList.remove('hud-touch'); }
}

document.querySelectorAll('.formula-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!isGameReady || myPlayerId !== (currentPlayerIndex + 1) || isAnimating) return;
        formulaInput.value = e.target.getAttribute('data-formula');
    });
});

fireBtn.addEventListener('click', fireShot);
// Enterキーでの誤発射を防ぐガードを強化
formulaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        fireShot();
    }
});

window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
    detectDevice();
    const rect = canvas.getBoundingClientRect(); canvas.width = rect.width; canvas.height = rect.height;
    drawStage();
});
