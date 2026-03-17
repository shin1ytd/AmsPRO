// ============================================================
// server.js — Ams PRO v5.2
// 追加機能:
//   ① 顧客マスター (customers) CRUD
//   ② 車両マスター (vehicles: maker/model/plate) CRUD
//   ③ 車両メーカー・車種マスター (vehicle_makers, vehicle_models)
//   ④ jobs.vehicle_name を maker/model/plate に分割
//   ⑤ GET /api/jobs/csv — 案件一覧CSV出力 (manager=自拠点, admin=全拠点)
// ============================================================
'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const PORT    = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db', 'ams_pro.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ DBファイルが見つかりません。先に node seed_prod.js を実行してください。');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================
// 自動マイグレーション（起動時に新テーブル・カラムを追加）
// ============================================================
function migrate() {
  // ── 顧客マスター ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      kana        TEXT NOT NULL DEFAULT '',
      phone       TEXT NOT NULL DEFAULT '',
      email       TEXT NOT NULL DEFAULT '',
      address     TEXT NOT NULL DEFAULT '',
      note        TEXT NOT NULL DEFAULT '',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
    CREATE INDEX IF NOT EXISTS idx_customers_kana ON customers(kana);
  `);

  // ── 車両メーカーマスター ─────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicle_makers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );
  `);

  // ── 車種マスター ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicle_models (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      maker_id    INTEGER NOT NULL REFERENCES vehicle_makers(id),
      name        TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      UNIQUE(maker_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_vmodels_maker ON vehicle_models(maker_id);
  `);

  // ── 車両マスター ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id            TEXT PRIMARY KEY,
      customer_id   TEXT REFERENCES customers(id),
      maker         TEXT NOT NULL DEFAULT '',
      model         TEXT NOT NULL DEFAULT '',
      plate         TEXT NOT NULL DEFAULT '',
      color         TEXT NOT NULL DEFAULT '',
      year          INTEGER,
      vin           TEXT NOT NULL DEFAULT '',
      note          TEXT NOT NULL DEFAULT '',
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
    CREATE INDEX IF NOT EXISTS idx_vehicles_plate    ON vehicles(plate);
  `);

  // ── jobs テーブルに customer_id / vehicle_id / 分割カラム追加 ─
  const jobCols = db.prepare("PRAGMA table_info(jobs)").all().map(c => c.name);
  if (!jobCols.includes('customer_id')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN customer_id TEXT REFERENCES customers(id)`);
    console.log('✅ Migration: jobs.customer_id');
  }
  if (!jobCols.includes('vehicle_id')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN vehicle_id TEXT REFERENCES vehicles(id)`);
    console.log('✅ Migration: jobs.vehicle_id');
  }
  if (!jobCols.includes('vehicle_maker')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN vehicle_maker TEXT NOT NULL DEFAULT ''`);
    console.log('✅ Migration: jobs.vehicle_maker');
  }
  if (!jobCols.includes('vehicle_model')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN vehicle_model TEXT NOT NULL DEFAULT ''`);
    console.log('✅ Migration: jobs.vehicle_model');
  }
  if (!jobCols.includes('vehicle_plate')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN vehicle_plate TEXT NOT NULL DEFAULT ''`);
    console.log('✅ Migration: jobs.vehicle_plate');
  }

  // ── 既存 vehicle_name を maker/model/plate へ自動分割 ─────
  // フォーマット想定: "トヨタ プリウス　品川 530 す 1234" (全角スペース区切り)
  const unparsed = db.prepare(`
    SELECT id, vehicle_name FROM jobs
    WHERE vehicle_maker='' AND vehicle_name IS NOT NULL AND vehicle_name != ''
  `).all();
  if (unparsed.length > 0) {
    const upd = db.prepare(`UPDATE jobs SET vehicle_maker=?,vehicle_model=?,vehicle_plate=? WHERE id=?`);
    db.transaction(() => {
      for (const row of unparsed) {
        const parts = row.vehicle_name.split(/[\s　]+/);
        const maker = parts[0] || '';
        const model = parts[1] || '';
        const plate = parts.slice(2).join(' ') || '';
        upd.run(maker, model, plate, row.id);
      }
    })();
    console.log(`✅ Migration: ${unparsed.length}件の vehicle_name を分割`);
  }

  // ── デフォルト車両メーカーを投入（空の場合のみ） ──────────
  const makerCount = db.prepare('SELECT COUNT(*) as n FROM vehicle_makers').get().n;
  if (makerCount === 0) {
    const makers = [
      'トヨタ','ホンダ','日産','マツダ','スバル','三菱','スズキ','ダイハツ',
      'レクサス','いすゞ','日野','三菱ふそう','UDトラックス',
      'BMW','メルセデス・ベンツ','アウディ','フォルクスワーゲン',
      'ボルボ','プジョー','ルノー','フォード','GM','クライスラー',
      'テスラ','ポルシェ','フェラーリ','ランボルギーニ','その他'
    ];
    const ins = db.prepare('INSERT INTO vehicle_makers(name,sort_order) VALUES(?,?)');
    db.transaction(() => makers.forEach((n, i) => ins.run(n, i)))();

    // トヨタの主要車種も投入
    const toyotaId = db.prepare("SELECT id FROM vehicle_makers WHERE name='トヨタ'").get()?.id;
    if (toyotaId) {
      const models = ['プリウス','カローラ','ヴォクシー','アルファード','ハイエース',
        'ランドクルーザー','ヤリス','アクア','ノア','C-HR','RAV4','クラウン','カムリ'];
      const insM = db.prepare('INSERT OR IGNORE INTO vehicle_models(maker_id,name,sort_order) VALUES(?,?,?)');
      db.transaction(() => models.forEach((n, i) => insM.run(toyotaId, n, i)))();
    }
    // ホンダの主要車種
    const hondaId = db.prepare("SELECT id FROM vehicle_makers WHERE name='ホンダ'").get()?.id;
    if (hondaId) {
      const models = ['フィット','ステップワゴン','フリード','N-BOX','ヴェゼル','CR-V','シビック','アコード','レジェンド'];
      const insM = db.prepare('INSERT OR IGNORE INTO vehicle_models(maker_id,name,sort_order) VALUES(?,?,?)');
      db.transaction(() => models.forEach((n, i) => insM.run(hondaId, n, i)))();
    }
    console.log('✅ Migration: 車両メーカーマスター投入');
  }
}

migrate();

// ============================================================
// app setup
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function ok(res, data)             { res.json({ ok: true, data }); }
function err(res, msg, status=400) { res.status(status).json({ ok: false, error: msg }); }

// ============================================================
// 既存API: マスター一括
// ============================================================
app.get('/api/masters', (req, res) => {
  try {
    const users       = db.prepare('SELECT * FROM users WHERE active=1 ORDER BY id').all();
    const stages      = db.prepare('SELECT * FROM stages ORDER BY div, stage_order').all();
    const holdReasons = db.prepare('SELECT * FROM hold_reasons ORDER BY sort_order').all();
    const ngReasons   = db.prepare('SELECT * FROM ng_reasons ORDER BY div, sort_order').all();
    const upstreams   = db.prepare('SELECT * FROM upstreams WHERE active=1 ORDER BY sort_order').all();
    const templates   = db.prepare('SELECT * FROM templates ORDER BY div, id').all();
    const wipLimits   = db.prepare('SELECT * FROM wip_limits').all();
    const kpiTargets  = db.prepare('SELECT * FROM kpi_targets ORDER BY div, month').all();
    const makers      = db.prepare('SELECT * FROM vehicle_makers ORDER BY sort_order').all();
    const templatesP  = templates.map(t => ({ ...t, stage_ids: JSON.parse(t.stage_ids) }));
    ok(res, { users, stages, holdReasons, ngReasons, upstreams, templates: templatesP, wipLimits, kpiTargets, vehicleMakers: makers });
  } catch (e) { err(res, e.message, 500); }
});

// ============================================================
// ① 顧客マスター CRUD
// ============================================================
app.get('/api/customers', (req, res) => {
  try {
    const { q } = req.query;
    let sql = 'SELECT * FROM customers WHERE active=1';
    const params = [];
    if (q) { sql += ` AND (name LIKE ? OR kana LIKE ? OR phone LIKE ?)`; params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
    sql += ' ORDER BY kana, name LIMIT 100';
    ok(res, db.prepare(sql).all(...params));
  } catch (e) { err(res, e.message, 500); }
});

app.get('/api/customers/:id', (req, res) => {
  try {
    const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
    if (!c) return err(res, '顧客が見つかりません', 404);
    const vehicles = db.prepare('SELECT * FROM vehicles WHERE customer_id=? AND active=1 ORDER BY updated_at DESC').all(c.id);
    ok(res, { ...c, vehicles });
  } catch (e) { err(res, e.message, 500); }
});

app.post('/api/customers', (req, res) => {
  try {
    const { name, kana='', phone='', email='', address='', note='' } = req.body;
    if (!name) return err(res, '顧客名は必須です');
    const id = 'c' + Date.now();
    db.prepare(`INSERT INTO customers(id,name,kana,phone,email,address,note) VALUES(?,?,?,?,?,?,?)`)
      .run(id, name, kana, phone, email, address, note);
    ok(res, db.prepare('SELECT * FROM customers WHERE id=?').get(id));
  } catch (e) { err(res, e.message, 500); }
});

app.put('/api/customers/:id', (req, res) => {
  try {
    const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
    if (!c) return err(res, '顧客が見つかりません', 404);
    const { name, kana, phone, email, address, note } = req.body;
    db.prepare(`UPDATE customers SET name=?,kana=?,phone=?,email=?,address=?,note=?,updated_at=datetime('now','localtime') WHERE id=?`)
      .run(name??c.name, kana??c.kana, phone??c.phone, email??c.email, address??c.address, note??c.note, c.id);
    ok(res, db.prepare('SELECT * FROM customers WHERE id=?').get(c.id));
  } catch (e) { err(res, e.message, 500); }
});

app.delete('/api/customers/:id', (req, res) => {
  try {
    db.prepare("UPDATE customers SET active=0,updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message, 500); }
});

// ============================================================
// ② 車両マスター CRUD
// ============================================================
app.get('/api/vehicles', (req, res) => {
  try {
    const { q, customer_id } = req.query;
    let sql = 'SELECT * FROM vehicles WHERE active=1';
    const params = [];
    if (customer_id) { sql += ' AND customer_id=?'; params.push(customer_id); }
    if (q) { sql += ' AND (maker LIKE ? OR model LIKE ? OR plate LIKE ?)'; params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
    sql += ' ORDER BY updated_at DESC LIMIT 100';
    ok(res, db.prepare(sql).all(...params));
  } catch (e) { err(res, e.message, 500); }
});

app.post('/api/vehicles', (req, res) => {
  try {
    const { customer_id=null, maker='', model='', plate='', color='', year=null, vin='', note='' } = req.body;
    const id = 'v' + Date.now();
    db.prepare(`INSERT INTO vehicles(id,customer_id,maker,model,plate,color,year,vin,note) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(id, customer_id, maker, model, plate, color, year, vin, note);
    ok(res, db.prepare('SELECT * FROM vehicles WHERE id=?').get(id));
  } catch (e) { err(res, e.message, 500); }
});

