from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import pandas as pd
import numpy as np
import os
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import MultiLabelBinarizer
from supabase import create_client, Client

app = FastAPI()

# CORS設定（フロントエンドからの通信を許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 定数・ロジック ---

SUPABASE_URL = "https://clhiuupvcnsxkqfyipcs.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsaGl1dXB2Y25zeGtxZnlpcGNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3OTExNjIsImV4cCI6MjA5NDM2NzE2Mn0.Af_wj6SentOcu0GpwYUXI4QFXp_EAKIdP7IWPT_Fres"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TYPE_CHART = {
    "ノーマル": {"いわ": 0.5, "ゴースト": 0, "はがね": 0.5},
    "ほのお": {"くさ": 2, "こおり": 2, "むし": 2, "はがね": 2, "ほのお": 0.5, "みず": 0.5, "いわ": 0.5, "ドラゴン": 0.5},
    "みず": {"ほのお": 2, "じめん": 2, "いわ": 2, "みず": 0.5, "くさ": 0.5, "ドラゴン": 0.5},
    "でんき": {"みず": 2, "ひこう": 2, "でんき": 0.5, "くさ": 0.5, "ドラゴン": 0.5, "じめん": 0},
    "くさ": {"みず": 2, "じめん": 2, "いわ": 2, "ほのお": 0.5, "くさ": 0.5, "どく": 0.5, "ひこう": 0.5, "むし": 0.5, "ドラゴン": 0.5, "はがね": 0.5},
    "こおり": {"くさ": 2, "じめん": 2, "ひこう": 2, "ドラゴン": 2, "ほのお": 0.5, "みず": 0.5, "こおり": 0.5, "はがね": 0.5},
    "かくとう": {"ノーマル": 2, "こおり": 2, "いわ": 2, "あく": 2, "はがね": 2, "どく": 0.5, "ひこう": 0.5, "エスパー": 0.5, "むし": 0.5, "フェアリー": 0.5, "ゴースト": 0},
    "どく": {"くさ": 2, "フェアリー": 2, "どく": 0.5, "じめん": 0.5, "いわ": 0.5, "ゴースト": 0.5, "はがね": 0},
    "じめん": {"ほのお": 2, "でんき": 2, "どく": 2, "いわ": 2, "はがね": 2, "くさ": 0.5, "むし": 0.5, "ひこう": 0},
    "ひこう": {"くさ": 2, "かくとう": 2, "むし": 2, "でんき": 0.5, "いわ": 0.5, "はがね": 0.5},
    "エスパー": {"かくとう": 2, "どく": 2, "エスパー": 0.5, "はがね": 0.5, "あく": 0},
    "むし": {"くさ": 2, "エスパー": 2, "あく": 2, "ほのお": 0.5, "かくとう": 0.5, "どく": 0.5, "ひこう": 0.5, "ゴースト": 0.5, "はがね": 0.5, "フェアリー": 0.5},
    "いわ": {"ほのお": 2, "こおり": 2, "ひこう": 2, "むし": 2, "かくとう": 0.5, "じめん": 0.5, "はがね": 0.5},
    "ゴースト": {"エスパー": 2, "ゴースト": 2, "あく": 0.5, "ノーマル": 0},
    "ドラゴン": {"ドラゴン": 2, "はがね": 0.5, "フェアリー": 0},
    "あく": {"エスパー": 2, "ゴースト": 2, "かくとう": 0.5, "あく": 0.5, "フェアリー": 0.5},
    "はがね": {"こおり": 2, "いわ": 2, "フェアリー": 2, "ほのお": 0.5, "みず": 0.5, "でんき": 0.5, "はがね": 0.5},
    "フェアリー": {"かくとう": 2, "ドラゴン": 2, "あく": 2, "ほのお": 0.5, "どく": 0.5, "はがね": 0.5}
}

ALL_TYPES = list(TYPE_CHART.keys())
MASTER_FILE = "pokemon_master.csv"
DATA_FILE = "battle_data.csv"

