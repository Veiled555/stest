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

function getMyName() {
    const nameInput = document.getElementById('playerNameInput');
    if (nameInput && nameInput.value.trim() !== "") {
        return nameInput.value.trim();
    }
    return myPlayerId ? `Player${myPlayerId}` : "Player";
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
    
    const myName = getMyName();
    
    if (data.isHost) {
        logToScreen(`👑 あなたがホストです。相手を待ちます...`);
        initGame(); 
        if(players[0]) players[0].name = myName;
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
        if(players[0]) players[0].name = getMyName();
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
    
    if (myPlayerId === 2 && players[1]) {
        players[1].name = getMyName();
        socket.emit('syncAngle', {
            roomCode: currentRoomCode,
            playerIndex: 1,
            angle: players[1].angle,
            senderName: players[1].name
        });
    }
    if (myPlayerId === 1 && players[0]) {
        socket.emit('syncAngle', {
            roomCode: currentRoomCode,
            playerIndex: 0,
            angle: players[0].angle,
            senderName: players[0].name
        });
    }
    
    destroyedCircles = [];
    currentPlayerIndex = 0;
    isGameReady = true; 
    isAnimating = false; 
    
    // 💡【追加】盤面を同期して新しく始める（再戦含む）タイミングで、入力されていた式を空にする
    if (formulaInput) formulaInput.value = "";
    
    document.getElementById('lobbyModal').style.display = 'none';
    document.getElementById('resultModal').style.display = 'none'; 
    
    updateScale(); 
    updateTurnDisplay();
    updateTurnButtonState();
    drawStage();
});


socket.on('receiveFormula', (data) => {
    // 相手から送られてきたオブジェクトから式と名前を解析
    const formula = (data && data.formula) ? data.formula : data;
    const senderName = (data && data.senderName) ? data.senderName : null;
    
    if (players[currentPlayerIndex] && senderName) {
        // 相手の名前をプレイヤーオブジェクトに確実にセット
        players[currentPlayerIndex].name = senderName;
    }
    
    logToScreen(`📢 相手が数式を送信しました。発射シーケンスを開始します。`);
    executeFireShot(formula, true); 
});

socket.on('opponentDisconnected', () => {
    if (disconnectTimer) return; 

    logToScreen(`⚠️ 対戦相手の接続が切れました。1分間再接続を待ちます...`, "#ffcc00");
    turnDisplay.innerText = "⚠️ 相手の通信切断：再接続を待機中（60秒）";
    disableControlsTemporarily();

    disconnectTimer = setTimeout(() => {
        logToScreen(`⏰ 1分が経過しました。ゲームを終了します。`, "#ff3333");
        showResultMenu("対戦中断", "相手の通信が1分以上途絶えたため、ゲームを終了しました。");
        isGameReady = false;
    }, DISCONNECT_TIMEOUT);
});

socket.on('opponentWantsRematch', () => {
    logToScreen(`🔔 対戦相手が「再戦」を希望しています！`, "#ffdd00");
    if (myPlayerId === 1) {
        logToScreen(`👑 あなたがホストですので、新しいステージを作成してゲームを再開します...`);
        initGame();
        socket.emit('syncTerrain', {
            roomCode: currentRoomCode,
            terrain: terrainCircles,
            players: players
        });
    }
});

