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

// 画面表示制御要素の取得
const modeSelectStep = document.getElementById('modeSelectStep');
const inputStep = document.getElementById('inputStep');
const roomInputGroup = document.getElementById('roomInputGroup');
const joinButton = document.getElementById('joinButton');

// 「1人で遊ぶ」ボタン押下時
document.getElementById('singlePlayBtn').addEventListener('click', () => {
    isSinglePlayer = true;
    modeSelectStep.style.display = 'none';
    inputStep.style.display = 'block';
    roomInputGroup.style.display = 'none'; // 合言葉欄を非表示
    joinButton.innerText = "1人で遊ぶ (スタート)";
});

// 「2人で遊ぶ」ボタン押下時
document.getElementById('multiPlayBtn').addEventListener('click', () => {
    isSinglePlayer = false;
    modeSelectStep.style.display = 'none';
    inputStep.style.display = 'block';
    roomInputGroup.style.display = 'block'; // 合言葉欄を表示
    joinButton.innerText = "対戦部屋に入る";
});

// 「戻る」ボタン押下時
document.getElementById('backToModeBtn').addEventListener('click', () => {
    inputStep.style.display = 'none';
    modeSelectStep.style.display = 'block';
});

// UI要素の追加取得
const waitingStep = document.getElementById('waitingStep');
const waitingStatusText = document.getElementById('waitingStatusText');
const cancelWaitBtn = document.getElementById('cancelWaitBtn');

// --- 部屋参加・ゲーム開始処理 ---
joinButton.addEventListener('click', () => {
    if (isSinglePlayer) {
        // 1人プレイモード
        myPlayerId = 1;
        initGame();
        
        const pName = getMyName();
        players[0].name = `${pName} (P1)`;
        players[1].name = `${pName} (P2)`;

        isGameReady = true;
        isAnimating = false;

        document.getElementById('lobbyModal').style.display = 'none';
        
        updateScale();
        updateTurnDisplay();
        updateTurnButtonState();
        drawStage();
    } else {
        // 2人オンライン対戦モード
        const roomCode = document.getElementById('roomInput').value.trim();
        if (!roomCode) {
            alert("合言葉を入力してください");
            return;
        }
        currentRoomCode = roomCode;

        // 入力画面を隠して待機画面を表示（モーダル全体は消さない）
        inputStep.style.display = 'none';
        waitingStep.style.display = 'block';
        waitingStatusText.innerText = `部屋「${roomCode}」で対戦相手を待っています...`;

        logToScreen(`🚀 部屋「${roomCode}」への入場リクエストを送信します...`);
        socket.emit('joinRoom', roomCode, (response) => {
            if (response && response.status === 'ok') {
                logToScreen(`✅ サーバーが要請を受信しました。`, "#00ff00");
            }
        });
    }
});

// キャンセルボタン押下時
cancelWaitBtn.addEventListener('click', () => {
    if (currentRoomCode) {
        socket.emit('leaveRoom', { roomCode: currentRoomCode });
        currentRoomCode = "";
    }
    
    myPlayerId = null; 
    
    // 待機画面を閉じ、入力画面に戻す
    waitingStep.style.display = 'none';
    inputStep.style.display = 'block';
});

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

// 部屋参加時の通知を受信
socket.on('roomJoined', (data) => {
    myPlayerId = data.playerId;
    logToScreen(`🚪 部屋に入りました。(Player ID: ${myPlayerId})`);

    // 1人目（ホスト）の場合は、モーダルを開いたまま「待機中」を維持
    if (myPlayerId === 1 && !data.isReady) {
        waitingStep.style.display = 'block';
        inputStep.style.display = 'none';
    }
});