df_master = None
type_dict = {}
poke_options = []
composite_types = []
clf_all = None
clf_lead = None
mlb = None

# 🌟 フロントエンドから受け取るデータのルール（これがズレると422エラーになります）
class BattleRequest(BaseModel):
    my_party: List[str]
    opp_party: List[str]
    
# 🌟 追加：対戦記録を保存するためのデータルール
class BattleRecord(BaseModel):
    my_party: List[str]
    opp_party: List[str]
    my_lead: str
    my_back: List[str]
    opp_lead: str
    opp_back: List[str]

def normalize_probs(probs, target_total):
    """
    確率のリストを受け取り、合計が target_total になるように補正する関数
    """
    total = sum(probs)
    # すべて0の場合は均等に割り振る（6匹なら100÷6など）
    if total == 0:
        return [round(target_total / len(probs), 1)] * len(probs)
    
    # 目標の合計値に合わせるための倍率を計算
    scale = target_total / total
    adjusted = [p * scale for p in probs]
    
    # 全体選出（300%）などで、1匹の確率が100%を超えてしまった場合の頭打ち処理
    adjusted = [min(100.0, p) for p in adjusted]
    
    # 小数第1位で丸めて返す
    return [round(p, 1) for p in adjusted]

def load_data():
    global df_master, type_dict, poke_options, composite_types
    if not os.path.exists(MASTER_FILE):
        print(f"Error: {MASTER_FILE} が見つかりません。")
        return

    df_master = pd.read_csv(MASTER_FILE).sort_values("hiragana")
    type_dict = df_master.set_index("name").to_dict(orient="index")
    poke_options = [
        {"name": row["name"], "hiragana": row["hiragana"], "id": int(row["id"])}
        for _, row in df_master.iterrows()
    ]
    for _, row in df_master.iterrows():
        t1, t2 = str(row["type1"]), str(row["type2"])
        if t1 != "nan" and t2 != "nan" and t2 != "":
            c = tuple(sorted([t1, t2]))
            if c not in composite_types:
                composite_types.append(c)

def train_models():
    global clf_all, clf_lead, mlb
    if not os.path.exists(DATA_FILE) or df_master is None:
        return

    try:
        response = supabase.table("battle_records").select("*").execute()
        records = response.data
    except Exception as e:
        print("Supabaseからのデータ取得エラー:", e)
        return

    # データが20件未満なら学習スキップ
    if not records or len(records) < 20: 
        return

    # 取得したデータをPandasのDataFrameに変換
    df_battle = pd.DataFrame(records)

    mlb = MultiLabelBinarizer(classes=df_master["name"].tolist()).fit([df_master["name"].tolist()])
    Xt, ya, yl = [], [], []

    for _, row in df_battle.iterrows():
        pm = str(row['my_party']).split(',')
        po = str(row['opp_party']).split(',')
        al = str(row['actual_lead'])
        ab = str(row['actual_back']).split(',')
        aa = [al] + [x for x in ab if x and x != "nan"]
        
        for cand in po:
            if cand in type_dict:
                Xt.append(make_feature(pm, po, cand))
                ya.append(1 if cand in aa else 0)
                yl.append(1 if cand == al else 0)

    if Xt:
        clf_all = RandomForestClassifier(n_estimators=100, random_state=42).fit(Xt, ya)
        clf_lead = RandomForestClassifier(n_estimators=100, random_state=42).fit(Xt, yl)
        print("🤖 AIモデルの学習が完了しました！")