app.put('/api/vehicles/:id', (req, res) => {
  try {
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.params.id);
    if (!v) return err(res, '車両が見つかりません', 404);
    const { customer_id, maker, model, plate, color, year, vin, note } = req.body;
    db.prepare(`UPDATE vehicles SET customer_id=?,maker=?,model=?,plate=?,color=?,year=?,vin=?,note=?,updated_at=datetime('now','localtime') WHERE id=?`)
      .run(customer_id??v.customer_id, maker??v.maker, model??v.model, plate??v.plate,
           color??v.color, year??v.year, vin??v.vin, note??v.note, v.id);
    ok(res, db.prepare('SELECT * FROM vehicles WHERE id=?').get(v.id));
  } catch (e) { err(res, e.message, 500); }
});

// ============================================================
// ③ 車両メーカー・車種マスター
// ============================================================
app.get('/api/vehicle-makers', (req, res) => {
  try {
    const makers = db.prepare('SELECT * FROM vehicle_makers ORDER BY sort_order').all();
    const models = db.prepare('SELECT * FROM vehicle_models ORDER BY maker_id, sort_order').all();
    ok(res, { makers, models });
  } catch (e) { err(res, e.message, 500); }
});

app.post('/api/vehicle-makers', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return err(res, 'メーカー名は必須です');
    const max = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM vehicle_makers').get().m;
    db.prepare('INSERT OR IGNORE INTO vehicle_makers(name,sort_order) VALUES(?,?)').run(name, max+1);
    const makers = db.prepare('SELECT * FROM vehicle_makers ORDER BY sort_order').all();
    ok(res, makers);
  } catch (e) { err(res, e.message, 500); }
});

