// 🌟 サーバーのURL（ローカル開発用）
const API_BASE_URL = "https://pokemon-election-ai.onrender.com/api";

let POKE_MASTER = [];
let myParty = [];
let oppParty = [];
let diagParty = []; // 診断タブ用の一時パーティ

async function initApp() {
    try {
        const res = await fetch(`${API_BASE_URL}/pokemon_master`);
        const data = await res.json();
        POKE_MASTER = data.pokemon_list;
        
        setupSearch('my-search', 'my-dropdown', 'my');
        setupSearch('opp-search', 'opp-dropdown', 'opp');
        updateGrid('my');
        updateGrid('opp');
        setupSearch('diag-search', 'diag-dropdown', 'diag');
    } catch (e) {
        console.error("データ取得エラー:", e);
        alert("バックエンドサーバー（FastAPI）に接続できません。");
    }
}

function setupSearch(inputId, dropdownId, partyType) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    function showList() {
        const val = input.value;
        dropdown.innerHTML = '';
        let party;
        if (partyType === 'my') party = myParty;
        else if (partyType === 'opp') party = oppParty;
        else if (partyType === 'diag') party = diagParty; // 診断タブも追加

        let filtered = POKE_MASTER.filter(p => !party.some(selected => selected.id === p.id));

        if (val) {
            filtered = filtered.filter(p => p.name.includes(val) || p.hiragana.includes(val));
        }

        filtered.forEach(p => {
            const div = document.createElement('div');
            div.className = 'dropdown-item';
            div.textContent = p.name;
            
            div.onmousedown = (e) => {
                e.preventDefault(); 
                addPokemon(p, partyType, input, dropdown);
            };
            dropdown.appendChild(div);
        });
        dropdown.style.display = 'block';
    }

    input.addEventListener('input', showList);
    input.addEventListener('focus', showList);
    input.addEventListener('blur', () => { dropdown.style.display = 'none'; });
}

async function checkAndPredict() {
    const aiContainer = document.getElementById('ai-prediction');
    const tbody = document.getElementById('prediction-body');
    const typeBox = document.getElementById('type-consistency-container');

    if (!aiContainer || !tbody || !typeBox) return;

    if (myParty.length === 6 && oppParty.length === 6) {
        aiContainer.style.display = 'block';
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">🧠 AI予想を計算中...</td></tr>';
        typeBox.style.display = 'none';

        try {
            // 🌟 送信するデータを「文字列の配列」に整形
            const reqBody = {
                my_party: myParty.map(p => p.name),
                opp_party: oppParty.map(p => p.name)
            };
            
            console.log("🚀 FastAPIに送信するデータ:", reqBody); // デバッグ用

            const res = await fetch(`${API_BASE_URL}/predict`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody)
            });

            // 🌟 もし422エラーなどが出たら、詳しい理由を取得して表示する
            if (!res.ok) {
                const errorDetail = await res.json();
                console.error("❌ サーバーエラー詳細:", errorDetail);
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#FF4B4B;">通信エラー(${res.status})が発生しました。F12キーを押してConsoleを確認してください。</td></tr>`;
                return;
            }

            const data = await res.json();
            
            // タイプ一貫性の表示
            if (data.consistent_types && data.consistent_types.length > 0) {
                let tags = data.consistent_types.map(t => `<span class="type-tag type-${t}">${t}</span>`).join('');
                typeBox.innerHTML = `<b style="font-size: 15px;">💡 相手に一貫しているタイプ:</b><div style="margin-top: 8px;">${tags}</div>`;
                typeBox.style.display = 'block';
            }

            // メッセージ（仮予想など）の表示
            let msgHtml = '';
            if (data.message) {
                msgHtml = `<tr><td colspan="3" style="text-align:center; color:#666; font-size:12px;">${data.message}</td></tr>`;
            }

            // AI予想の表示
            if (data.predictions && data.predictions.length > 0) {
                tbody.innerHTML = msgHtml;
                data.predictions.forEach(p => {
                    tbody.innerHTML += `
                        <tr>
                            <td style="display:flex; align-items:center; gap:10px;">
                                <img src="${p.img}" width="35" height="35" style="object-fit:contain;">
                                <b>${p.name}</b>
                            </td>
                            <td>
                                <div style="font-size:11px; font-weight:bold;">${p.lead}%</div>
                                <div class="progress-container"><div class="progress-fill-lead" style="width: ${p.lead}%"></div></div>
                            </td>
                            <td>
                                <div style="font-size:11px; font-weight:bold;">${p.all}%</div>
                                <div class="progress-container"><div class="progress-fill-all" style="width: ${p.all}%"></div></div>
                            </td>
                        </tr>
                    `;
                });
            } else {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#666;">予想データがありません。</td></tr>`;
            }
            // 🌟 予想が終わったら記録フォームを生成して表示する
            populateRecordForm();
        } catch(e) {
            console.error("Fetchエラー:", e);
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#FF4B4B;">エラーが発生しました。サーバーを確認してください。</td></tr>';
        }
    } else {
        aiContainer.style.display = 'none';
        typeBox.style.display = 'none';
        document.getElementById('record-section').style.display = 'none'; // 🌟 追加：6匹未満なら隠す
    }
}