def make_feature(my_p, opp_p, target):
    mv = mlb.transform([my_p])[0]
    ov = mlb.transform([opp_p])[0]
    
    def tv(pl):
        vs = np.zeros(18)
        vc = np.zeros(len(composite_types))
        for p in pl:
            if p not in type_dict: continue
            t1, t2 = str(type_dict[p].get("type1", "")), str(type_dict[p].get("type2", ""))
            if t1 in ALL_TYPES: vs[ALL_TYPES.index(t1)] += 1
            if t2 in ALL_TYPES: vs[ALL_TYPES.index(t2)] += 1
            if t1 in ALL_TYPES and t2 in ALL_TYPES:
                c = tuple(sorted([t1, t2]))
                if c in composite_types: vc[composite_types.index(c)] += 1
        return np.hstack([vs, vc])
        
    tgv = np.zeros(18)
    if target in type_dict:
        t1, t2 = str(type_dict[target].get("type1", "")), str(type_dict[target].get("type2", ""))
        if t1 in ALL_TYPES: tgv[ALL_TYPES.index(t1)] = 1
        if t2 in ALL_TYPES: tgv[ALL_TYPES.index(t2)] = 1
        
    return np.hstack([mv, ov, tv(my_p), tv(opp_p), tgv])

def check_type_consistency(opp_party):
    consistent_types = []
    for attack_type in ALL_TYPES:
        resists_count = 0
        for p in opp_party:
            if p not in type_dict: continue
            t1 = str(type_dict[p]["type1"])
            t2 = str(type_dict[p].get("type2", ""))
            
            eff = TYPE_CHART.get(attack_type, {}).get(t1, 1.0)
            if t2 != "nan" and t2 != "":
                eff *= TYPE_CHART.get(attack_type, {}).get(t2, 1.0)
            
            if eff <= 0.5:
                resists_count += 1
                
        if resists_count <= 1:
            consistent_types.append(attack_type)
    return consistent_types

@app.on_event("startup")
async def startup_event():
    load_data()
    train_models()

# =========================================================
# APIエンドポイント
# =========================================================

@app.get("/api/pokemon_master")
async def get_pokemon_master():
    return {"pokemon_list": poke_options}

@app.post("/api/predict")
async def predict(req: BattleRequest):
    consistent = check_type_consistency(req.opp_party)
    
    candidates = []
    raw_leads = []
    raw_alls = []

    # ① AIの学習データが足りない場合（仮予想ロジック）
    if clf_all is None or mlb is None:
        for cand in req.opp_party:
            if cand not in type_dict: continue
            candidates.append(cand)
            
            opp_t1 = str(type_dict[cand].get("type1", ""))
            opp_t2 = str(type_dict[cand].get("type2", ""))
            
            score = 0
            for my_p in req.my_party:
                if my_p not in type_dict: continue
                my_t1 = str(type_dict[my_p].get("type1", ""))
                my_t2 = str(type_dict[my_p].get("type2", ""))
                
                eff1 = TYPE_CHART.get(opp_t1, {}).get(my_t1, 1.0)
                if my_t2 != "nan" and my_t2: 
                    eff1 *= TYPE_CHART.get(opp_t1, {}).get(my_t2, 1.0)
                
                eff2 = 0
                if opp_t2 != "nan" and opp_t2:
                    eff2 = TYPE_CHART.get(opp_t2, {}).get(my_t1, 1.0)
                    if my_t2 != "nan" and my_t2: 
                        eff2 *= TYPE_CHART.get(opp_t2, {}).get(my_t2, 1.0)
                
                score += max(eff1, eff2)
            
            base_prob = min((score / 12.0) * 100, 95.0)
            raw_leads.append(base_prob * 0.8) # 生の先発スコア
            raw_alls.append(base_prob)        # 生の全体スコア
            
        message = "※データ不足のため、タイプ相性から計算した「仮の選出予想」を表示しています。"

    # ② AIの学習データが十分にある場合（ガチ予想ロジック）
    else:
        for cand in req.opp_party:
            if cand not in type_dict: continue
            candidates.append(cand)
            feat = make_feature(req.my_party, req.opp_party, cand).reshape(1, -1)
            
            pa = clf_all.predict_proba(feat)[0][1] * 100 if 1 in clf_all.classes_ else 0.0
            pl = clf_lead.predict_proba(feat)[0][1] * 100 if 1 in clf_lead.classes_ else 0.0
            
            raw_leads.append(pl) # 生の先発スコア
            raw_alls.append(pa)  # 生の全体スコア
            
        message = ""

    # 🌟 ここがポイント！最後にまとめて正規化（補正）を実行！
    # 先発は合計が100%になるように、全体選出は合計が300%になるように調整する
    norm_leads = normalize_probs(raw_leads, 100.0)
    norm_alls = normalize_probs(raw_alls, 300.0)

    # 補正されたきれいなパーセントを使って結果を組み立てる
    results = []
    for i, cand in enumerate(candidates):
        results.append({
            "name": cand,
            "lead": norm_leads[i],
            "all": norm_alls[i],
            "img": f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{type_dict[cand]['id']}.png"
        })
    
    # 全体選出予想の％が高い順に並び替え
    results = sorted(results, key=lambda x: x["all"], reverse=True)
    
    return {
        "predictions": results,
        "consistent_types": consistent,
        "message": message
    }
    