app.post('/api/vehicle-models', (req, res) => {
  try {
    const { maker_id, name } = req.body;
    if (!maker_id || !name) return err(res, 'maker_idとnameは必須です');
    const max = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM vehicle_models WHERE maker_id=?').get(maker_id).m;
    db.prepare('INSERT OR IGNORE INTO vehicle_models(maker_id,name,sort_order) VALUES(?,?,?)').run(maker_id, name, max+1);
    ok(res, db.prepare('SELECT * FROM vehicle_models WHERE maker_id=? ORDER BY sort_order').all(maker_id));
  } catch (e) { err(res, e.message, 500); }
});

// ============================================================
// 既存API: 案件一覧（タスク込み）— vehicle分割カラム追加
// ============================================================
app.get('/api/jobs', (req, res) => {
  try {
    const { div, status, upstream, q } = req.query;
    let where = [], params = {};
    if (div && div !== 'all')           { where.push('j.div = @div');              params.div = div; }
    if (status && status !== 'all')     { where.push('j.status = @status');        params.status = status; }
    if (upstream && upstream !== 'all') { where.push('j.upstream = @upstream');    params.upstream = upstream; }
    if (q) {
      where.push(`(j.customer_name LIKE @q OR j.vehicle_name LIKE @q OR j.job_number LIKE @q
        OR j.vehicle_maker LIKE @q OR j.vehicle_model LIKE @q OR j.vehicle_plate LIKE @q)`);
      params.q = `%${q}%`;
    }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const jobs = db.prepare(`SELECT * FROM jobs j ${whereStr} ORDER BY j.entry_date DESC`).all(params);
    const jobIds = jobs.map(j => j.id);
    let tasks = [];
    if (jobIds.length > 0) {
      const ph = jobIds.map(() => '?').join(',');
      tasks = db.prepare(`SELECT * FROM tasks WHERE job_id IN (${ph}) ORDER BY job_id, sequence`).all(jobIds);
    }
    const taskMap = {};
    for (const t of tasks) { if (!taskMap[t.job_id]) taskMap[t.job_id] = []; taskMap[t.job_id].push(t); }
    ok(res, jobs.map(j => ({ ...j, tasks: taskMap[j.id] || [] })));
  } catch (e) { err(res, e.message, 500); }
});

