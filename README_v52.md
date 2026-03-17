# Ams PRO v5.2 — 導入・更新ガイド

**NTA工程管理システム 最終版**  
バージョン: 5.2.0 / 更新日: 2026-03-11

---

## 配置するファイル一覧

| ファイル | 配置先 | 説明 |
|---|---|---|
| `app_complete.js` | `app.js` に上書き | フロントエンド完全版（3195行） |
| `server_complete.js` | `server.js` に上書き | APIサーバー完全版（657行） |
| `style.css` | `style.css` に上書き | スタイルシート（QRカメラUI含む） |
| `index.html` | `index.html` に上書き | エントリポイント（タイトルv5.2） |
| `package.json` | `package.json` に上書き | バージョン表記更新 |

---

## セットアップ手順

### 新規インストール

```bash
# 1. ファイルを配置
cp app_complete.js  app.js
cp server_complete.js server.js
# style.css / index.html / package.json も上書き

# 2. 依存パッケージをインストール
npm install

# 3. サーバー起動（DBは自動作成・マイグレーション）
node server.js

# 4. ブラウザでアクセス
# → http://localhost:3000
```

### 既存環境からのアップグレード（v4.x / v5.0 / v5.1）

```bash
# バックアップ
cp server.js server.js.bak
cp app.js    app.js.bak

# ファイル上書き
cp app_complete.js    app.js
cp server_complete.js server.js
cp style.css style.css  # （QRカメラUI追加分）

# 再起動（起動時に自動マイグレーション実行）
node server.js
```

起動ログに以下が出れば移行完了：
```
✅ Migration: jobs.customer_id
✅ Migration: jobs.vehicle_maker
✅ 車両メーカーマスター初期データ投入
```

---

## v5.2 主要機能

### 1. 予約フロー（新設）

- **＋受付ボタン** → 「🚗 受付登録（今日入庫）」「📅 予約登録（後日入庫）」をタブ切替
- 予約登録は **顧客名のみ必須**、車両・見積・工程テンプレートは省略可
- カンバンに **「📅 予約済」カラム**（紫色）が先頭固定表示
- 予約カードに **「🚗 受付する」ボタン**を配置

### 2. 入庫受付・QR補充

- 予約済案件の「受付する」→ **checkinモーダル**を起動
- **車検証QRコードをカメラで読取り**、車両情報（メーカー/車種/登録番号/所有者/年式/VIN）を自動入力
- 国土交通省電子車検証QR仕様（2023年施行）に対応
- カメラ不可時はエラーメッセージ＋テスト用サンプルにフォールバック
- 工程テンプレートを選択して **受付を確定 → status: 'open'** に遷移

### 3. 顧客・車両マスター

- 案件登録時に顧客・車両を自動保存（`customers` / `vehicles` テーブル）
- 顧客名入力でサジェスト表示、選択時に保有車両を自動入力
- 車両情報は **メーカー / 車種 / 登録番号** の3フィールドに分割管理

### 4. 案件詳細からのQR補充（受付後）

- 案件詳細 → 基本情報タブ → **「📷 QRで補充」ボタン**
- 入庫後でも車検証QRから車両情報を更新可能
- メーカー/車種/登録番号を3分割で編集・保存

### 5. CSV出力（admin / manager）

- ヘッダーバーの「CSV」ボタン → 事業・期間・ステータスで絞り込み
- 22項目、BOM付きUTF-8（Excel対応）

---

## 追加されたDBテーブル（自動マイグレーション）

```sql
-- 顧客マスター
CREATE TABLE customers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kana TEXT,
  phone TEXT, email TEXT, address TEXT, note TEXT,
  active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT
);

-- 車両メーカーマスター
CREATE TABLE vehicle_makers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE, sort_order INTEGER DEFAULT 0
);

-- 車種マスター
CREATE TABLE vehicle_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maker_id INTEGER NOT NULL REFERENCES vehicle_makers(id),
  name TEXT NOT NULL, UNIQUE(maker_id, name)
);

-- 車両マスター
CREATE TABLE vehicles (
  id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id),
  maker TEXT, model TEXT, plate TEXT, color TEXT,
  year INTEGER, vin TEXT, note TEXT,
  active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT
);

-- jobsテーブルへの追加カラム（既存DBに自動追加）
-- customer_id, vehicle_id, vehicle_maker, vehicle_model, vehicle_plate
```

---

## 追加APIエンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/customers?q=` | 顧客検索（サジェスト用） |
| POST | `/api/customers` | 顧客登録 |
| PUT | `/api/customers/:id` | 顧客更新 |
| GET | `/api/vehicles?customer_id=` | 車両一覧 |
| POST | `/api/vehicles` | 車両登録 |
| GET | `/api/vehicle-makers` | メーカー＋車種マスター |
| GET | `/api/jobs/csv` | CSV出力 |

---

## QRスキャン仕様

- ライブラリ: **jsQR v1.4.0**（CDN自動ロード、`cdn.jsdelivr.net`）
- カメラ: `getUserMedia` → リアカメラ優先（`facingMode: environment`）
- スキャン間隔: 200ms（CPU負荷軽減）
- **HTTPS必須**（localhostは除く）。HTTPでのカメラ使用不可
- 車検証QR以外を読み取った場合は再スキャンを促す

### カメラエラー対処

| エラー | 対処 |
|---|---|
| NotAllowedError | ブラウザのアドレスバー横アイコンから許可 |
| HTTP接続 | HTTPS化、またはlocalhost使用 |
| NotFoundError | デバイスにカメラなし（テスト用サンプルを使用） |
| 別アプリ使用中 | 他のアプリを閉じて再試行 |

---

## バージョン履歴（抜粋）

| バージョン | 主な変更 |
|---|---|
| v5.2 | 予約フロー・受付時QR補充・顧客/車両マスター・CSV出力 |
| v5.1 | 招待URL認証・ロールベースアクセス制御 |
| v5.0 | 多拠点対応（BP/HP事業分離）・WIP上限 |
| v4.1 | 楽観的ロック・競合検知・フィット表示 |
| v4.0 | カンバン・工程テンプレート・収益管理 |