// 角度や名前の同期データを受信したとき
socket.on('receiveAngleSync', (data) => {
    if (players[data.playerIndex]) {
        players[data.playerIndex].angle = data.angle;
        if (data.senderName) {
            players[data.playerIndex].name = data.senderName;
        }
        drawStage();
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
}

function fireShot() {
    if (!isGameReady || isAnimating || disconnectTimer) return;
    if (myPlayerId !== (currentPlayerIndex + 1)) return;

    const currentFormula = formulaInput.value.trim();
    
    // 【改善点】式が空欄、またはスペースのみの場合は発射処理を完全ブロック
    if (currentFormula === "") {
        errorDisplay.innerText = "数式を入力してください。";
        return;
    }
    
    // 【改善点・エラー同期防止】送信前にローカル（自分側）で式が正しいか構文チェックを行う
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
        // 構文エラーがあればここでストップし、相手へのパケット送信は行わない
        errorDisplay.innerText = `[構文エラー]: ${e.message}`; 
        return; 
    }

    const myName = getMyName();
    
    // 構文に問題が無ければ、相手に送信して発射を実行する
    socket.emit('sendFormula', { 
        roomCode: currentRoomCode, 
        formula: currentFormula,
        senderName: myName 
    });
    
    executeFireShot(currentFormula, false);
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

// isRemote: 相手側の実行かどうかを表すフラグ
// isRemote: 相手側の実行かどうかを表すフラグ
function executeFireShot(targetFormula, isRemote = false) {
    errorDisplay.innerText = ""; 
    const isFirstDeriv = targetFormula.toLowerCase().replace(/\s+/g, '').startsWith("y'=");
    const isSecondDeriv = targetFormula.toLowerCase().replace(/\s+/g, '').startsWith("y''=");
    const formulaString = parseFormula(targetFormula); 
    const p = players[currentPlayerIndex];
    
    // 【💡改善点】名前が PLAYER 1 / 2 に戻るのを防ぐため、設定されているカスタム名を確実に最優先する
    const activePlayerName = p.name && !p.name.startsWith("PLAYER") ? p.name : (p.id === 1 ? (players[0].name || "Player 1") : (players[1].name || "Player 2"));
    
    // ログに記録する名前を強制的に固定
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

    const dir = (currentPlayerIndex === 0) ? 1 : -1;
    const baseAngleRad = (p.angle || 0) * Math.PI / 180;
    
    const vx = Math.cos(baseAngleRad) * dir;
    const vy = -Math.sin(baseAngleRad) * dir; 

    let t = 0; 
    const step = 0.075;
    
    let currentBulletX = p.x;
    let currentBulletY = p.y;

    let lastFormulaY = (vOriginY - p.y) / 40; 
    let currentDY_Formula = 0; 

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
                const startY_Formula = calculate(startX_Formula);
                
                const yDisplacement = (worldY_Formula - startY_Formula) * 40;
                finalCanvasY = baseY - yDisplacement;
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
            playImpactCinematic(p.x, p.y, () => { 
                currentPlayerIndex = (currentPlayerIndex + 1) % 2; 
                updateTurnDisplay(); 
            }); 
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

        if (currentBulletX > VIRTUAL_WIDTH + 200 || currentBulletX < -200 || currentBulletY > VIRTUAL_HEIGHT * 2 || currentBulletY < -VIRTUAL_HEIGHT * 2) {
            playImpactCinematic(currentBulletX, currentBulletY, () => { 
                currentPlayerIndex = (currentPlayerIndex + 1) % 2; 
                updateTurnDisplay(); 
            }); 
            return;
        }
        
        const targetPlayerIndex = (currentPlayerIndex + 1) % 2; 
        const target = players[targetPlayerIndex];
        
        if (target.isAlive && Math.sqrt((currentBulletX - target.x)**2 + (currentBulletY - target.y)**2) < target.r + 2) {
            target.isAlive = false; explode(currentBulletX, currentBulletY, 20);
            
            // 【💡改善点】勝利宣言ログでもカスタムされた名前を確実に固定
            const winnerName = p.name && !p.name.startsWith("PLAYER") ? p.name : activePlayerName;
            
            playImpactCinematic(currentBulletX, currentBulletY, () => { 
                turnDisplay.innerText = `${winnerName} WINS!!`; 
                showResultMenu("GAME OVER", `${winnerName} の勝利です！`);
            }); return;
        }
        if (t > 0.8 && Math.sqrt((currentBulletX - p.x)**2 + (currentBulletY - p.y)**2) < p.r + 2) {
            p.isAlive = false; explode(currentBulletX, currentBulletY, 20);
            
            // 自爆した側の名前
            const loserName = p.name && !p.name.startsWith("PLAYER") ? p.name : activePlayerName;
            
            playImpactCinematic(currentBulletX, currentBulletY, () => { 
                turnDisplay.innerText = `${loserName} SUICIDE!`; 
                showResultMenu("GAME OVER", `${loserName} が自爆しました。`);
            }); return;
        }
        
        if (isInTerrain(currentBulletX, currentBulletY)) {
            explode(currentBulletX, currentBulletY, 20);
            playImpactCinematic(currentBulletX, currentBulletY, () => { 
                currentPlayerIndex = (currentPlayerIndex + 1) % 2; 
                updateTurnDisplay(); 
            }); return;
        }
        t += step; requestAnimationFrame(animate);
    }
    drawStage(p.x, p.y, 1.0); animate();
}

function updateTurnDisplay() {
    if (myPlayerId === null || !isGameReady) return;
    if (disconnectTimer) return; 
    
    const p1Name = players[0]?.name || "PLAYER 1";
    const p2Name = players[1]?.name || "PLAYER 2";
    let identityText = (myPlayerId === 1) ? `【あなた: ${p1Name} (左)】` : `【あなた: ${p2Name} (右)】`;
    
    if (currentPlayerIndex + 1 === myPlayerId) { turnDisplay.innerText = `${identityText} あなたのターンです！`; } 
    else { turnDisplay.innerText = `${identityText} 相手のターンを待っています...`; }
}

function updateTurnButtonState() {
    if (!isGameReady || disconnectTimer) { disableControlsTemporarily(); return; }
    const angleInput = document.getElementById('angleInput');
    const formulaInput = document.getElementById('formulaInput');

    if (!isAnimating && players[0].isAlive && players[1].isAlive && myPlayerId === (currentPlayerIndex + 1)) {
        fireBtn.disabled = false; 
        fireBtn.style.opacity = "1.0"; 
        fireBtn.style.cursor = "pointer";
    } else {
        fireBtn.disabled = true;
        fireBtn.style.opacity = "0.5";
        fireBtn.style.cursor = "not-allowed";
    }

    if (angleInput) {
        angleInput.disabled = false;
        angleInput.style.opacity = "1.0";
        angleInput.style.cursor = "text";
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
    if (canvas.width === 0 || canvas.height === 0) {
        const containerRect = document.getElementById('game').getBoundingClientRect();
        canvas.width = containerRect.width || window.innerWidth;
        canvas.height = containerRect.height || window.innerHeight;
    }
    updateScale();
    generateTerrain(); 
    placePlayers(); 
    
    if(players[0]) players[0].name = (myPlayerId === 1) ? getMyName() : "PLAYER 1";
    if(players[1]) players[1].name = (myPlayerId === 2) ? getMyName() : "PLAYER 2";

    currentPlayerIndex = 0; 
    const angleInput = document.getElementById('angleInput');
    if (angleInput) angleInput.value = "0";
    
    // 💡【追加】再戦やゲーム初期化の際に、入力されていた式を空にする
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
    canvas.width = rect.width; canvas.height = rect.height;
    updateScale(); 
    drawStage();
}

function generateTerrain() {
    terrainCircles = []; destroyedCircles = [];
    const targetCircles = 7; let attempts = 0;
    while (terrainCircles.length < targetCircles && attempts < 1500) {
        attempts++;
        
        const isLeftOrRight = Math.random() < 0.5;
        let rx = 0;
        if (isLeftOrRight) {
            rx = VIRTUAL_WIDTH * 0.12 + Math.random() * VIRTUAL_WIDTH * 0.30; 
        } else {
            rx = VIRTUAL_WIDTH * 0.58 + Math.random() * VIRTUAL_WIDTH * 0.30; 
        }
        
        const newCircle = {
            x: rx,
            y: VIRTUAL_HEIGHT * 0.25 + Math.random() * VIRTUAL_HEIGHT * 0.55, 
            r: 40 + Math.random() * 50 
        };
        
        if (newCircle.x > VIRTUAL_WIDTH * 0.42 && newCircle.x < VIRTUAL_WIDTH * 0.58) {
            continue;
        }

        let tooClose = false;
        for (let c of terrainCircles) {
            const dist = Math.sqrt((newCircle.x - c.x)**2 + (newCircle.y - c.y)**2);
            if (dist < (newCircle.r + c.r + 50)) { tooClose = true; break; }
        }
        if (!tooClose) terrainCircles.push(newCircle);
    }
}

function isInTerrain(px, py) {
    const inAnyTerrain = terrainCircles.some(c => ((px - c.x)**2 + (py - c.y)**2) < c.r**2);
    const inAnyDestroyed = destroyedCircles.some(c => ((px - c.x)**2 + (py - c.y)**2) < c.r**2);
    return inAnyTerrain && !inAnyDestroyed;
}

// 【改善点】安全に生成するためのロジックの更なる厳格化（埋まり防止）
function placePlayers() {
    players = [];
    const minSafetyDistance = 135; // 安全判定を「半径3マス+α (135px)」に少しだけ強化

    for (let i = 0; i < 2; i++) {
        let placed = false;
        let px = 0;
        let py = 0;
        let attempts = 0;

        while (!placed && attempts < 2000) {
            attempts++;
            if (i === 0) {
                px = VIRTUAL_WIDTH * 0.08 + Math.random() * (VIRTUAL_WIDTH * 0.16); 
            } else {
                px = VIRTUAL_WIDTH * 0.76 + Math.random() * (VIRTUAL_WIDTH * 0.16);
            }
            py = VIRTUAL_HEIGHT * 0.15 + Math.random() * (VIRTUAL_HEIGHT * 0.65);

            // 1. 地形の「内部」に座標自体が入っていないか、かつ安全な余白距離があるかをダブルチェック
            let isInsideOrTooClose = false;
            for (let c of terrainCircles) {
                const dist = Math.sqrt((px - c.x)**2 + (py - c.y)**2);
                if (dist < (c.r + minSafetyDistance)) {
                    isInsideOrTooClose = true;
                    break;
                }
            }

            if (!isInsideOrTooClose && py < VIRTUAL_HEIGHT - 60) {
                players.push({ x: px, y: py, r: 8, id: i + 1, isAlive: true, angle: 0, name: `PLAYER ${i+1}` });
                placed = true;
            }
        }

        // 完全に安全なエリアが見つからなかったときの代替処置（画面端の安全な空中）
        if (!placed) {
            px = (i === 0) ? VIRTUAL_WIDTH * 0.08 : VIRTUAL_WIDTH * 0.92;
            py = VIRTUAL_HEIGHT * 0.2;
            players.push({ x: px, y: py, r: 8, id: i + 1, isAlive: true, angle: 0, name: `PLAYER ${i+1}` });
        }
    }
}

function drawStage(camX = VIRTUAL_WIDTH / 2, camY = VIRTUAL_HEIGHT / 2, zoom = 1) {
    if (!ctx) return;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const originX = VIRTUAL_WIDTH / 2; 
    const originY = VIRTUAL_HEIGHT / 2;

    ctx.save(); 
    ctx.translate(canvas.width / 2, canvas.height / 2); 
    ctx.scale(scaleFactor * zoom, scaleFactor * zoom); 
    ctx.translate(-camX, -camY);

    ctx.strokeStyle = '#999999'; 
    ctx.lineWidth = 1;
    
    ctx.beginPath();
    for (let x = originX; x < VIRTUAL_WIDTH + 2000; x += 40) { ctx.moveTo(x, -2000); ctx.lineTo(x, 4000); }
    for (let x = originX; x > -2000; x -= 40) { ctx.moveTo(x, -2000); ctx.lineTo(x, 4000); }
    for (let y = originY; y < 4000; y += 40) { ctx.moveTo(-2000, y); ctx.lineTo(VIRTUAL_WIDTH + 2000, y); }
    for (let y = originY; y > -2000; y -= 40) { ctx.moveTo(-2000, y); ctx.lineTo(VIRTUAL_WIDTH + 2000, y); }
    ctx.stroke();

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4000, originY); ctx.lineTo(6000, originY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(originX, -4000); ctx.lineTo(originX, 6000); ctx.stroke();
    
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

    players.forEach(p => {
        if (p.isAlive) {
            let finalColor = '#333333'; 
            if (myPlayerId === 1) { finalColor = (p.id === 1) ? '#0088cc' : '#e65100'; }
            else if (myPlayerId === 2) { finalColor = (p.id === 2) ? '#e65100' : '#0088cc'; }
            else { finalColor = (p.id === 1) ? '#0088cc' : '#e65100'; }

            ctx.fillStyle = finalColor; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
            
            if (players[currentPlayerIndex] && p.id === players[currentPlayerIndex].id) {
                ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2); ctx.stroke();
            }

            ctx.fillStyle = '#000000';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(p.name || `PLAYER ${p.id}`, p.x, p.y - 14);

            const rad = ((p.angle || 0) * Math.PI) / 180;
            const dirX = (p.id === 1) ? 1 : -1;
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
        const targetIdx = myPlayerId - 1;
        const myCharacter = players[targetIdx];
        if (myCharacter) { 
            const val = parseFloat(e.target.value) || 0;
            myCharacter.angle = val;
            drawStage();
            if (currentRoomCode) {
                socket.emit('syncAngle', {
                    roomCode: currentRoomCode,
                    playerIndex: targetIdx,
                    angle: val,
                    senderName: getMyName() // 【改善点・名前同期】角度調整のタイミングでも名前を同期
                });
            }
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