// ============================================================
// ③ CSV出力 — GET /api/jobs/csv
// query: center_id (多拠点の場合), role/user_id はヘッダーで渡す想定
// ここでは簡易実装: ?role=admin|manager&center_id=xxx
// ============================================================
app.get('/api/jobs/csv', (req, res) => {
  try {
    const { role, center_id, div, date_from, date_to } = req.query;

    // 権限チェック（adminまたはmanagerのみ）
    if (!['admin','manager'].includes(role)) {
      return res.status(403).send('権限がありません');
    }

    let where = [], params = {};

    // managerは自拠点のみ（center_idが必要）
    if (role === 'manager' && center_id) {
      where.push('j.center_id = @center_id');
      params.center_id = center_id;
    }
    if (div && div !== 'all')       { where.push('j.div = @div');         params.div = div; }
    if (date_from)                  { where.push('j.entry_date >= @df');   params.df = date_from; }
    if (date_to)                    { where.push('j.entry_date <= @dt');   params.dt = date_to; }

    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const jobs = db.prepare(`
      SELECT
        j.job_number, j.entry_date, j.div,
        j.customer_name,
        j.vehicle_maker, j.vehicle_model, j.vehicle_plate,
        j.vehicle_name,
        j.priority, j.upstream,
        j.promised_delivery, j.settlement_date,
        j.estimate_amount, j.estimate_parts_cost, j.estimate_labor_cost,
        j.actual_amount, j.settlement_status, j.status,
        u.name AS front_name,
        j.note, j.created_at, j.updated_at
      FROM jobs j
      LEFT JOIN users u ON u.id = j.front_owner_id
      ${whereStr}
      ORDER BY j.entry_date DESC
    `).all(params);

    // CSV生成
    const HEADERS = [
      '案件番号','受付日','事業','顧客名',
      'メーカー','車種','登録番号','車両名(旧)',
      '優先度','元受け',
      '約束納車日','清算予定日',
      '見込み売上','見込み部品原価','見込み工賃',
      '実績金額','清算状況','進捗ステータス',
      '担当フロント','備考','登録日時','更新日時'
    ];

    const STATUS_JP  = { in_progress:'進行中', completed:'完了', cancelled:'キャンセル', open:'受付' };
    const SETTLE_JP  = { unsettled:'未清算', settled:'清算済', cancelled:'取消' };
    const PRI_JP     = { urgent:'緊急', high:'急ぎ', normal:'通常', low:'余裕' };
    const DIV_JP     = { bp:'BP（板金）', hp:'HP（整備）' };

    const escape = v => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g,'""')}"`;
      return s;
    };

    const rows = jobs.map(j => [
      j.job_number,
      j.entry_date,
      DIV_JP[j.div] || j.div,
      j.customer_name,
      j.vehicle_maker || '',
      j.vehicle_model || '',
      j.vehicle_plate || '',
      j.vehicle_name  || '',
      PRI_JP[j.priority] || j.priority,
      j.upstream || '',
      j.promised_delivery || '',
      j.settlement_date   || '',
      j.estimate_amount   || 0,
      j.estimate_parts_cost || 0,
      j.estimate_labor_cost || 0,
      j.actual_amount || '',
      SETTLE_JP[j.settlement_status] || j.settlement_status,
      STATUS_JP[j.status] || j.status,
      j.front_name || '',
      j.note || '',
      j.created_at || '',
      j.updated_at || '',
    ].map(escape).join(','));

    const bom  = '\uFEFF'; // Excel用BOM (UTF-8)
    const csv  = bom + [HEADERS.join(','), ...rows].join('\r\n');
    const now  = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const fname = `amspro_jobs_${now}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(csv);
  } catch (e) { err(res, e.message, 500); }
});

// ============================================================
// 既存API: 案件詳細（単件）
// ============================================================
app.get('/api/jobs/:id', (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return err(res, '案件が見つかりません', 404);
    const tasks = db.prepare('SELECT * FROM tasks WHERE job_id = ? ORDER BY sequence').all(job.id);
    ok(res, { ...job, tasks });
  } catch (e) { err(res, e.message, 500); }
});

// ============================================================
// 既存API: 案件登録 — vehicle分割カラム対応
// ============================================================
app.post('/api/jobs', (req, res) => {
  try {
    const { tasks = [], ...jobData } = req.body;
    if (db.prepare('SELECT id FROM jobs WHERE job_number = ?').get(jobData.job_number)) {
      return err(res, '同じ案件番号が既に存在します');
    }

    // vehicle_name が渡された場合、分割カラムも自動設定
    if (jobData.vehicle_name && !jobData.vehicle_maker) {
      const parts = jobData.vehicle_name.split(/[\s　]+/);
      jobData.vehicle_maker = parts[0] || '';
      jobData.vehicle_model = parts[1] || '';
      jobData.vehicle_plate = parts.slice(2).join(' ') || '';
    }

    const insJob = db.prepare(`
      INSERT INTO jobs(id,job_number,customer_name,vehicle_name,
        vehicle_maker,vehicle_model,vehicle_plate,
        customer_id,vehicle_id,
        priority,div,sub_type,
        entry_date,promised_delivery,internal_deadline,settlement_date,
        estimate_amount,estimate_parts_cost,estimate_labor_cost,
        upstream,front_owner_id,created_by,note,status,settlement_status,version)
      VALUES(@id,@job_number,@customer_name,@vehicle_name,
        @vehicle_maker,@vehicle_model,@vehicle_plate,
        @customer_id,@vehicle_id,
        @priority,@div,@sub_type,
        @entry_date,@promised_delivery,@internal_deadline,@settlement_date,
        @estimate_amount,@estimate_parts_cost,@estimate_labor_cost,
        @upstream,@front_owner_id,@created_by,@note,@status,@settlement_status,@version)
    `);
    const insTask = db.prepare(`
      INSERT INTO tasks(id,job_id,stage_id,sequence,status,assignee_id,finish_eta,hold_reason_id,ng_reason_id,rework_count,note,completed_at,version)
      VALUES(@id,@job_id,@stage_id,@sequence,@status,@assignee_id,@finish_eta,@hold_reason_id,@ng_reason_id,@rework_count,@note,@completed_at,@version)
    `);

    db.transaction(() => {
      insJob.run({
        ...jobData,
        customer_id:   jobData.customer_id   || null,
        vehicle_id:    jobData.vehicle_id    || null,
        vehicle_maker: jobData.vehicle_maker || '',
        vehicle_model: jobData.vehicle_model || '',
        vehicle_plate: jobData.vehicle_plate || '',
        settlement_date:    jobData.settlement_date    || jobData.promised_delivery || jobData.entry_date,
        status:             jobData.status             || 'in_progress',
        settlement_status:  jobData.settlement_status  || 'unsettled',
        version: 1,
      });
      for (const t of tasks) {
        insTask.run({
          id: t.id, job_id: jobData.id,
          stage_id: t.stage_id || t.stageId,
          sequence: t.sequence || 0,
          status: t.status || 'pending',
          assignee_id: t.assignee_id || t.assigneeId || null,
          finish_eta: t.finish_eta || t.finishEta || null,
          hold_reason_id: t.hold_reason_id || t.holdReasonId || null,
          ng_reason_id: t.ng_reason_id || t.ngReasonId || null,
          rework_count: t.rework_count || t.reworkCount || 0,
          note: t.note || '',
          completed_at: t.completed_at || t.completedAt || null,
          version: 1,
        });
      }
    })();

    const created      = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobData.id);
    const createdTasks = db.prepare('SELECT * FROM tasks WHERE job_id = ? ORDER BY sequence').all(jobData.id);
    ok(res, { ...created, tasks: createdTasks });
  } catch (e) { err(res, e.message, 500); }
});

// ============================================================
// 既存API: 案件更新 — vehicle分割カラム対応
// ============================================================
app.put('/api/jobs/:id', (req, res) => {
  try {
    const { id } = req.params, body = req.body;
    const current = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!current) return err(res, '案件が見つかりません', 404);
    if (body.version !== undefined && body.version !== current.version) {
      return err(res, `競合が発生しました。(server:${current.version} / client:${body.version})`, 409);
    }

    // vehicle_name が更新された場合、分割カラムも追従
    let vMaker = body.vehicle_maker ?? current.vehicle_maker ?? '';
    let vModel = body.vehicle_model ?? current.vehicle_model ?? '';
    let vPlate = body.vehicle_plate ?? current.vehicle_plate ?? '';
    if (body.vehicle_name && !body.vehicle_maker) {
      const parts = body.vehicle_name.split(/[\s　]+/);
      vMaker = parts[0] || current.vehicle_maker || '';
      vModel = parts[1] || current.vehicle_model || '';
      vPlate = parts.slice(2).join(' ') || current.vehicle_plate || '';
    }

    db.prepare(`
      UPDATE jobs SET
        customer_name=@customer_name, vehicle_name=@vehicle_name,
        vehicle_maker=@vehicle_maker, vehicle_model=@vehicle_model, vehicle_plate=@vehicle_plate,
        customer_id=@customer_id, vehicle_id=@vehicle_id,
        priority=@priority,
        promised_delivery=@promised_delivery, internal_deadline=@internal_deadline,
        settlement_date=@settlement_date,
        estimate_amount=@estimate_amount, estimate_parts_cost=@estimate_parts_cost,
        estimate_labor_cost=@estimate_labor_cost, actual_amount=@actual_amount,
        settlement_status=@settlement_status, status=@status,
        upstream=@upstream, front_owner_id=@front_owner_id, note=@note,
        version=version+1, updated_at=datetime('now','localtime')
      WHERE id=@id
    `).run({
      id,
      customer_name:       body.customer_name       ?? current.customer_name,
      vehicle_name:        body.vehicle_name        ?? current.vehicle_name,
      vehicle_maker:       vMaker,
      vehicle_model:       vModel,
      vehicle_plate:       vPlate,
      customer_id:         body.customer_id         ?? current.customer_id,
      vehicle_id:          body.vehicle_id          ?? current.vehicle_id,
      priority:            body.priority            ?? current.priority,
      promised_delivery:   body.promised_delivery   !== undefined ? body.promised_delivery   : current.promised_delivery,
      internal_deadline:   body.internal_deadline   !== undefined ? body.internal_deadline   : current.internal_deadline,
      settlement_date:     body.settlement_date     !== undefined ? body.settlement_date     : current.settlement_date,
      estimate_amount:     body.estimate_amount     !== undefined ? body.estimate_amount     : current.estimate_amount,
      estimate_parts_cost: body.estimate_parts_cost !== undefined ? body.estimate_parts_cost : current.estimate_parts_cost,
      estimate_labor_cost: body.estimate_labor_cost !== undefined ? body.estimate_labor_cost : current.estimate_labor_cost,
      actual_amount:       body.actual_amount       !== undefined ? body.actual_amount       : current.actual_amount,
      settlement_status:   body.settlement_status   ?? current.settlement_status,
      status:              body.status              ?? current.status,
      upstream:            body.upstream            !== undefined ? body.upstream            : current.upstream,
      front_owner_id:      body.front_owner_id      !== undefined ? body.front_owner_id      : current.front_owner_id,
      note:                body.note                !== undefined ? body.note                : current.note,
    });

    const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    const tasks   = db.prepare('SELECT * FROM tasks WHERE job_id = ? ORDER BY sequence').all(id);
    ok(res, { ...updated, tasks });
  } catch (e) { err(res, e.message, 500); }
});

// ============================================================
// 残りの既存API（変更なし）
// ============================================================
app.put('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params, body = req.body;
    const current = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!current) return err(res, 'タスクが見つかりません', 404);
    if (body.version !== undefined && body.version !== current.version)
      return err(res, `競合: server=${current.version} client=${body.version}`, 409);
    db.prepare(`UPDATE tasks SET status=@status,assignee_id=@assignee_id,finish_eta=@finish_eta,hold_reason_id=@hold_reason_id,ng_reason_id=@ng_reason_id,rework_count=@rework_count,note=@note,completed_at=@completed_at,version=version+1,updated_at=datetime('now','localtime') WHERE id=@id`).run({
      id,
      status:         body.status         ?? current.status,
      assignee_id:    body.assignee_id    ?? current.assignee_id,
      finish_eta:     body.finish_eta     !== undefined ? body.finish_eta     : current.finish_eta,
      hold_reason_id: body.hold_reason_id !== undefined ? body.hold_reason_id : current.hold_reason_id,
      ng_reason_id:   body.ng_reason_id   !== undefined ? body.ng_reason_id   : current.ng_reason_id,
      rework_count:   body.rework_count   ?? current.rework_count,
      note:           body.note           ?? current.note,
      completed_at:   body.completed_at   !== undefined ? body.completed_at   : current.completed_at,
    });
    ok(res, db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
  } catch (e) { err(res, e.message, 500); }
});

app.get('/api/upstreams', (req, res) => { try { ok(res, db.prepare('SELECT * FROM upstreams WHERE active=1 ORDER BY sort_order').all()); } catch(e){ err(res,e.message,500); }});
app.post('/api/upstreams', (req, res) => { try { const{name,color='#1d4ed8'}=req.body; if(!name)return err(res,'nameは必須です'); const m=db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM upstreams').get().m; db.prepare('INSERT INTO upstreams(name,color,sort_order) VALUES(?,?,?)').run(name,color,m+1); ok(res,db.prepare('SELECT * FROM upstreams WHERE active=1 ORDER BY sort_order').all()); }catch(e){err(res,e.message,500);}});
app.put('/api/upstreams/:id', (req, res) => { try { const{name,color}=req.body; db.prepare('UPDATE upstreams SET name=COALESCE(?,name),color=COALESCE(?,color) WHERE id=?').run(name||null,color||null,req.params.id); ok(res,db.prepare('SELECT * FROM upstreams WHERE active=1 ORDER BY sort_order').all()); }catch(e){err(res,e.message,500);}});
app.delete('/api/upstreams/:id', (req, res) => { try { db.prepare('UPDATE upstreams SET active=0 WHERE id=?').run(req.params.id); ok(res,db.prepare('SELECT * FROM upstreams WHERE active=1 ORDER BY sort_order').all()); }catch(e){err(res,e.message,500);}});
app.put('/api/wip-limits', (req, res) => { try { const u=db.prepare('INSERT OR REPLACE INTO wip_limits(stage_id,div,wip_limit) VALUES(@stage_id,@div,@wip_limit)'); db.transaction(()=>req.body.forEach(l=>u.run(l)))(); ok(res,db.prepare('SELECT * FROM wip_limits').all()); }catch(e){err(res,e.message,500);}});
app.put('/api/kpi-targets', (req, res) => { try { const u=db.prepare(`INSERT INTO kpi_targets(div,month,sales_target,profit_target,count_target,updated_at) VALUES(@div,@month,@sales_target,@profit_target,@count_target,datetime('now','localtime')) ON CONFLICT(div,month) DO UPDATE SET sales_target=excluded.sales_target,profit_target=excluded.profit_target,count_target=excluded.count_target,updated_at=excluded.updated_at`); db.transaction(()=>req.body.forEach(t=>u.run(t)))(); ok(res,db.prepare('SELECT * FROM kpi_targets ORDER BY div,month').all()); }catch(e){err(res,e.message,500);}});
app.get('/api/users', (req, res) => { try { ok(res, db.prepare('SELECT * FROM users WHERE active=1 ORDER BY id').all()); }catch(e){err(res,e.message,500);}});
app.post('/api/users', (req, res) => { try { const{id,name,role,email,div,password}=req.body; if(!id||!name||!role||!email||!div||!password)return err(res,'必須項目が不足しています'); db.prepare('INSERT INTO users(id,name,role,email,div,password) VALUES(?,?,?,?,?,?)').run(id,name,role,email,div,password); ok(res,db.prepare('SELECT * FROM users WHERE active=1 ORDER BY id').all()); }catch(e){err(res,e.message,500);}});
app.put('/api/users/:id', (req, res) => { try { const{name,role,email,div,password}=req.body; const c=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id); if(!c)return err(res,'ユーザーが見つかりません',404); db.prepare("UPDATE users SET name=?,role=?,email=?,div=?,password=?,updated_at=datetime('now','localtime') WHERE id=?").run(name||c.name,role||c.role,email||c.email,div||c.div,password||c.password,req.params.id); ok(res,db.prepare('SELECT * FROM users WHERE active=1 ORDER BY id').all()); }catch(e){err(res,e.message,500);}});
app.delete('/api/users/:id', (req, res) => { try { db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.id); ok(res,db.prepare('SELECT * FROM users WHERE active=1 ORDER BY id').all()); }catch(e){err(res,e.message,500);}});
app.post('/api/login', (req, res) => { try { const{email,password}=req.body; const user=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email); if(!user)return err(res,'メールアドレスが見つかりません',401); if(user.password!==password)return err(res,'パスワードが正しくありません',401); const{password:_,...safeUser}=user; ok(res,safeUser); }catch(e){err(res,e.message,500);}});
app.get('/api/next-job-number', (req, res) => { try { const{div}=req.query; const p=div==='hp'?'#3':'#2'; const r=db.prepare('SELECT job_number FROM jobs WHERE job_number LIKE ? ORDER BY job_number DESC LIMIT 1').get(p+'%'); let n=p==='#2'?'#20001':'#30001'; if(r){const x=parseInt(r.job_number.replace('#',''),10);n=`#${x+1}`;} ok(res,{jobNumber:n}); }catch(e){err(res,e.message,500);}});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🔧 Ams PRO v5.2 サーバー起動（顧客・車両DB + CSV出力対応）');
  console.log(`   ローカル:  http://localhost:${PORT}`);
  const os = require('os');
  Object.values(require('os').networkInterfaces()).flat().filter(n=>n.family==='IPv4'&&!n.internal)
    .forEach(n=>console.log(`   社内LAN:   http://${n.address}:${PORT}`));
  console.log('');
});