// モーダル処理等
const STORAGE_KEY = 'poke_ai_my_parties';
function openModal(modalId) { document.getElementById('modal-overlay').style.display = 'block'; document.getElementById(modalId).style.display = 'block'; }
function closeModals() { document.getElementById('modal-overlay').style.display = 'none'; document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); }
document.getElementById('modal-overlay').addEventListener('click', closeModals);
document.getElementById('help-btn').addEventListener('click', () => openModal('help-modal'));

// ==========================================
// 🌟 対戦結果の記録・送信処理（アイコンクリック方式）
// ==========================================
let myRecordSelection = [];
let oppRecordSelection = [];

function populateRecordForm() {
    document.getElementById('record-section').style.display = 'block';
    myRecordSelection = [];
    oppRecordSelection = [];
    renderRecordGrid('my');
    renderRecordGrid('opp');
}

function renderRecordGrid(type) {
    const party = type === 'my' ? myParty : oppParty;
    const selection = type === 'my' ? myRecordSelection : oppRecordSelection;
    const container = document.getElementById(`${type}-record-icons`);
    const statusText = document.getElementById(`${type}-selection-status`);

    container.innerHTML = '';

    party.forEach(p => {
        const div = document.createElement('div');
        div.className = 'record-icon';
        div.innerHTML = `<img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${p.id}.png">`;

        // 選ばれているポケモンには順番のバッジをつける
        const orderIndex = selection.findIndex(s => s.id === p.id);
        if (orderIndex !== -1) {
            div.setAttribute('data-order', orderIndex + 1);
            const badge = document.createElement('div');
            badge.className = 'order-badge';
            badge.innerText = orderIndex === 0 ? '先発' : `後発`;
            div.appendChild(badge);
        }

        // クリックした時の処理
        div.onclick = () => {
            const idx = selection.findIndex(s => s.id === p.id);
            if (idx !== -1) {
                // すでに選ばれていれば解除
                selection.splice(idx, 1);
            } else {
                // 選ばれていなければ追加（最大3匹）
                if (selection.length < 3) {
                    selection.push(p);
                } else {
                    return; // 3匹選ばれていたら何もしない
                }
            }
            renderRecordGrid(type); // 画面を再描画
        };
        container.appendChild(div);
    });

    // 下のテキスト表示を更新
    const leadText = selection.length > 0 ? selection[0].name : "未選択";
    const backsText = selection.length > 1 ? selection.slice(1).map(p => p.name).join(', ') : "-";
    statusText.innerHTML = `<span style="color:#FF4B4B; font-weight:bold;">先発:</span> ${leadText} <br><span style="color:#1C83E1; font-weight:bold;">後発:</span> ${backsText}`;
}