socket.on('startSyncProcess', () => {
    if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
    }

    waitingStep.style.display = 'none';
    const lobbyModal = document.getElementById('lobbyModal');
    if (lobbyModal) lobbyModal.style.display = 'none';

    if (myPlayerId === 1) {
        logToScreen(`👥 相手が揃いました。ステージを生成して地形データを送信します。`);
        
        initGame(); 
        const firstIndex = Math.floor(Math.random() * 2);
        currentPlayerIndex = firstIndex;

        if (players[0]) players[0].name = getMyName();
        
        logToScreen(`🎲 [送信前] ホストが決定した先攻: Player ${firstIndex + 1}`);

        socket.emit('syncTerrain', {
            roomCode: currentRoomCode,
            terrain: terrainCircles,
            players: players,
            startingPlayerIndex: firstIndex 
        });
    }
});





socket.on('roomError', (msg) => {
    logToScreen(`⚠️ 部屋エラー: ${msg}`, "#ff3333");
    turnDisplay.innerText = `⚠️ ${msg}`;
    alert(msg); 
});

socket.on('receiveTerrain', (data) => {
    logToScreen(`🌍 地形が完全同期されました！ゲーム開始！`);
    
    console.log("receiveTerrain data:", data);
    logToScreen(`📥 届いた startingPlayerIndex: ${data ? data.startingPlayerIndex : 'undefined'}`);

    terrainCircles = data.terrain;
    players = data.players;

    if (data && typeof data.startingPlayerIndex === 'number') {
        currentPlayerIndex = data.startingPlayerIndex;
    } else {
        logToScreen(`⚠️ startingPlayerIndex の取得に失敗したためデフォルト(P1)に設定しました`, "#ff3333");
        currentPlayerIndex = 0;
    }

    logToScreen(`🎲 先攻決定: Player ${currentPlayerIndex + 1} のターンです`);

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
    isGameReady = true; 
    isAnimating = false; 
    
    if (formulaInput) formulaInput.value = "";
    
    document.getElementById('lobbyModal').style.display = 'none';
    document.getElementById('resultModal').style.display = 'none'; 
    
    updateScale(); 
    // 💡 確実に先攻インデックスがセットされた後に表示・状態を更新
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
        
        // 💡 再戦時も確実に 0 か 1 をランダム決定する
        currentPlayerIndex = Math.floor(Math.random() * 2);

        socket.emit('syncTerrain', {
            roomCode: currentRoomCode,
            terrain: terrainCircles,
            players: players,
            startingPlayerIndex: currentPlayerIndex
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

// 修正後：再戦ボタン押下時の処理
document.getElementById('rematchButton').addEventListener('click', () => {
    if (isSinglePlayer) {
        // 1人プレイ時はそのままステージを再生成して開始
        initGame();
        const pName = getMyName();
        players[0].name = `${pName} (P1)`;
        players[1].name = `${pName} (P2)`;
        isGameReady = true;
        document.getElementById('resultModal').style.display = 'none';
        updateTurnDisplay();
        updateTurnButtonState();
    } else {
        // オンライン時
        logToScreen(`🔄 再戦リクエストを送信しました...`);
        socket.emit('requestRematch', { roomCode: currentRoomCode, myPlayerId: myPlayerId });
        
        // ホストもゲストも、相手の同意とサーバーからの指示を待つように統一
        turnDisplay.innerText = "対戦相手の再戦同意を待っています...";
        disableControlsTemporarily();
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
    
    // 💡 修正: オンライン時は自分のターンのみ発射可能。1人プレイ時は常時発射許可
    if (!isSinglePlayer && myPlayerId !== (currentPlayerIndex + 1)) return;

    const currentFormula = formulaInput.value.trim();
    
    if (currentFormula === "") {
        errorDisplay.innerText = "数式を入力してください。";
        return;
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
    
    // 💡 修正: オンラインの時だけ Socket.io で送信する
    if (!isSinglePlayer) {
        socket.emit('sendFormula', { 
            roomCode: currentRoomCode, 
            formula: currentFormula,
            senderName: myName 
        });
    }
    
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
    
    const activePlayerName = p.name && !p.name.startsWith("PLAYER") ? p.name : (p.id === 1 ? (players[0].name || "Player 1") : (players[1].name || "Player 2"));
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

    // 💡 弾が進んでいる間にプレイヤーに当たったかどうかを記憶するフラグ
    let p1Hit = false;
    let p2Hit = false;

    // 💡 【移動】判定関数をスコープのエラーが出ないよう安全な位置に定義
    function checkShotResultAndEnd(finalX, finalY) {
        // 両方当たった、または自分が当たった（自爆）
        if ((currentPlayerIndex === 0 && p1Hit) || (currentPlayerIndex === 1 && p2Hit)) {
            const loserName = p.name && !p.name.startsWith("PLAYER") ? p.name : activePlayerName;
            playImpactCinematic(finalX, finalY, () => { 
                turnDisplay.innerText = `${loserName} SUICIDE!`; 
                showResultMenu("GAME OVER", `${loserName} が自爆しました。`);
            });
        } 
        // 相手だけに当たった（クリーンヒット）
        else if ((currentPlayerIndex === 0 && p2Hit) || (currentPlayerIndex === 1 && p1Hit)) {
            const winnerName = p.name && !p.name.startsWith("PLAYER") ? p.name : activePlayerName;
            playImpactCinematic(finalX, finalY, () => { 
                turnDisplay.innerText = `${winnerName} WINS!!`; 
                showResultMenu("GAME OVER", `${winnerName} の勝利です！`);
            });
        } 
        // 誰にも当たらなかった（ミス）
        else {
            playImpactCinematic(finalX, finalY, () => { 
                currentPlayerIndex = (currentPlayerIndex + 1) % 2; 
                updateTurnDisplay(); 
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
        
        // 数値エラー時のセーフティ
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

        // 💡【重複削除】ここに元々あった古い画面外判定のブロックを除去しました

        // 1. 相手プレイヤーとの当たり判定
        const targetPlayerIndex = (currentPlayerIndex + 1) % 2; 
        const target = players[targetPlayerIndex];
        if (target.isAlive && Math.sqrt((currentBulletX - target.x)**2 + (currentBulletY - target.y)**2) < target.r + 2) {
            // 💡 当たった瞬間にそのプレイヤーを死亡状態(非表示)にし、爆発エフェクトを出す
            target.isAlive = false; 
            explode(currentBulletX, currentBulletY, 20);
            
            if (targetPlayerIndex === 1) p2Hit = true;
            if (targetPlayerIndex === 0) p1Hit = true;
        }
        
        // 2. 自分自身（自爆）との当たり判定
        if (t > 0.8 && p.isAlive && Math.sqrt((currentBulletX - p.x)**2 + (currentBulletY - p.y)**2) < p.r + 2) {
            // 💡 当たった瞬間に自分を死亡状態(非表示)にし、爆発エフェクトを出す
            p.isAlive = false;
            explode(currentBulletX, currentBulletY, 20);
            
            if (currentPlayerIndex === 0) p1Hit = true;
            if (currentPlayerIndex === 1) p2Hit = true;
        }

        // 3. 画面外に消えたときの最終着弾処理
        if (currentBulletX > VIRTUAL_WIDTH + 200 || currentBulletX < -200 || currentBulletY > VIRTUAL_HEIGHT * 2 || currentBulletY < -VIRTUAL_HEIGHT * 2) {
            checkShotResultAndEnd(currentBulletX, currentBulletY);
            return;
        }
        
        // 4. 地形にぶつかったときの最終着弾処理
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
    
    const p1Name = players[0]?.name || "PLAYER 1";
    const p2Name = players[1]?.name || "PLAYER 2";

    if (isSinglePlayer) {
        // 1人プレイ時：現在どちらのプレイヤーの順番かを表示
        const activeName = (currentPlayerIndex === 0) ? p1Name : p2Name;
        turnDisplay.innerText = `【${activeName}】のターンです`;
    } else {
        // オンライン時 (既存ロジック)
const myP = players[myPlayerId - 1];
const isLeft = myP ? (myP.x < VIRTUAL_WIDTH / 2) : (myPlayerId === 1);
const sideText = isLeft ? "左" : "右";

let identityText = `【あなた: ${myPlayerId === 1 ? p1Name : p2Name} (${sideText})】`;

        if (currentPlayerIndex + 1 === myPlayerId) { 
            turnDisplay.innerText = `${identityText} あなたのターンです！`; 
        } else { 
            turnDisplay.innerText = `${identityText} 相手のターンを待っています...`; 
        }
    }

    drawStage();
}

function updateTurnButtonState() {
    if (!isGameReady || disconnectTimer) { disableControlsTemporarily(); return; }
    const angleInput = document.getElementById('angleInput');
    const formulaInput = document.getElementById('formulaInput');

    // 💡 1人プレイの時、またはオンラインで自分のターンの時にボタンを有効化
    const isMyTurn = isSinglePlayer || (myPlayerId === (currentPlayerIndex + 1));

    if (!isAnimating && players[0].isAlive && players[1].isAlive && isMyTurn) {
        fireBtn.disabled = false; 
        fireBtn.style.opacity = "1.0"; 
        fireBtn.style.cursor = "pointer";
    } else {
        fireBtn.disabled = true;
        fireBtn.style.opacity = "0.5";
        fireBtn.style.cursor = "not-allowed";
    }

    // 角度入力に現在のターンの角度を反映させる（1人プレイ時のターン交代用）
    if (angleInput && players[currentPlayerIndex]) {
        angleInput.value = players[currentPlayerIndex].angle || 0;
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

    // 💡 直書きされていた canvas.width 設定を resizeCanvas に任せる
    resizeCanvas();

    generateTerrain(); 
    placePlayers(); 
    
    if(players[0]) players[0].name = (myPlayerId === 1) ? getMyName() : "PLAYER 1";
    if(players[1]) players[1].name = (myPlayerId === 2) ? getMyName() : "PLAYER 2";

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

    // スマホの高解像度倍率を取得（Retina対応）
    const dpr = window.devicePixelRatio || 1;

    // Canvas内部の描画ドット数を倍率分拡大してクッキリさせる
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // 画面上の見た目の表示サイズを指定
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    updateScale(); 
    drawStage();
}

// 1. 改善された地形生成ロジック
function generateTerrain() {
    terrainCircles = []; 
    destroyedCircles = [];
    
    // 円の数を 10 〜 15 個のランダムにする
    const targetCircles = Math.floor(10 + Math.random() * 6); // 10 〜 15
    
    let attempts = 0;
    let leftCount = 0;  // 左側に生成された数
    let rightCount = 0; // 右側に生成された数

    while (terrainCircles.length < targetCircles && attempts < 3000) {
        attempts++;
        
        // 左右の極端な偏りを防ぐためのロジック（どちらかが4個未満なら、そちらを優先的に生成）
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
            // 💡 円の大きさを少し大きく（半径 50 〜 110）
            r: 50 + Math.random() * 60 
        };
        
        // 中央の禁止エリア（幅 約96px）
        if (newCircle.x > VIRTUAL_WIDTH * 0.46 && newCircle.x < VIRTUAL_WIDTH * 0.54) {
            continue;
        }

        let tooClose = false;
        for (let c of terrainCircles) {
            const dist = Math.sqrt((newCircle.x - c.x)**2 + (newCircle.y - c.y)**2);
            
            // 💡 円が大きくなったので、中心同士の最低距離も 100px に調整
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

// 💡 2. プレイヤーの配置ロジック（埋まり防止・直線並び防止）
function placePlayers() {
    // プレイヤーの初期化
    if(!players || players.length < 2) {
        players = [
            { id: 1, x: 0, y: 0, r: 8, isAlive: true, angle: 0, name: "PLAYER 1" },
            { id: 2, x: 0, y: 0, r: 8, isAlive: true, angle: 0, name: "PLAYER 2" }
        ];
    } else {
        players[0].isAlive = true;
        players[1].isAlive = true;
    }

    let placementAttempts = 0;
    let validPlacement = false;

    while (!validPlacement && placementAttempts < 1000) {
        placementAttempts++;

const p1IsLeft = Math.random() < 0.5;

// ① プレイヤー1 の位置 (フラグによって左右を切替)
const p1XMin = p1IsLeft ? 0.05 : 0.85;
players[0].x = VIRTUAL_WIDTH * p1XMin + Math.random() * (VIRTUAL_WIDTH * 0.10);
players[0].y = VIRTUAL_HEIGHT * 0.2 + Math.random() * (VIRTUAL_HEIGHT * 0.6);

// ② プレイヤー2 の位置 (P1の反対側)
const p2XMin = p1IsLeft ? 0.85 : 0.05;
players[1].x = VIRTUAL_WIDTH * p2XMin + Math.random() * (VIRTUAL_WIDTH * 0.10);
players[1].y = VIRTUAL_HEIGHT * 0.2 + Math.random() * (VIRTUAL_HEIGHT * 0.6);


        // --- 判定1: プレイヤー同士が直線上に並んでいないか？ ---
        // Y座標（高さ）の差が 120px 以上あることを保証する
        const heightDifference = Math.abs(players[0].y - players[1].y);
        if (heightDifference < 120) {
            continue; // 高低差が足りなければ最初から決め直し
        }

        // --- 判定2: プレイヤーが地形（円）に埋まっていないか？ ---
        let p1IsBuried = false;
        let p2IsBuried = false;

        for (let c of terrainCircles) {
            const distToP1 = Math.sqrt((players[0].x - c.x)**2 + (players[0].y - c.y)**2);
            const distToP2 = Math.sqrt((players[1].x - c.x)**2 + (players[1].y - c.y)**2);

            // プレイヤーの半径(15px) + 円の半径(c.r) + 余裕(15px)
            // つまり、円の表面から 15px 以上離れていることを確認
            if (distToP1 < (c.r + 30)) {
                p1IsBuried = true;
            }
            if (distToP2 < (c.r + 30)) {
                p2IsBuried = true;
            }
        }

        // どちらも埋まっておらず、高低差もバッチリなら確定！
        if (!p1IsBuried && !p2IsBuried) {
            validPlacement = true;
        }
    }
}


function isInTerrain(px, py) {
    const inAnyTerrain = terrainCircles.some(c => ((px - c.x)**2 + (py - c.y)**2) < c.r**2);
    const inAnyDestroyed = destroyedCircles.some(c => ((px - c.x)**2 + (py - c.y)**2) < c.r**2);
    return inAnyTerrain && !inAnyDestroyed;
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

    // drawStage 内の players.forEach 部分
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

        // 💡 プレイヤー名の文字サイズ拡大＆白縁取り
        ctx.save();
        ctx.font = 'bold 16px sans-serif'; // 12px から 16px に変更
        ctx.textAlign = 'center';
        
        // 白い縁取り（見やすさ向上）
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.strokeText(p.name || `PLAYER ${p.id}`, p.x, p.y - 18);
        
        // 黒文字本体
        ctx.fillStyle = '#000000';
        ctx.fillText(p.name || `PLAYER ${p.id}`, p.x, p.y - 18);
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
        const targetIdx = isSinglePlayer ? currentPlayerIndex : (myPlayerId - 1);
        const myCharacter = players[targetIdx];
        if (myCharacter) { 
            const val = parseFloat(e.target.value) || 0;
            myCharacter.angle = val;
            drawStage();
            if (!isSinglePlayer && currentRoomCode) {
                socket.emit('syncAngle', {
                    roomCode: currentRoomCode,
                    playerIndex: targetIdx,
                    angle: val,
                    senderName: getMyName()
                });
            }
        }
    }
});

window.addEventListener('resize', resizeCanvas);
// ページ読み込み時の処理
window.addEventListener('load', () => {
    detectDevice();
    resizeCanvas();
});