# 🌟 追加：結果を保存し、AIを再学習させるAPI
@app.post("/api/save")
async def save_record(record: BattleRecord):
    # CSVに保存する形式に変換
    new_data = {
        "my_party": ",".join(record.my_party),
        "opp_party": ",".join(record.opp_party),
        "my_lead": record.my_lead,
        "my_back": ",".join(record.my_back),
        "actual_lead": record.opp_lead,
        "actual_back": ",".join(record.opp_back)
    }
    
    # Supabaseに保存する
    supabase.table("battle_records").insert(new_data).execute()
    
    # 保存したらAIを再学習
    train_models()
    
    return {"status": "success", "message": "対戦結果の記録が完了しました。"}

@app.post("/api/diagnose")
async def diagnose_party(party: List[str]):
    if not os.path.exists(DATA_FILE):
        return {"results": [], "type_results": [], "message": "対戦データがありません。"}

    df_battle = pd.read_csv(DATA_FILE)
    similar_opp_pokemon = []
    
    input_set = set(party)
    
    # 🌟 修正：3匹未満なら処理をスキップ
    if len(input_set) < 3:
        return {"results": [], "type_results": []}

    response = supabase.table("battle_records").select("*").execute()
    records = response.data

    if not records:
        return {"results": [], "type_results": [], "message": "対戦データがありません。"}

    df_battle = pd.DataFrame(records)
    similar_opp_pokemon = []
    
    match_found_count = 0
    threshold = 3 if len(input_set) <= 4 else 4
    
    for _, row in df_battle.iterrows():
        row_party = set(str(row["my_party"]).split(","))
        if len(input_set & row_party) >= threshold:
            match_found_count += 1
            opp_selection = [row["actual_lead"]] + str(row["actual_back"]).split(",")
            similar_opp_pokemon.extend([p for p in opp_selection if p and p != "nan"])

    if not similar_opp_pokemon:
        return {"results": [], "type_results": []}

    from collections import Counter
    counts = Counter(similar_opp_pokemon)
    results = []
    for name, count in counts.most_common(8):
        p_id = type_dict[name]["id"] if name in type_dict else 0
        score = round((count / match_found_count) * 100, 1)
        results.append({
            "name": name, "score": score,
            "img": f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{p_id}.png" if p_id else ""
        })

    similar_opp_types = []
    for p_name in similar_opp_pokemon:
        if p_name in type_dict:
            similar_opp_types.append(type_dict[p_name]["type1"])
            if type_dict[p_name].get("type2") and str(type_dict[p_name]["type2"]) != "nan":
                similar_opp_types.append(type_dict[p_name]["type2"])
    
    type_counts = Counter(similar_opp_types)
    type_results = []
    for t_name, t_count in type_counts.most_common(5):
        type_score = round((t_count / (match_found_count * 3)) * 100, 1)
        type_results.append({"type": t_name, "score": type_score})

    return {"results": results, "type_results": type_results}