// 送信ボタンの処理
document.getElementById('submit-record-btn').addEventListener('click', async () => {
    // 修正：メッセージを「選出を1匹以上」に。先発は必ず含まれる仕様なのでこれでOK
    if (myRecordSelection.length === 0 || oppRecordSelection.length === 0) {
        return alert("⚠️ お互いの選出を1匹以上選択してください。");
    }

    // 1匹目が先発、それ以降が後発
    const myLead = myRecordSelection[0].name;
    const myBack = myRecordSelection.slice(1).map(p => p.name);
    const oppLead = oppRecordSelection[0].name;
    const oppBack = oppRecordSelection.slice(1).map(p => p.name);

    const btn = document.getElementById('submit-record-btn');
    btn.innerText = "⏳ 送信中...";
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE_URL}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                my_party: myParty.map(p => p.name), 
                opp_party: oppParty.map(p => p.name),
                my_lead: myLead, 
                my_back: myBack, 
                opp_lead: oppLead, 
                opp_back: oppBack
            })
        });

        if (!res.ok) {
            console.error(await res.json());
            throw new Error("サーバーエラー");
        }

        const result = await res.json();
        alert(result.message);

        // 送信後は相手パーティだけ空にしてリセット
        oppParty = [];
        updateGrid('opp');
        checkAndPredict(); 

    } catch (e) {
        console.error(e);
        alert("保存に失敗しました。");
    } finally {
        btn.innerText = "📈 結果を送信してAIを学習させる";
        btn.disabled = false;
    }
});

// 🌟 タブ切り替え処理
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(`tab-${tabName}`).classList.add('active');
    event.currentTarget.classList.add('active');

    if (tabName === 'diagnosis') {
        renderDiagnosisTeams();
    }
}

// --- 🌟 自動実行機能（ポケモン追加/削除時に呼ばれる） ---
function addPokemon(poke, type, input, dropdown) {
    const party = type === 'my' ? myParty : (type === 'opp' ? oppParty : diagParty);
    if (party.some(p => p.id === poke.id)) {
        alert("同じポケモンは既に選択されています。"); return input.value = '', dropdown.style.display = 'none', undefined;
    }
    if (party.length < 6) {
        party.push(poke); updateGrid(type);
        if (type === 'diag') checkAndDiagnose(); // 診断即実行
        else checkAndPredict();
    }
    input.value = ''; dropdown.style.display = 'none'; input.blur();
}

function updateGrid(type) {
    const gridId = type === 'my' ? 'my-party-grid' : (type === 'opp' ? 'opp-party-grid' : 'diag-party-grid');
    const party = type === 'my' ? myParty : (type === 'opp' ? oppParty : diagParty);
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        const slot = document.createElement('div'); slot.className = 'slot';
        if (party[i]) {
            const img = document.createElement('img'); img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${party[i].id}.png`;
            const btn = document.createElement('button'); btn.className = 'remove-btn'; btn.innerHTML = '✕';
            btn.onclick = () => {
                party.splice(i, 1); updateGrid(type);
                if (type === 'diag') checkAndDiagnose(); // 削除時も即実行
                else checkAndPredict();
            };
            slot.appendChild(img); slot.appendChild(btn);
        }
        grid.appendChild(slot);
    }
}

// --- 🌟 リアルタイム診断ロジック ---
async function checkAndDiagnose() {
    const resultArea = document.getElementById('diagnosis-result-area');
    const rankingDiv = document.getElementById('diagnosis-ranking');
    const typeDiv = document.getElementById('diagnosis-types');
    
    if (diagParty.length < 3) {
        resultArea.style.display = 'none'; // 3匹未満なら隠す
        return;
    }
    
    resultArea.style.display = 'block';
    rankingDiv.innerHTML = '<p style="text-align:center; padding:10px;">🔍 解析中...</p>'; typeDiv.innerHTML = '';

    try {
        const res = await fetch(`${API_BASE_URL}/diagnose`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(diagParty.map(p => p.name))
        });
        const data = await res.json();

        if (data.results && data.results.length > 0) {
            rankingDiv.innerHTML = '';
            data.results.forEach((p, i) => {
                rankingDiv.innerHTML += `<div class="ranking-item" style="flex-direction:column; align-items:flex-start; gap:5px;"><div style="display:flex; align-items:center; gap:15px; width:100%;"><div class="ranking-num">${i + 1}</div><img src="${p.img}" width="40"><div style="flex:1;"><b>${p.name}</b></div><div style="font-weight:bold; color:#FF4B4B;">${p.score}%</div></div><div class="progress-container" style="height:6px; margin-left:40px; width:calc(100% - 40px);"><div class="progress-fill-all" style="width: ${p.score}%"></div></div></div>`;
            });
            data.type_results.forEach(t => {
                typeDiv.innerHTML += `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;"><span class="type-tag type-${t.type}">${t.type}</span><span style="font-size:13px; font-weight:bold;">期待度 ${t.score}%</span></div>`;
            });
        } else {
            rankingDiv.innerHTML = '<p style="text-align:center; color:#999;">似たデータが見つかりません。別の並びを試してください。</p>';
        }
    } catch (e) { rankingDiv.innerHTML = '<p style="color:red;">エラーが発生しました。</p>'; }
}

// --- 🌟 パーティ保存・命名機能 ---
function saveTeam(type) {
    const party = type === 'my' ? myParty : diagParty;
    
    // 1. 6匹揃っているかチェック
    if (party.length < 6) {
        return alert("⚠️ 6匹選択してから保存してください。");
    }
    
    const savedTeams = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const currentIds = party.map(p => p.id).sort((a, b) => a - b).join(',');

    // 2. 同じパーティが既に存在するか先にチェック
    const isDuplicate = savedTeams.some(team => {
        const teamData = Array.isArray(team) ? team : team.party;
        return teamData.map(p => p.id).sort((a, b) => a - b).join(',') === currentIds;
    });

    if (isDuplicate) {
        return alert("⚠️ このパーティはすでに保存されています。");
    }

    // 3. 重複がなければ名前を入力してもらう
    const defaultName = `チーム ${savedTeams.length + 1}`;
    // 💡 ユーザーに上限を伝える
    const partyName = prompt("パーティ名を入力してください（最大15文字 / 未入力で自動命名）:", defaultName);
    
    if (partyName === null) return; // キャンセル時は何もしない

    // 🌟 追加：15文字を超えていたら弾く
    if (partyName.trim().length > 15) {
        return alert("⚠️ パーティ名は15文字以内で入力してください。");
    }

    const finalName = partyName.trim() || defaultName;

    // 保存実行
    savedTeams.push({ name: finalName, party: [...party] });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedTeams));
    alert(`「${finalName}」を保存しました。`);
}

// --- 🌟 モーダルでのパーティ管理（全タブ共通） ---
function openTeamModal(contextType) {
    currentModalContext = contextType;
    const container = document.getElementById('saved-teams-container');
    const savedTeams = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    container.innerHTML = '';
    
    if (savedTeams.length === 0) {
        container.innerHTML = '<p style="color: #666; font-size: 14px;">保存されたパーティがありません。</p>';
    } else {
        savedTeams.forEach((teamObj, index) => {
            const teamData = Array.isArray(teamObj) ? teamObj : teamObj.party;
            const teamName = teamObj.name || `チーム ${index + 1}`;
            
            const row = document.createElement('div'); row.className = 'saved-team-row';
            let imgsHtml = teamData.map(p => `<img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${p.id}.png">`).join('');
            
            // 🌟 修正：パーティ名のdivにクラス「saved-team-name」を付与
            row.innerHTML = `
                <div class="saved-team-name" title="${teamName}">${teamName}</div>
                <div class="saved-team-grid">${imgsHtml}</div>
                <div class="button-group">
                    <button class="sub-btn load-btn" data-index="${index}">📥 読込</button>
                    <button class="sub-btn del-btn" data-index="${index}">🗑️ 削除</button>
                </div>
            `;
            container.appendChild(row);
        });

        document.querySelectorAll('.load-btn').forEach(btn => btn.addEventListener('click', (e) => {
            const index = e.target.getAttribute('data-index');
            const teamObj = savedTeams[index];
            const teamData = Array.isArray(teamObj) ? teamObj : teamObj.party;
            
            if (currentModalContext === 'my') {
                myParty = [...teamData]; updateGrid('my'); checkAndPredict();
            } else {
                diagParty = [...teamData]; updateGrid('diag'); checkAndDiagnose();
            }
            closeModals();
        }));

        document.querySelectorAll('.del-btn').forEach(btn => btn.addEventListener('click', (e) => {
            const index = e.target.getAttribute('data-index');
            savedTeams.splice(index, 1);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(savedTeams));
            openTeamModal(currentModalContext); // 削除後再描画
        }));
    }
    openModal('team-modal');
}

initApp();
