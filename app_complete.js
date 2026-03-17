// ============================================================
// Ams PRO v4.1 — フロントエンド (API連携版)
// サーバー: Node.js + Express + SQLite
// ============================================================

// ============================================================
// API ヘルパー
// ============================================================
const API = {
  async get(path) {
    const r = await fetch(path);
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || 'API Error');
    return d.data;
  },
  async post(path, body) {
    const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || 'API Error');
    return d.data;
  },
  async put(path, body) {
    const r = await fetch(path, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || 'API Error');
    return d.data;
  },
  async del(path) {
    const r = await fetch(path, { method:'DELETE' });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || 'API Error');
    return d.data;
  },
};

// ============================================================
// MASTER DATA (APIから取得。起動時に上書きされる)
// ============================================================
let BP_STAGES = [];
let HP_STAGES = [];
let STAGES = [];
let USERS = [];
let HOLD_REASONS = [];
let BP_NG_REASONS = [];
let HP_NG_REASONS = [];
let BP_TEMPLATES = {};
let HP_TEMPLATES = {};
let DEFAULT_BP_WIP = {};
let DEFAULT_HP_WIP = {};
let DEFAULT_UPSTREAMS = [];
let VEHICLE_MAKERS = [];
let VEHICLE_MODELS = [];

const TRANSFER_STAGE_CODES = ['pickup','delivery','reservation'];

const ST_LABELS={pending:'未着手',ready:'作業可',in_progress:'作業中',completed:'完了',hold:'保留'};
// 案件ステータス（タスクステータスとは別）
const JOB_ST_LABELS={reserved:'📅 予約',open:'受付済',in_progress:'作業中',completed:'完了',cancelled:'キャンセル'};
const JOB_ST_COLORS={reserved:'#7c3aed',open:'#1d4ed8',in_progress:'#b45309',completed:'#047857',cancelled:'#64748b'};
const ST_COLORS={pending:'#64748b',ready:'#1d4ed8',in_progress:'#b45309',completed:'#047857',hold:'#b91c1c'};
const PRI_LABELS={urgent:'🔴 緊急',high:'🟠 急ぎ',normal:'⬜ 通常',low:'🟢 余裕'};
const ROLE_LABELS={admin:'管理者',manager:'工場長',front:'フロント',worker:'作業者',
  inspector:'検査員',parts:'部品係',process:'工程係',driver:'引取・納車',readonly:'閲覧専用'};
const DIV_LABELS={hp:'HP事業（一般整備）',bp:'BP事業（板金）',all:'全事業'};

const QR_DEMO_VEHICLES=[
  {plate:'品川 530 す 1234',maker:'トヨタ',model:'プリウス',year:2022,vin:'JN1BABCM7N0123456',owner:'三田村 康雄',color:'パールホワイト',engine:'2ZR-FXE',disp:1800},
  {plate:'練馬 501 あ 5678',maker:'ホンダ',model:'フリード',year:2023,vin:'JN3CABC1P0234567',owner:'大野 紀子',color:'プラチナホワイト',engine:'L15B',disp:1500},
  {plate:'足立 302 え 9012',maker:'スズキ',model:'スペーシア',year:2024,vin:'SNE12ABC0P0345678',owner:'橘 正樹',color:'シルバー',engine:'R06A',disp:660},
  {plate:'八王子 330 こ 3456',maker:'マツダ',model:'CX-5',year:2023,vin:'JN1T4BSA0P0456789',owner:'柏木 啓子',color:'ソウルレッド',engine:'SH-VPTS',disp:2200},
  {plate:'多摩 580 く 2345',maker:'ダイハツ',model:'タント',year:2023,vin:'JN1FBAJ11P0567890',owner:'西村 加奈',color:'カーキ',engine:'KF-VE',disp:660},
];

// ============================================================
// HELPERS
// ============================================================
const today=new Date();
const isoDate=d=>{const r=new Date(d);return r.toISOString().slice(0,10)};
const addD=(d,n)=>isoDate(new Date(new Date(d).getTime()+n*86400000));
const diffD=d=>d?Math.ceil((new Date(d)-today)/86400000):null;
const fmtD=d=>d?new Date(d).toLocaleDateString('ja-JP',{month:'2-digit',day:'2-digit'}):'—';
const nextMon=()=>{const d=new Date();const dd=d.getDay();d.setDate(d.getDate()+(dd===0?1:8-dd));return isoDate(d)};
const T=isoDate(today);
const monthKey=d=>{if(!d)return'';const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`};
const currentMonthKey=monthKey(today);
const prevMonthKey=(()=>{const d=new Date(today);d.setMonth(d.getMonth()-1);return monthKey(d)})();
const inRange=(d,from,to)=>{if(!d)return false;const v=String(d);if(from&&v<from)return false;if(to&&v>to)return false;return true;};
const isCompactViewport=()=>window.matchMedia('(max-width: 1024px)').matches;

// DBカラム名 (snake_case) → JS (camelCase) の変換
function normalizeJob(j) {
  if (!j) return j;
  return {
    id: j.id,
    jobNumber: j.job_number || j.jobNumber,
    customerName: j.customer_name || j.customerName,
    vehicleName: j.vehicle_name || j.vehicleName,
    vehicleMaker: j.vehicle_maker || j.vehicleMaker || '',
    vehicleModel: j.vehicle_model || j.vehicleModel || '',
    vehiclePlate: j.vehicle_plate || j.vehiclePlate || '',
    customerId:   j.customer_id   || j.customerId   || null,
    vehicleId:    j.vehicle_id    || j.vehicleId    || null,
    priority: j.priority || 'normal',
    div: j.div,
    subType: j.sub_type || j.subType || null,
    entryDate: j.entry_date || j.entryDate,
    promisedDelivery: j.promised_delivery || j.promisedDelivery || null,
    internalDeadline: j.internal_deadline || j.internalDeadline || null,
    settlementDate: j.settlement_date || j.settlementDate || null,
    estimateAmount: j.estimate_amount ?? j.estimateAmount ?? null,
    estimatePartsCost: j.estimate_parts_cost ?? j.estimatePartsCost ?? null,
    estimateLaborCost: j.estimate_labor_cost ?? j.estimateLaborCost ?? null,
    actualAmount: j.actual_amount ?? j.actualAmount ?? null,
    settlementStatus: j.settlement_status || j.settlementStatus || 'unsettled',
    status: j.status || 'open',
    upstream: j.upstream || '',
    frontOwnerId: j.front_owner_id || j.frontOwnerId || null,
    createdBy: j.created_by || j.createdBy || null,
    note: j.note || '',
    version: j.version || 1,
    tasks: (j.tasks || []).map(normalizeTask),
  };
}
function normalizeTask(t) {
  if (!t) return t;
  return {
    id: t.id,
    jobId: t.job_id || t.jobId,
    stageId: t.stage_id || t.stageId,
    sequence: t.sequence || 0,
    status: t.status || 'pending',
    assigneeId: t.assignee_id || t.assigneeId || null,
    finishEta: t.finish_eta || t.finishEta || null,
    holdReasonId: t.hold_reason_id || t.holdReasonId || null,
    ngReasonId: t.ng_reason_id || t.ngReasonId || null,
    reworkCount: t.rework_count ?? t.reworkCount ?? 0,
    note: t.note || '',
    completedAt: t.completed_at || t.completedAt || null,
    version: t.version || 1,
  };
}
function normalizeStage(s) {
  return {
    id: s.id, code: s.code, name: s.name,
    order: s.stage_order ?? s.order ?? 0,
    group: s.stage_group || s.group || '',
    hrs: s.hrs || 0, div: s.div,
  };
}
function normalizeHoldReason(h) {
  return { id: h.id, code: h.code, name: h.name };
}
function normalizeUpstream(u) {
  return { id: u.id, name: u.name, color: u.color || '#1d4ed8' };
}

// ============================================================
// KPIデフォルト生成
// ============================================================
function buildDefaultKpiTargets(div) {
  const base = new Date(today.getFullYear(), today.getMonth(), 1);
  const arr = [];
  const defaults = div === 'hp'
    ? { salesTarget: 3500, profitTarget: 900, countTarget: 50 }
    : { salesTarget: 9000, profitTarget: 2200, countTarget: 24 };
  for (let i = -1; i < 11; i++) {
    const d = new Date(base);
    d.setMonth(base.getMonth() + i);
    arr.push({ month: monthKey(d), ...defaults });
  }
  return arr;
}

// ============================================================
// STATE
// ============================================================
let STATE = {
  user: null, view: 'myview',
  users: [],
  jobs: [],
  selectedJob: null, selectedTask: null,
  modal: null, conflictData: null, qrScanned: null, qrCameraError: null, checkinJobId: null,
  listFilter: 'all', listUpstream: 'all', listSort: 'dateDesc', listDiv: 'all',
  customerUpstream: 'all',
  dashboardPeriod: 'currentMonth', dashDiv: 'bp',
  masterTab: 'stages', masterDiv: 'bp', jobDetailTab: 'flow',
  kanbanView: 'transfer',
  kanbanMode: 'scroll',
  sidebarOpen: false,
  vehicleSearch: '',
  upstreams: [],
  bpKpiTargets: buildDefaultKpiTargets('bp'),
  hpKpiTargets: buildDefaultKpiTargets('hp'),
  bpWipLimits: {},
  hpWipLimits: {},
  toast: null, toastTimer: null,
  loading: false,
};

function setState(patch) {
  if (typeof patch === 'function') patch = patch(STATE);
  Object.assign(STATE, patch);
  render();
}
function showToast(msg, type = 's') {
  clearTimeout(STATE.toastTimer);
  const t = setTimeout(() => setState({ toast: null, toastTimer: null }), 3000);
  setState({ toast: { msg, type }, toastTimer: t });
}

// ============================================================
// API連携: マスター・案件ロード
// ============================================================
async function loadMasters() {
  const data = await API.get('/api/masters');
  const allStages = (data.stages || []).map(normalizeStage);
  BP_STAGES = allStages.filter(s => s.div === 'bp');
  HP_STAGES = allStages.filter(s => s.div === 'hp');
  STAGES = allStages;
  USERS = data.users || [];
  HOLD_REASONS = (data.holdReasons || []).map(normalizeHoldReason);
  BP_NG_REASONS = (data.ngReasons || []).filter(n => n.div === 'bp');
  HP_NG_REASONS = (data.ngReasons || []).filter(n => n.div === 'hp');
  DEFAULT_UPSTREAMS = (data.upstreams || []).map(normalizeUpstream);
  BP_TEMPLATES = {};
  HP_TEMPLATES = {};
  (data.templates || []).forEach(t => {
    const key = t.id.replace('bp_', '').replace('hp_', '');
    if (t.div === 'bp') BP_TEMPLATES[key] = { name: t.name, stages: t.stage_ids };
    else HP_TEMPLATES[key] = { name: t.name, stages: t.stage_ids };
  });
  DEFAULT_BP_WIP = {};
  DEFAULT_HP_WIP = {};
  (data.wipLimits || []).forEach(w => {
    if (w.div === 'bp') DEFAULT_BP_WIP[w.stage_id] = w.wip_limit;
    else DEFAULT_HP_WIP[w.stage_id] = w.wip_limit;
  });
  const bpKpi = (data.kpiTargets || []).filter(k => k.div === 'bp').map(k => ({
    month: k.month, salesTarget: k.sales_target, profitTarget: k.profit_target, countTarget: k.count_target
  }));
  const hpKpi = (data.kpiTargets || []).filter(k => k.div === 'hp').map(k => ({
    month: k.month, salesTarget: k.sales_target, profitTarget: k.profit_target, countTarget: k.count_target
  }));

  // v5.2: 車両メーカー・車種マスター
  try {
    const vd = await API.get('/api/vehicle-makers');
    VEHICLE_MAKERS = vd.makers || [];
    VEHICLE_MODELS = vd.models || [];
  } catch(e) {}

  Object.assign(STATE, {
    users: USERS,
    upstreams: DEFAULT_UPSTREAMS,
    bpKpiTargets: bpKpi.length ? bpKpi : buildDefaultKpiTargets('bp'),
    hpKpiTargets: hpKpi.length ? hpKpi : buildDefaultKpiTargets('hp'),
    bpWipLimits: { ...DEFAULT_BP_WIP },
    hpWipLimits: { ...DEFAULT_HP_WIP },
  });
}

async function loadJobs() {
  const raw = await API.get('/api/jobs');
  return raw.map(normalizeJob);
}

// ============================================================
// API連携: タスク・案件更新（非同期、楽観的UI）
// NOTE: updateTask / updateJob はここで1回だけ定義する（同期版との二重定義を排除）
// ============================================================
async function updateTask(jobId, taskId, changes, clientVer) {
  let conflict = null;
  const optimisticJobs = STATE.jobs.map(j => {
    if (j.id !== jobId) return j;
    return { ...j, tasks: j.tasks.map(t => {
      if (t.id !== taskId) return t;
      if (t.version !== clientVer) { conflict = { task: { ...t }, attempted: changes, clientVer }; return t; }
      return { ...t, ...changes, version: t.version + 1 };
    })};
  });
  if (conflict) {
    setState({ jobs: optimisticJobs, conflictData: conflict, selectedJob: optimisticJobs.find(j => j.id === jobId), modal: 'conflict' });
    return false;
  }
  setState({ jobs: optimisticJobs });

  try {
    const apiChanges = {};
    if (changes.status !== undefined)       apiChanges.status = changes.status;
    if (changes.assigneeId !== undefined)   apiChanges.assignee_id = changes.assigneeId;
    if (changes.finishEta !== undefined)    apiChanges.finish_eta = changes.finishEta;
    if (changes.holdReasonId !== undefined) apiChanges.hold_reason_id = changes.holdReasonId;
    if (changes.ngReasonId !== undefined)   apiChanges.ng_reason_id = changes.ngReasonId;
    if (changes.reworkCount !== undefined)  apiChanges.rework_count = changes.reworkCount;
    if (changes.note !== undefined)         apiChanges.note = changes.note;
    if (changes.completedAt !== undefined)  apiChanges.completed_at = changes.completedAt;
    apiChanges.version = clientVer;
    await API.put(`/api/tasks/${taskId}`, apiChanges);
  } catch (e) {
    showToast('保存に失敗しました。再読み込みします。', 'e');
    await refreshJobs();
    return false;
  }
  return true;
}

async function updateJob(jobId, changes) {
  const jobs = STATE.jobs.map(j => j.id === jobId ? { ...j, ...changes, version: (j.version || 1) + 1 } : j);
  const selected = jobs.find(j => j.id === jobId) || null;
  setState({ jobs, selectedJob: selected });

  try {
    const apiChanges = {};
    if (changes.customerName !== undefined)      apiChanges.customer_name = changes.customerName;
    if (changes.vehicleName    !== undefined) apiChanges.vehicle_name   = changes.vehicleName;
  if (changes.vehicleMaker   !== undefined) apiChanges.vehicle_maker  = changes.vehicleMaker;
  if (changes.vehicleModel   !== undefined) apiChanges.vehicle_model  = changes.vehicleModel;
  if (changes.vehiclePlate   !== undefined) apiChanges.vehicle_plate  = changes.vehiclePlate;
  if (changes.customerId     !== undefined) apiChanges.customer_id    = changes.customerId;
  if (changes.vehicleId      !== undefined) apiChanges.vehicle_id     = changes.vehicleId;
  if (changes.status         !== undefined) apiChanges.status         = changes.status;
    if (changes.priority !== undefined)          apiChanges.priority = changes.priority;
    if (changes.promisedDelivery !== undefined)  apiChanges.promised_delivery = changes.promisedDelivery;
    if (changes.internalDeadline !== undefined)  apiChanges.internal_deadline = changes.internalDeadline;
    if (changes.settlementDate !== undefined)    apiChanges.settlement_date = changes.settlementDate;
    if (changes.estimateAmount !== undefined)    apiChanges.estimate_amount = changes.estimateAmount;
    if (changes.estimatePartsCost !== undefined) apiChanges.estimate_parts_cost = changes.estimatePartsCost;
    if (changes.estimateLaborCost !== undefined) apiChanges.estimate_labor_cost = changes.estimateLaborCost;
    if (changes.actualAmount !== undefined)      apiChanges.actual_amount = changes.actualAmount;
    if (changes.settlementStatus !== undefined)  apiChanges.settlement_status = changes.settlementStatus;
    if (changes.status !== undefined)            apiChanges.status = changes.status;
    if (changes.upstream !== undefined)          apiChanges.upstream = changes.upstream;
    if (changes.frontOwnerId !== undefined)      apiChanges.front_owner_id = changes.frontOwnerId;
    if (changes.note !== undefined)              apiChanges.note = changes.note;
    const prevVer = (STATE.jobs.find(j => j.id === jobId)?.version || 2) - 1;
    apiChanges.version = prevVer;
    await API.put(`/api/jobs/${jobId}`, apiChanges);
  } catch (e) {
    showToast('保存に失敗しました。', 'e');
    await refreshJobs();
  }
  return selected;
}

async function refreshJobs() {
  try {
    const jobs = await loadJobs();
    setState({ jobs });
  } catch (e) { /* ignore */ }
}


// ============================================================
// API連携: ログイン
// ============================================================
async function doLogin(email, password) {

  // 入力チェック
  if (!email || !password) {
    alert("メールアドレスとパスワードを入力してください");
    return null;
  }

  const user = await API.post('/api/login', { email, password });

  return user;
}

// ============================================================
// API連携: 案件登録
// ============================================================
async function createJob(jobData, tasks) {
  const body = {
    id: jobData.id,
    job_number: jobData.jobNumber,
    customer_name: jobData.customerName,
    vehicle_name: jobData.vehicleName,
    vehicle_maker: jobData.vehicleMaker || '',
    vehicle_model: jobData.vehicleModel || '',
    vehicle_plate: jobData.vehiclePlate || '',
    customer_id:   jobData.customerId   || null,
    vehicle_id:    jobData.vehicleId    || null,
    priority: jobData.priority,
    div: jobData.div,
    sub_type: jobData.subType || null,
    entry_date: jobData.entryDate,
    promised_delivery: jobData.promisedDelivery || null,
    internal_deadline: jobData.internalDeadline || null,
    settlement_date: jobData.settlementDate || null,
    estimate_amount: jobData.estimateAmount || null,
    estimate_parts_cost: jobData.estimatePartsCost || null,
    estimate_labor_cost: jobData.estimateLaborCost || null,
    upstream: jobData.upstream || '',
    front_owner_id: jobData.frontOwnerId || null,
    created_by: jobData.createdBy || null,
    note: jobData.note || '',
    tasks: tasks.map(t => ({
      id: t.id,
      stage_id: t.stageId,
      sequence: t.sequence,
      status: t.status,
      assignee_id: t.assigneeId || null,
      finish_eta: t.finishEta || null,
      hold_reason_id: t.holdReasonId || null,
      ng_reason_id: t.ngReasonId || null,
      rework_count: t.reworkCount || 0,
      note: t.note || '',
      completed_at: t.completedAt || null,
      version: 1,
    })),
  };
  const created = await API.post('/api/jobs', body);
  return normalizeJob(created);
}

// ============================================================
// API連携: マスター更新
// ============================================================
async function saveUpstreams(upstreams) {
  setState({ upstreams, masterTab: 'upstreams' });
}

async function saveWipLimits(div, limits) {
  const body = Object.entries(limits).map(([stage_id, wip_limit]) => ({ stage_id, div, wip_limit }));
  try {
    await API.put('/api/wip-limits', body);
  } catch (e) { showToast('WIP保存失敗', 'e'); }
  if (div === 'bp') setState({ bpWipLimits: limits });
  else setState({ hpWipLimits: limits });
}

async function saveKpiTargets(div, targets) {
  const body = targets.map(t => ({
    div, month: t.month,
    sales_target: parseInt(t.salesTarget) || 0,
    profit_target: parseInt(t.profitTarget) || 0,
    count_target: parseInt(t.countTarget) || 0,
  }));
  try {
    await API.put('/api/kpi-targets', body);
    if (div === 'bp') setState({ bpKpiTargets: targets });
    else setState({ hpKpiTargets: targets });
  } catch (e) { showToast('KPI保存失敗', 'e'); }
}

// ============================================================
// HELPERS 2
// ============================================================
function getCurTask(job){
  return job.tasks.find(t=>['in_progress','hold'].includes(t.status))
      || job.tasks.find(t=>t.status==='ready')
      || job.tasks[job.tasks.length-1];
}
function getCurStageName(job){const t=getCurTask(job);const s=STAGES.find(s=>s.id===t?.stageId);return s?.name||'—';}
function getUsers(){return STATE.users||USERS;}
function getUserById(id){return getUsers().find(u=>u.id===id);}
function getUpstreamMaster(name){return (STATE.upstreams||[]).find(u=>(typeof u==='string'?u:u.name)===name);}
function getUpstreamOptions(){return (STATE.upstreams||[]).map(u=>typeof u==='string'?u:u.name).filter(Boolean);}
function getUpstreamColor(name){return getUpstreamMaster(name)?.color||'var(--acc2)';}
function getUpstreamShort(name){return Array.from(String(name||'自受け')).slice(0,2).join('');}
function upstreamBadge(name){
  return `<span class="up-badge" style="background:${getUpstreamColor(name)}">${name||'自受け'}</span>`;
}
function divTag(div){
  return `<span class="div-tag ${div}">${div==='hp'?'HP':'BP'}</span>`;
}
function subTypeLabel(st){
  return {shaken:'🔍車検',teiten:'📋定点',general:'🔧一般'}[st]||'';
}
function canEdit(user,task,job){
  if(!user||user.role==='readonly')return false;
  if(user.role==='admin')return true;
  if(user.div!=='all'&&user.div!==job?.div)return false;
  if(['manager'].includes(user.role))return true;
  if(user.role==='front')return (job?.frontOwnerId||'')===user.id;
  if(user.role==='driver'){
    const s=STAGES.find(s=>s.id===task?.stageId);
    return TRANSFER_STAGE_CODES.includes(s?.code);
  }
  return ['worker','inspector','parts','process'].includes(user.role)&&task?.assigneeId===user.id;
}
function canEditFinance(user,job){
  if(!user||user.role==='readonly'||['worker','inspector','parts','process','driver'].includes(user.role))return false;
  if(user.role==='admin')return true;
  if(user.div!=='all'&&user.div!==job?.div)return false;
  if(user.role==='manager')return true;
  return user.role==='front'&&(job?.frontOwnerId||'')===user.id;
}
function canEditJob(user,job){
  if(!user||user.role==='readonly'||['worker','inspector','parts','process','driver'].includes(user.role))return false;
  if(user.role==='admin')return true;
  if(user.div!=='all'&&user.div!==job?.div)return false;
  if(user.role==='manager')return true;
  return user.role==='front'&&(job?.frontOwnerId||'')===user.id;
}
function canSeeMoney(user){return['admin','manager','front'].includes(user?.role);}
function getProfit(j){return (j.estimateAmount||0)-(j.estimatePartsCost||0)-(j.estimateLaborCost||0);}
function getPeriodJobs(period,div){
  const nextMonthKey=(()=>{const d=new Date(today);d.setMonth(d.getMonth()+1);return monthKey(d);})();
  let jobs=div&&div!=='all'?STATE.jobs.filter(j=>j.div===div):STATE.jobs;
  if(period==='all')return jobs;
  return jobs.filter(j=>{
    const k=monthKey(j.settlementDate||j.promisedDelivery||j.entryDate);
    return period==='nextMonth'?k===nextMonthKey:k===currentMonthKey;
  });
}
function getKpiTarget(period,div){
  const targets=div==='hp'?STATE.hpKpiTargets:STATE.bpKpiTargets;
  const nextMonthKey=(()=>{const d=new Date(today);d.setMonth(d.getMonth()+1);return monthKey(d);})();
  const keys=period==='all'
    ?[...new Set(getPeriodJobs('all',div).map(j=>monthKey(j.settlementDate||j.promisedDelivery||j.entryDate)).filter(Boolean))]
    :[period==='nextMonth'?nextMonthKey:currentMonthKey];
  return (targets||[]).filter(t=>keys.includes(t.month)).reduce((acc,t)=>({
    salesTarget:acc.salesTarget+((parseInt(t.salesTarget,10)||0)*1000),
    profitTarget:acc.profitTarget+((parseInt(t.profitTarget,10)||0)*1000),
    countTarget:acc.countTarget+(parseInt(t.countTarget,10)||0)
  }),{salesTarget:0,profitTarget:0,countTarget:0});
}
function getStagesForDiv(div){return div==='hp'?HP_STAGES:BP_STAGES;}
function getTemplatesForDiv(div){return div==='hp'?HP_TEMPLATES:BP_TEMPLATES;}
function getWipLimits(div){return div==='hp'?STATE.hpWipLimits:STATE.bpWipLimits;}
function getNgReasons(div){return div==='hp'?HP_NG_REASONS:BP_NG_REASONS;}
function getUsersForDiv(div){
  return getUsers().filter(u=>u.div===div||u.div==='all');
}
function getUserDefaultView(user){
  if(!user)return'myview';
  if(user.role==='driver')return'kanban';
  return'myview';
}

// ============================================================
// RENDER
// ============================================================
function render(){
  const root=document.getElementById('app');
  if(!root)return;
  if(!STATE.user){root.innerHTML=loginHTML();bindLogin();return;}
  root.innerHTML=shellHTML();
  bindAll();
  if(STATE.toast){
    const el=document.createElement('div');
    el.className=`toast ${STATE.toast.type}`;
    el.textContent=(STATE.toast.type==='s'?'✅ ':STATE.toast.type==='e'?'❌ ':'ℹ️ ')+STATE.toast.msg;
    document.body.appendChild(el);
  }
}

// ============================================================
// LOGIN
// ============================================================
function loginHTML(){
  const allUsers = getUsers()
    .filter(u=>u.role!=='readonly')
    .sort((a,b)=>{
      const na = Number(a.id.replace('u',''));
      const nb = Number(b.id.replace('u',''));
      return na - nb;
    });

  const bpUsers=allUsers.filter(u=>u.div==='bp'||u.div==='all');
  const hpUsers=allUsers.filter(u=>u.div==='hp');
  const driverUsers=allUsers.filter(u=>u.role==='driver');

  return `<div class="login-bg"><div class="login-box">
    <div class="l-brand">🔧 Ams PRO</div>
    <div class="l-tag">NTA工程管理システム v4.0</div>
    <div class="fg"><label class="flbl">メールアドレス</label>
      <input class="fi" id="l-em" value="" placeholder="メールアドレス" autocomplete="username"></div>
    <div class="fg"><label class="flbl">パスワード</label>
      <input class="fi" id="l-pw" type="password" value="" placeholder="パスワード" autocomplete="current-password"></div>
    <div id="l-err"></div>
    <button class="btn btn-p" id="l-go" style="width:100%;margin-top:4px">ログイン →</button>

    <div style="margin-top:18px;border-top:1px solid var(--bdr);padding-top:14px">
      <div style="font-size:11px;color:var(--txt3);margin-bottom:6px;font-weight:700">🔵 BP事業（板金）</div>
      <div class="demo-grid" style="margin-bottom:10px">
        ${bpUsers.map(u=>`<button class="demo-btn" data-em="${u.email}">${u.name}<span class="demo-r">${ROLE_LABELS[u.role]}</span></button>`).join('')}
      </div>

      <div style="font-size:11px;color:var(--cyn);margin-bottom:6px;font-weight:700">💎 HP事業（一般整備）</div>
      <div class="demo-grid" style="margin-bottom:10px">
        ${hpUsers.map(u=>`<button class="demo-btn hp-demo" data-em="${u.email}">${u.name}<span class="demo-r">${ROLE_LABELS[u.role]}</span></button>`).join('')}
      </div>

      <div style="font-size:11px;color:var(--txt3);margin-bottom:6px;font-weight:700">🚚 引取り・納車</div>
      <div class="demo-grid">
        ${driverUsers.map(u=>`<button class="demo-btn" data-em="${u.email}">${u.name}<span class="demo-r">${ROLE_LABELS[u.role]}</span></button>`).join('')}
      </div>
    </div>
  </div></div>`;
}
function bindLogin(){
  document.querySelectorAll('.demo-btn').forEach(b=>
    b.addEventListener('click',()=>{
      document.getElementById('l-em').value=b.dataset.em;
      document.getElementById('l-pw').value='';
      document.getElementById('l-pw').focus();
    })
  );

  const go=async()=>{
    const em=document.getElementById('l-em').value.trim();
    const pw=document.getElementById('l-pw').value.trim();

    if(!em || !pw){
      document.getElementById('l-err').textContent='メールアドレスとパスワードを入力してください';
      return;
    }

    document.getElementById('l-go').disabled=true;
    try{
      const u=await doLogin(em,pw);
      const defaultView=getUserDefaultView(u);
      const defaultKanban=u.div==='hp'?'hp':u.div==='bp'?'bp':'transfer';
      setState({user:u,view:defaultView,kanbanView:defaultKanban});
    }catch(e){
      document.getElementById('l-err').textContent=e.message||'ログインに失敗しました';
    }finally{
      document.getElementById('l-go').disabled=false;
    }
  };

  document.getElementById('l-go')?.addEventListener('click',go);
  document.getElementById('l-pw')?.addEventListener('keydown',e=>{
    if(e.key==='Enter') go();
  });
}
// ============================================================
// SHELL
// ============================================================
function shellHTML(){
  const {user,view,jobs}=STATE;
  const overdue=jobs.filter(j=>diffD(j.promisedDelivery)<0).length;
  const holds=jobs.filter(j=>j.tasks.some(t=>t.status==='hold')).length;
  const bpHolds=jobs.filter(j=>j.div==='bp'&&j.tasks.some(t=>t.status==='hold')).length;
  const hpHolds=jobs.filter(j=>j.div==='hp'&&j.tasks.some(t=>t.status==='hold')).length;

  const showBP=user.div==='bp'||user.div==='all'||user.role==='admin';
  const showHP=user.div==='hp'||user.div==='all'||user.role==='admin';

  const navItems=[
    {v:'myview',i:'👤',l:'マイビュー'},
    user.role==='driver'?null:{v:'sep'},
    user.role!=='driver'&&showBP?{v:'dashboard',i:'📊',l:'BP ダッシュボード',cls:'bp-on'}:null,
    user.role!=='driver'&&showHP?{v:'hp_dashboard',i:'📊',l:'HP ダッシュボード',cls:'hp-on'}:null,
    {v:'sep2'},
    {v:'kanban',i:'🚗',l:'引取り・納車',tag:'共通'},
    showBP?{v:'bp_kanban',i:'🗂️',l:'BP カンバン',badge:bpHolds||null,cls:'bp-on'}:null,
    showHP?{v:'hp_kanban',i:'🗂️',l:'HP カンバン',badge:hpHolds||null,cls:'hp-on'}:null,
    {v:'sep3'},
    user.role!=='driver'?{v:'joblist',i:'📋',l:'案件一覧'}:null,
    {v:'customers',i:'👥',l:'顧客・車両'},
    user.role!=='driver'&&canSeeMoney(user)?{v:'reports',i:'💰',l:'売上レポート'}:null,
    ['admin','manager'].includes(user.role)?{v:'masters',i:'⚙️',l:'マスタ設定'}:null,
  ].filter(Boolean);

  const nav=navItems.map(it=>{
    if(it.v&&it.v.startsWith('sep'))return'<div style="height:1px;background:var(--bdr);margin:8px 4px"></div>';
    if(it.hide)return'';
    const isOn=view===it.v;
    const cls=isOn?(it.cls||'on'):'';
    return`<button class="nav-btn ${cls}" data-view="${it.v}">
      <span class="nav-ico">${it.i}</span><span>${it.l}</span>
      ${it.tag?`<span style="font-size:9px;background:var(--bg3);border:1px solid var(--bdr);border-radius:3px;padding:1px 4px;margin-left:auto;color:var(--txt3)">${it.tag}</span>`:''}
      ${it.badge?`<span class="nav-badge">${it.badge}</span>`:''}
    </button>`;
  }).join('');

  const titles={
    myview:'👤 マイビュー',
    dashboard:'📊 BP ダッシュボード',hp_dashboard:'📊 HP ダッシュボード',
    kanban:'🚗 引取り・納車管理（全事業共通）',
    bp_kanban:'🗂️ BP カンバンボード',hp_kanban:'🗂️ HP カンバンボード',
    joblist:'📋 案件一覧',customers:'👥 顧客・車両管理',
    reports:'💰 売上レポート',masters:'⚙️ マスタ設定'
  };

  const isKanbanView=['kanban','bp_kanban','hp_kanban'].includes(view);
  const kanbanToggle=isKanbanView?`
    <div class="tog-grp">
      <button class="tog-btn ${STATE.kanbanMode==='scroll'?'on':''}" id="kb-tog-scroll" data-kbmode="scroll">⬌ ボード</button>
      <button class="tog-btn ${STATE.kanbanMode==='fit'?'on':''}" id="kb-tog-fit" data-kbmode="fit">⊞ 一覧</button>
    </div>`:'';

  const avClass=user.div==='hp'?'hp':user.div==='bp'?'bp':'all';

  const alerts=[
    overdue?`<span class="bx bx-r">🚨 超過 ${overdue}件</span>`:'',
    holds?`<span class="bx bx-y">⏸ 保留 ${holds}件</span>`:'',
    ['admin','manager','front'].includes(user.role)?`<button class="btn btn-n btn-sm" id="qr-btn" style="border-color:#bfdbfe;color:var(--acc2);background:#eff6ff">📷 QR受付</button>`:'',
    `<span class="bx bx-n" style="font-size:10px">${today.toLocaleDateString('ja-JP')}</span>`,
  ].filter(Boolean).join('');

  return`<div class="app-shell" style="display:flex;height:100vh;overflow:hidden">
  <div class="sb-backdrop ${STATE.sidebarOpen?'on':''}" id="sb-backdrop"></div>
  <aside class="sb ${STATE.sidebarOpen?'mob-open':''}" id="sidebar">
    <div class="sb-logo"><div class="brand">🔧 Ams PRO</div><div class="ver">自動車工程管理 v4.1</div></div>
    <nav class="sb-nav">${nav}</nav>
    <div class="sb-user">
      <div class="u-av ${avClass}">${user.name[0]}</div>
      <div><div class="u-nm">${user.name}</div><div class="u-rl">${ROLE_LABELS[user.role]} / ${user.div==='all'?'全事業':user.div==='hp'?'HP':'BP'}</div></div>
      <button class="logout" id="logout">⎋</button>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <button class="sb-toggle" id="sb-toggle" aria-label="メニュー">☰</button>
      <span class="tb-title">${titles[view]||''}</span>
      ${kanbanToggle}
      <div class="v4-top-tools">
        <label class="v4-search" title="Enterで検索確定">
          <span style="color:var(--txt3)">🔎</span>
          <input id="vehicle-search" value="${String(STATE.vehicleSearch||'').replace(/"/g,'&quot;')}"
            placeholder="車両 / 登録番号 / 顧客 / 案件番号 / 元請け">
        </label>
        <button class="v4-chip-btn" id="today-work-btn">🗓 今日の作業一覧</button>
        <button class="v4-chip-btn ${getDelayedCount()>0?'alert':''}" id="delay-alert-btn">🚨 作業遅延${getDelayedCount()>0?`<span class="v4-chip-badge">${getDelayedCount()}</span>`:''}</button>
        <button class="v4-chip-btn" id="version-history-btn">🕘 履歴</button>
      </div>
      <div class="tb-right">${alerts}</div>
    </header>
    <div class="${isKanbanView?'content no-pad':'content'}" id="mc">${viewHTML()}</div>
  </div>
</div>
${modalHTML()}`;
}

// ============================================================
// VIEWS
// ============================================================
function viewHTML(){
  const v=STATE.view;
  if(v==='myview')return vMyView();
  if(v==='dashboard')return vDashboard('bp');
  if(v==='hp_dashboard')return vDashboard('hp');
  if(v==='kanban')return vKanbanTransfer();
  if(v==='bp_kanban')return vKanbanDiv('bp');
  if(v==='hp_kanban')return vKanbanDiv('hp');
  if(v==='joblist')return vJobList();
  if(v==='customers')return vCustomers();
  if(v==='reports')return vReports();
  if(v==='masters')return vMasters();
  return'';
}

// ── MY VIEW ──────────────────────────────────────────
function vMyView(){
  const {user,jobs}=STATE;
  const myActive=[];
  jobs.forEach(j=>j.tasks.forEach(t=>{
    if(t.assigneeId===user.id&&['in_progress','ready','hold'].includes(t.status))
      myActive.push({j,t});
  }));
  const todayDel=jobs.filter(j=>diffD(j.promisedDelivery)===0);
  const myNext=[];
  jobs.forEach(j=>j.tasks.forEach(t=>{
    if(t.assigneeId===user.id&&t.status==='pending')myNext.push({j,t});
  }));
  const mkCard=(j,t,quick=true)=>{
    const st=STAGES.find(s=>s.id===t.stageId);
    const dd=diffD(j.promisedDelivery);
    const hr=t.holdReasonId?HOLD_REASONS.find(h=>h.id===t.holdReasonId):null;
    const dcls=dd<0?'over':dd<=2?'warn':'safe';
    const dlbl=dd<0?`${Math.abs(dd)}日超過`:dd===0?'本日':`残${dd}日`;
    const editable=canEdit(user,t,j);
    return`<div class="tc" data-otask="${j.id}__${t.id}">
      <div class="tc-st">
        <div class="tc-st-nm">${st?.name||'—'}</div>
        <div style="margin-top:4px;font-size:10px;padding:2px 5px;border-radius:3px;background:${ST_COLORS[t.status]}18;color:${ST_COLORS[t.status]};font-weight:700;display:inline-block">${ST_LABELS[t.status]}</div>
      </div>
      <div class="tc-info">
        <div class="tc-job">${divTag(j.div)}${j.jobNumber} ${j.customerName}</div>
        <div class="tc-veh">🚗 ${j.vehicleName}</div>
        ${hr?`<div style="font-size:10.5px;color:var(--ylw);margin-top:1px">⚠️ ${hr.name}</div>`:''}
        <div class="tc-eta">ETA: ${fmtD(t.finishEta)}</div>
      </div>
      ${quick&&editable?`<div style="display:flex;gap:5px;flex-shrink:0">
        ${t.status!=='completed'?`<button class="btn btn-g btn-sm" data-qdone="${j.id}__${t.id}" onclick="event.stopPropagation()">✓完了</button>`:''}
        ${['in_progress','ready'].includes(t.status)?`<button class="btn btn-y btn-sm" data-qhold="${j.id}__${t.id}" onclick="event.stopPropagation()">⏸保留</button>`:''}
      </div>`:''}
      <span class="kc-day ${dcls}" style="flex-shrink:0">${dlbl}</span>
    </div>`;
  };
  return`
  ${myActive.length>0?`<div style="margin-bottom:20px">
    <div style="font-size:13px;font-weight:700;color:var(--txt2);margin-bottom:10px">🔨 担当中 <span class="bx bx-b">${myActive.length}件</span></div>
    <div style="display:flex;flex-direction:column;gap:7px">${myActive.map(({j,t})=>mkCard(j,t)).join('')}</div>
  </div>`:`<div class="alert info">ℹ️ 現在担当中の工程はありません</div>`}
  ${todayDel.length>0?`<div style="margin-bottom:20px">
    <div style="font-size:13px;font-weight:700;color:var(--txt2);margin-bottom:10px">🚗 本日納車 <span class="bx bx-r">${todayDel.length}件</span></div>
    <div style="display:flex;flex-direction:column;gap:7px">${todayDel.map(j=>`
    <div class="tc" data-ojob="${j.id}">
      <div class="tc-st" style="background:rgba(185,28,28,.06)"><div style="font-size:20px;text-align:center">🚗</div><div style="font-size:10px;color:var(--red);font-weight:700;text-align:center;margin-top:2px">本日納車</div></div>
      <div class="tc-info"><div class="tc-job">${divTag(j.div)}${j.jobNumber} ${j.customerName}</div><div class="tc-veh">${j.vehicleName}</div></div>
      <span class="kc-day over">本日</span>
    </div>`).join('')}</div>
  </div>`:''}
  ${myNext.length>0?`<div>
    <div style="font-size:13px;font-weight:700;color:var(--txt2);margin-bottom:10px">⏭️ 次の自分の作業</div>
    <div style="display:flex;flex-direction:column;gap:6px">${myNext.slice(0,5).map(({j,t})=>mkCard(j,t,false)).join('')}</div>
  </div>`:''}`;
}

// ── DASHBOARD ──────────────────────────────────────────
function vDashboard(div){
  const {user}=STATE;const sm=canSeeMoney(user);
  const period=STATE.dashboardPeriod||'currentMonth';
  const divColor=div==='hp'?'var(--hp)':'var(--bp)';
  const jobs=getPeriodJobs(period,div);
  const tot=jobs.reduce((s,j)=>s+(j.estimateAmount||0),0);
  const totp=jobs.reduce((s,j)=>s+getProfit(j),0);
  const over=jobs.filter(j=>diffD(j.promisedDelivery)<0).length;
  const holds=jobs.filter(j=>j.tasks.some(t=>t.status==='hold')).length;
  const target=getKpiTarget(period,div);
  const stcnt={};
  jobs.forEach(j=>{const t=getCurTask(j);if(t)stcnt[t.stageId]=(stcnt[t.stageId]||0)+1;});
  const maxv=Math.max(1,...Object.values(stcnt),1);
  const stages=getStagesForDiv(div);
  const bnRows=stages.filter(s=>stcnt[s.id]>0).sort((a,b)=>(stcnt[b.id]||0)-(stcnt[a.id]||0))
    .map(s=>{const n=stcnt[s.id];const c=n>=4?'var(--red)':n>=2?'var(--ylw)':divColor;
      return`<div class="bn-r"><div class="bn-lbl">${s.name}</div>
      <div class="bn-tr"><div class="bn-fi" style="width:${n/maxv*100}%;background:${c}"></div></div>
      <div class="bn-n">${n}</div></div>`;}).join('');
  const hcnt={};
  jobs.forEach(j=>j.tasks.filter(t=>t.status==='hold').forEach(t=>{
    const h=HOLD_REASONS.find(r=>r.id===t.holdReasonId);
    if(h)hcnt[h.name]=(hcnt[h.name]||0)+1;
  }));
  const hmax=Math.max(1,...Object.values(hcnt),1);
  const hrRows=Object.entries(hcnt).map(([k,v])=>`
    <div class="bn-r"><div class="bn-lbl" style="width:110px">${k}</div>
    <div class="bn-tr"><div class="bn-fi" style="width:${v/hmax*100}%;background:var(--ylw)"></div></div>
    <div class="bn-n">${v}</div></div>`).join('');
  const pct=(v,t)=>t?Math.round(v/t*100):0;
  const divKpiClass=div==='hp'?'hp-c':'bl';
  return`
  <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:12px;flex-wrap:wrap">
    <button class="fchip ${period==='currentMonth'?'on':''}" data-dash-period="currentMonth">当月</button>
    <button class="fchip ${period==='nextMonth'?'on':''}" data-dash-period="nextMonth">翌月</button>
    <button class="fchip ${period==='all'?'on':''}" data-dash-period="all">全て</button>
  </div>
  <div class="kpi-grid">
    <div class="kpi ${divKpiClass}"><div class="kpi-lbl">進行中</div><div class="kpi-val">${jobs.filter(j=>j.status!=='completed').length}</div><div class="kpi-sub">件</div></div>
    ${sm?`<div class="kpi gn"><div class="kpi-lbl">見込み売上</div><div class="kpi-val">${(tot/10000).toFixed(0)}<span style="font-size:16px">万</span></div>
      ${target.salesTarget?`<div class="kpi-sub">目標比 ${pct(tot,target.salesTarget)}%</div>`:''}</div>
    <div class="kpi gn"><div class="kpi-lbl">見込み粗利</div><div class="kpi-val">${(totp/10000).toFixed(0)}<span style="font-size:16px">万</span></div>
      ${target.profitTarget?`<div class="kpi-sub">目標比 ${pct(totp,target.profitTarget)}%</div>`:''}</div>`:''}
    <div class="kpi rd"><div class="kpi-lbl">保留中</div><div class="kpi-val">${holds}</div><div class="kpi-sub">件</div></div>
    <div class="kpi yl"><div class="kpi-lbl">納期超過</div><div class="kpi-val">${over}</div><div class="kpi-sub">件</div></div>
  </div>
  <div class="g2" style="margin-bottom:18px">
    <div class="card"><div class="card-t">ボトルネック（現在工程）</div>
      <div class="bn">${bnRows||'<div style="color:var(--txt3);font-size:12px">進行中案件なし</div>'}</div></div>
    <div class="card"><div class="card-t">保留理由内訳</div>
      <div class="bn">${hrRows||'<div style="color:var(--txt3);font-size:12px">保留案件なし</div>'}</div></div>
  </div>
  <div class="card"><div class="card-t">納期間近・本日作業</div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${jobs.filter(j=>diffD(j.promisedDelivery)<3).sort((a,b)=>diffD(a.promisedDelivery)-diffD(b.promisedDelivery)).slice(0,5).map(j=>{
        const dd=diffD(j.promisedDelivery);
        return`<div class="tc" data-ojob="${j.id}">
          <div class="tc-st" style="text-align:center;min-width:64px">
            <div style="font-size:9.5px;font-weight:700;color:${dd<0?'var(--red)':dd===0?'var(--ylw)':divColor}">${dd<0?`${Math.abs(dd)}日超過`:dd===0?'本日':`残${dd}日`}</div>
          </div>
          <div class="tc-info">
            <div class="tc-job">${j.jobNumber} ${j.customerName} ${j.subType?`<span style="font-size:10px;color:var(--txt3)">${subTypeLabel(j.subType)}</span>`:''}</div>
            <div class="tc-veh">🚗 ${j.vehicleName}</div>
          </div>
        </div>`;}).join('')||'<div style="color:var(--txt3);font-size:12px">対象案件なし</div>'}
    </div>
  </div>`;
}

// ── KANBAN TRANSFER（引取り・納車統合） ──────────────────────────────────────────
function vKanbanTransfer(){
  const transferCodes=['pickup','delivery'];
  const todayPickup=STATE.jobs.filter(j=>
    j.tasks.some(t=>{ const s=STAGES.find(s=>s.id===t.stageId); return s?.code==='pickup'&&['ready','in_progress'].includes(t.status);})
  );
  const todayDelivery=STATE.jobs.filter(j=>
    j.tasks.some(t=>{ const s=STAGES.find(s=>s.id===t.stageId); return s?.code==='delivery'&&['ready','in_progress'].includes(t.status);})
  );
  const todayDue=STATE.jobs.filter(j=>diffD(j.promisedDelivery)===0||diffD(j.promisedDelivery)===-1||diffD(j.promisedDelivery)===1);

  const mkTransferCard=(j,t)=>{
    const s=STAGES.find(s=>s.id===t.stageId);
    const dd=diffD(j.promisedDelivery);
    const dcls=dd<0?'over':dd<=2?'warn':'safe';
    const dlbl=dd<0?`${Math.abs(dd)}日超過`:dd===0?'本日':`残${dd}日`;
    return`<div class="kb-card ${j.div==='hp'?'hp-card':'bp-card'}" data-otask="${j.id}__${t.id}">
      <div class="kc-num">${divTag(j.div)} ${j.jobNumber}</div>
      <div class="kc-nm">${j.customerName}</div>
      <div class="kc-veh">🚗 ${j.vehicleName}</div>
      <div class="kc-ft">
        <span class="kc-ass">${ST_LABELS[t.status]}</span>
        <span class="kc-day ${dcls}">${dlbl}</span>
      </div>
    </div>`;
  };

  if(STATE.kanbanMode==='fit'){
    const rows=STATE.jobs.filter(j=>
      j.tasks.some(t=>{ const s=STAGES.find(x=>x.id===t.stageId); return transferCodes.includes(s?.code)&&t.status!=='completed'&&t.status!=='pending';})
    );
    const tableRows=rows.map(j=>{
      const t=j.tasks.find(t=>{const s=STAGES.find(x=>x.id===t.stageId);return transferCodes.includes(s?.code)&&t.status!=='completed';});
      const st=STAGES.find(s=>s.id===t?.stageId);
      const dd=diffD(j.promisedDelivery);
      return`<tr data-otask="${j.id}__${t?.id}" style="cursor:pointer">
        <td>${divTag(j.div)}</td>
        <td class="td-m">${j.jobNumber}</td>
        <td style="font-weight:700">${j.customerName}</td>
        <td style="font-size:12px;color:var(--txt2)">${j.vehicleName.split('　')[0]}</td>
        <td style="font-weight:700">${st?.name||'—'}</td>
        <td><span style="font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:3px;background:${ST_COLORS[t?.status||'pending']}18;color:${ST_COLORS[t?.status||'pending']}">${ST_LABELS[t?.status||'pending']}</span></td>
        <td style="font-family:var(--mono);color:${dd<0?'var(--red)':dd<=2?'var(--ylw)':'var(--txt2)'}">${fmtD(j.promisedDelivery)}</td>
      </tr>`;}).join('');
    return`<div class="kb-fit-wrap">
      <table class="kb-fit-table">
        <thead><tr><th>区分</th><th>番号</th><th>顧客</th><th>車両</th><th>工程</th><th>状態</th><th>納車日</th></tr></thead>
        <tbody>${tableRows||'<tr><td colspan="7" style="text-align:center;color:var(--txt3);padding:20px">対象案件なし</td></tr>'}</tbody>
      </table>
    </div>`;
  }

  return`<div class="kb-scroll-wrap">
    <div class="kb-col">
      <div class="kb-hdr">🚗 引取り予定 <span class="kb-cnt">${todayPickup.length}</span></div>
      <div class="kb-cards">
        ${todayPickup.map(j=>{ const t=j.tasks.find(t=>{const s=STAGES.find(x=>x.id===t.stageId);return s?.code==='pickup';});return t?mkTransferCard(j,t):'';}).join('')||
          '<div style="text-align:center;padding:20px;color:var(--txt3);font-size:12px">なし</div>'}
      </div>
    </div>
    <div class="kb-col">
      <div class="kb-hdr">📦 納車予定 <span class="kb-cnt">${todayDelivery.length}</span></div>
      <div class="kb-cards">
        ${todayDelivery.map(j=>{ const t=j.tasks.find(t=>{const s=STAGES.find(x=>x.id===t.stageId);return s?.code==='delivery';});return t?mkTransferCard(j,t):'';}).join('')||
          '<div style="text-align:center;padding:20px;color:var(--txt3);font-size:12px">なし</div>'}
      </div>
    </div>
    <div class="kb-col" style="min-width:200px;max-width:200px">
      <div class="kb-hdr">📅 本日前後の納期 <span class="kb-cnt">${todayDue.length}</span></div>
      <div class="kb-cards">
        ${todayDue.sort((a,b)=>new Date(a.promisedDelivery)-new Date(b.promisedDelivery)).map(j=>{
          const dd=diffD(j.promisedDelivery);
          const dcls=dd<0?'over':dd===0?'warn':'safe';
          const dlbl=dd<0?`${Math.abs(dd)}日超過`:dd===0?'本日':`残${dd}日`;
          return`<div class="kb-card ${j.div==='hp'?'hp-card':'bp-card'}" data-ojob="${j.id}">
            <div class="kc-num">${divTag(j.div)} ${j.jobNumber}</div>
            <div class="kc-nm">${j.customerName}</div>
            <div class="kc-veh">🚗 ${j.vehicleName}</div>
            <div class="kc-ft"><span class="kc-ass">${getCurStageName(j)}</span><span class="kc-day ${dcls}">${dlbl}</span></div>
          </div>`;}).join('')}
      </div>
    </div>
  </div>`;
}

// ── KANBAN DIV（BP / HP） ──────────────────────────────────────────
function vKanbanDiv(div){
  const stages=getStagesForDiv(div);
  const wipLimits=getWipLimits(div);
  const allDivJobs=STATE.jobs.filter(j=>j.div===div);
  const reservedJobs=allDivJobs.filter(j=>j.status==='reserved');
  const jobs=allDivJobs.filter(j=>j.status!=='reserved');
  const canAdd=['admin','manager','front'].includes(STATE.user?.role)&&(STATE.user?.div===div||STATE.user?.div==='all'||STATE.user?.role==='admin');

  if(STATE.kanbanMode==='fit'){
    const rows=jobs.map(j=>{
      const t=getCurTask(j);const st=stages.find(s=>s.id===t?.stageId);
      const ass=t?.assigneeId?getUsers().find(u=>u.id===t.assigneeId):null;
      const dd=diffD(j.promisedDelivery);
      const stageCells=stages.map(s=>{
        const task=j.tasks.find(t=>t.stageId===s.id);
        if(!task)return`<td style="padding:3px 5px"><span style="font-size:9px;color:var(--bdr2)">—</span></td>`;
        const c={completed:div==='hp'?'#0e7490':'#047857',in_progress:div==='hp'?'#0891b2':'#b45309',hold:'#b91c1c',ready:div==='hp'?'#0e7490':'#1d4ed8',pending:'#e2e8f0'}[task.status];
        return`<td style="padding:3px 5px"><div style="width:14px;height:14px;border-radius:2px;background:${c};margin:0 auto" title="${ST_LABELS[task.status]}"></div></td>`;
      }).join('');
      return`<tr data-ojob="${j.id}" style="cursor:pointer">
        <td class="td-m">${j.jobNumber}</td>
        <td style="font-weight:700">${j.customerName}</td>
        ${div==='hp'?`<td style="font-size:11px">${subTypeLabel(j.subType)}</td>`:''}
        <td>${upstreamBadge(j.upstream||'自受け')}</td>
        <td style="font-size:11px">${PRI_LABELS[j.priority]}</td>
        ${stageCells}
        <td><span style="font-family:var(--mono);font-size:12px;font-weight:700;color:${dd<0?'var(--red)':dd<=2?'var(--ylw)':'var(--txt2)'}">${fmtD(j.promisedDelivery)}</span></td>
      </tr>`;}).join('');
    return`<div class="kb-fit-wrap">
      ${canAdd?`<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="btn ${div==='hp'?'btn-hp':'btn-p'} btn-sm" id="new-job-btn">＋ ${div==='hp'?'HP':'BP'} 受付</button></div>`:''}
      <table class="kb-fit-table">
        <thead><tr><th>番号</th><th>顧客</th>${div==='hp'?'<th>種別</th>':''}<th>元受け</th><th>優先</th>
          ${stages.map(s=>`<th style="font-size:9px">${s.name}</th>`).join('')}
          <th>納車日</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  const accentColor=div==='hp'?'var(--hp)':'var(--bp)';

  // 予約カラム（先頭固定）
  const reservedCol=reservedJobs.length>0?`<div class="kb-col">
    <div class="kb-hdr" style="background:linear-gradient(135deg,rgba(124,58,237,.12),rgba(124,58,237,.06));border-bottom:2px solid #7c3aed">
      📅 予約済 <span class="kb-cnt" style="background:#7c3aed;color:#fff">${reservedJobs.length}</span>
    </div>
    <div class="kb-cards">
      ${reservedJobs.map(j=>{
        const dd=diffD(j.promisedDelivery);
        return`<div class="kc" data-ojob="${j.id}" style="border-left:3px solid #7c3aed">
          <div class="kc-top">
            <span class="kc-num">${j.jobNumber}</span>
            ${j.priority==='urgent'?'<span class="bx bx-r" style="font-size:9px">緊急</span>':''}
            <span class="kc-day ${dd<0?'over':dd<=2?'warn':'safe'}" style="margin-left:auto">${dd===null?'日付未定':dd<0?`${Math.abs(dd)}日超過`:dd===0?'本日':`残${dd}日`}</span>
          </div>
          <div class="kc-cust">${j.customerName}</div>
          ${j.vehicleName?`<div class="kc-veh" style="font-size:10.5px">🚗 ${j.vehicleName}</div>`:'<div class="kc-veh" style="font-size:10.5px;color:var(--txt3)">🚗 車両未確定</div>'}
          ${j.note?`<div style="font-size:10px;color:var(--txt3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📝 ${j.note}</div>`:''}
          <div style="margin-top:6px;display:flex;justify-content:flex-end">
            <button class="btn btn-p btn-sm" style="font-size:10px;padding:3px 8px;background:#7c3aed;border-color:#7c3aed" data-checkin="${j.id}" onclick="event.stopPropagation()">🚗 受付する</button>
          </div>
        </div>`;}).join('')}
    </div>
  </div>`:'';

  const cols=stages.map(s=>{
    const wip=wipLimits[s.id];
    const cards=jobs.filter(j=>j.tasks.some(t=>t.stageId===s.id&&['in_progress','hold','ready'].includes(t.status)));
    const n=cards.length;
    const over=wip&&n>=wip;
    return`<div class="kb-col">
      <div class="kb-hdr ${over?'wip-over':''}">${s.name}
        <span class="kb-cnt ${over?'over':''}">${n}${wip?'/'+wip:''}</span>
      </div>
      <div class="kb-cards">
        ${cards.map(j=>{
          const t=j.tasks.find(t=>t.stageId===s.id&&['in_progress','hold','ready'].includes(t.status));
          if(!t)return'';
          const dd=diffD(j.promisedDelivery);
          const dcls=dd<0?'over':dd<=2?'warn':'safe';
          const dlbl=dd<0?`${Math.abs(dd)}日超過`:dd===0?'本日':`残${dd}日`;
          const isHold=t.status==='hold';
          const isUrg=j.priority==='urgent';
          return`<div class="kb-card ${isUrg&&!isHold?'urg':''} ${isHold?'hold':''}" data-otask="${j.id}__${t.id}">
            <div class="kc-num">${j.jobNumber}${div==='hp'&&j.subType?` <span style="font-size:8px;color:var(--txt3)">${subTypeLabel(j.subType)}</span>`:''}</div>
            <div class="kc-nm">${j.customerName} ${upstreamBadge(j.upstream||'自受け')}</div>
            <div class="kc-veh">🚗 ${j.vehicleName.split('　')[0]}</div>
            <div class="kc-ft">
              <span class="kc-ass">${getUsers().find(u=>u.id===t.assigneeId)?.name.split(' ')[1]||'未割当'}</span>
              <span class="kc-day ${dcls}">${dlbl}</span>
            </div>
            ${isHold?`<div style="font-size:8.5px;color:var(--ylw);background:rgba(180,83,9,.1);border-radius:3px;padding:1px 4px;margin-top:2px;display:inline-block">⚠️${HOLD_REASONS.find(h=>h.id===t.holdReasonId)?.name||'保留'}</div>`:''}
          </div>`;
        }).join('')||'<div style="text-align:center;padding:14px;color:var(--txt3);font-size:11px">なし</div>'}
      </div>
    </div>`;
  }).join('');

  return`<div class="kb-scroll-wrap">
    ${canAdd?`<div style="position:absolute;top:10px;right:14px;z-index:5">
      <button class="btn ${div==='hp'?'btn-hp':'btn-p'} btn-sm" id="new-job-btn">＋ ${div==='hp'?'HP':'BP'} 受付</button>
    </div>`:''}
    ${reservedCol}${cols}
  </div>`;
}

// ── JOB LIST ──────────────────────────────────────────
function vJobList(){
  const {user}=STATE;
  const sm=canSeeMoney(user);
  const canAdd=['admin','manager','front'].includes(user.role);
  const fl=STATE.listFilter||'all';
  const lp=STATE.listPeriod||'currentMonth';
  const from=STATE.listDateFrom||addD(today,-30);
  const to=STATE.listDateTo||T;
  const listDiv=STATE.listDiv||'all';

  let base=STATE.jobs;
  if(listDiv!=='all')base=base.filter(j=>j.div===listDiv);
  if(lp==='currentMonth')base=base.filter(j=>monthKey(j.settlementDate||j.promisedDelivery||j.entryDate)===currentMonthKey);
  else if(lp==='prevMonth')base=base.filter(j=>monthKey(j.settlementDate||j.promisedDelivery||j.entryDate)===prevMonthKey);
  else if(lp==='custom')base=base.filter(j=>inRange(j.entryDate,from,to));
  if(STATE.listUpstream&&STATE.listUpstream!=='all')base=base.filter(j=>(j.upstream||'自受け')===STATE.listUpstream);

  const counts={
    all:base.length,
    today:base.filter(j=>diffD(j.promisedDelivery)===0).length,
    over:base.filter(j=>diffD(j.promisedDelivery)<0).length,
    hold:base.filter(j=>j.tasks.some(t=>t.status==='hold')).length,
    urgent:base.filter(j=>j.priority==='urgent').length,
    insp:base.filter(j=>j.tasks.some(t=>{const s=STAGES.find(s=>s.id===t.stageId);return (s?.code==='inspection'||s?.code==='shaken_insp')&&['in_progress','ready'].includes(t.status);})).length,
  };
  let filtered=[...base];
  if(fl==='today')filtered=filtered.filter(j=>diffD(j.promisedDelivery)===0);
  else if(fl==='over')filtered=filtered.filter(j=>diffD(j.promisedDelivery)<0);
  else if(fl==='hold')filtered=filtered.filter(j=>j.tasks.some(t=>t.status==='hold'));
  else if(fl==='urgent')filtered=filtered.filter(j=>j.priority==='urgent');
  else if(fl==='insp')filtered=filtered.filter(j=>j.tasks.some(t=>{const s=STAGES.find(s=>s.id===t.stageId);return (s?.code==='inspection'||s?.code==='shaken_insp')&&['in_progress','ready'].includes(t.status);}));

  const sort=STATE.listSort||'dateDesc';
  if(sort==='dateDesc')filtered.sort((a,b)=>new Date(b.entryDate)-new Date(a.entryDate));
  else if(sort==='dateAsc')filtered.sort((a,b)=>new Date(a.entryDate)-new Date(b.entryDate));
  else if(sort==='profitDesc')filtered.sort((a,b)=>getProfit(b)-getProfit(a));

  const chips=[['all','全件'],['today','📦本日納車'],['over','🚨超過'],['hold','⏸保留'],['urgent','❗緊急'],['insp','🔍検査']]
    .map(([id,lbl])=>`<button class="fchip ${fl===id?'on':''}" data-fl="${id}">${lbl} (${counts[id]})</button>`).join('');

  const rows=filtered.map(j=>{
    const t=getCurTask(j);const st=STAGES.find(s=>s.id===t?.stageId);
    const ass=t?.assigneeId?getUsers().find(u=>u.id===t.assigneeId):null;
    const dd=diffD(j.promisedDelivery);const p=getProfit(j);
    return`<tr style="cursor:pointer" data-ojob="${j.id}">
      <td>${divTag(j.div)}</td>
      <td class="td-m">${j.jobNumber}</td>
      <td style="font-weight:700">${j.customerName}</td>
      <td>${upstreamBadge(j.upstream||'自受け')}</td>
      <td style="color:var(--txt2);font-size:12px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis">${j.vehicleName}</td>
      <td style="font-size:11px">${PRI_LABELS[j.priority]}</td>
      <td>${j.div==='hp'&&j.subType?`<span style="font-size:11px">${subTypeLabel(j.subType)}</span>`:st?.name||'—'}</td>
      <td style="font-size:12px;color:var(--txt2)">${ass?.name||'未割当'}</td>
      <td><span style="font-family:var(--mono);font-size:12px;font-weight:700;color:${dd<0?'var(--red)':dd<=2?'var(--ylw)':'var(--txt2)'}">${fmtD(j.promisedDelivery)}</span></td>
      <td><span style="font-size:10px;padding:2px 6px;border-radius:3px;font-weight:700;background:${ST_COLORS[t?.status||'pending']}18;color:${ST_COLORS[t?.status||'pending']}">${ST_LABELS[t?.status||'pending']}</span></td>
      ${sm?`<td style="font-family:var(--mono);color:${p>0?'var(--grn)':'var(--red)'};font-weight:700">¥${(p/10000).toFixed(1)}万</td>`:''}
    </tr>`;}).join('');

  return`<div class="s-hdr" style="align-items:flex-start;gap:10px;flex-wrap:wrap">
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="fbar" style="margin:0">
        <button class="fchip ${listDiv==='all'?'on':''}" data-listdiv="all">全事業</button>
        <button class="fchip bp-chip ${listDiv==='bp'?'on':''}" data-listdiv="bp">🔵 BP</button>
        <button class="fchip hp-chip ${listDiv==='hp'?'on':''}" data-listdiv="hp">🩵 HP</button>
      </div>
      <div class="fbar" style="margin:0">
        <button class="fchip ${lp==='currentMonth'?'on':''}" data-period="currentMonth">当月分</button>
        <button class="fchip ${lp==='prevMonth'?'on':''}" data-period="prevMonth">前月分</button>
        <button class="fchip ${lp==='custom'?'on':''}" data-period="custom">自由選択</button>
        ${lp==='custom'?`<span style="display:inline-flex;align-items:center;gap:6px;margin-left:4px">
          <input class="fi" type="date" id="list-date-from" value="${from}" style="width:auto;min-width:140px;padding:6px 10px">
          <span style="font-size:12px;color:var(--txt3)">〜</span>
          <input class="fi" type="date" id="list-date-to" value="${to}" style="width:auto;min-width:140px;padding:6px 10px">
        </span>`:''}
      </div>
      <div class="fbar" style="margin:0">${chips}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select class="fi" id="list-upstream" style="width:auto;min-width:160px">
          <option value="all">元受け：すべて</option>
          ${getUpstreamOptions().map(v=>`<option value="${v}" ${STATE.listUpstream===v?'selected':''}>元受け：${v}</option>`).join('')}
        </select>
        <select class="fi" id="list-sort" style="width:auto;min-width:160px">
          <option value="dateDesc" ${STATE.listSort==='dateDesc'?'selected':''}>入庫日（新しい順）</option>
          <option value="dateAsc" ${STATE.listSort==='dateAsc'?'selected':''}>入庫日（古い順）</option>
          <option value="profitDesc" ${STATE.listSort==='profitDesc'?'selected':''}>粗利（高い順）</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:6px">
      ${canExportCSV(STATE.user)?`<button class="btn btn-n btn-sm" id="csv-export-btn">📥 CSV出力</button>`:''}
      ${canAdd?`<button class="btn btn-p btn-sm" id="new-job-btn">＋ 受付</button>`:''}
    </div>
  </div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>区分</th><th>番号</th><th>顧客</th><th>元受け</th><th>車両</th><th>優先</th><th>工程/種別</th><th>担当</th><th>納車日</th><th>状態</th>${sm?'<th>粗利</th>':''}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ── CUSTOMERS ──────────────────────────────────────────
function vCustomers(){
  const custs=[...new Set(STATE.jobs.map(j=>j.customerName))].map(name=>{
    const rel=STATE.jobs.filter(j=>j.customerName===name);
    return{
      name,
      veh:rel[0]?.vehicleName,
      cnt:rel.length,
      bpCnt:rel.filter(j=>j.div==='bp').length,
      hpCnt:rel.filter(j=>j.div==='hp').length,
      totalProfit:rel.reduce((s,j)=>s+getProfit(j),0),
    };
  }).sort((a,b)=>b.cnt-a.cnt||a.name.localeCompare(b.name,'ja'));
  return`<div class="s-hdr" style="align-items:flex-start;gap:10px;flex-wrap:wrap">
    <span style="font-weight:700">顧客一覧 ${custs.length}名</span>
    <div style="display:flex;gap:7px;flex-wrap:wrap">
      <button class="btn btn-n btn-sm" id="qr-btn-cust" style="border-color:#bfdbfe;color:var(--acc2);background:#eff6ff">📷 QRで新規受付</button>
      <button class="btn btn-p btn-sm" id="new-job-btn">＋ 受付登録</button>
    </div>
  </div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>顧客名</th><th>代表車両</th><th>BP案件</th><th>HP案件</th><th>合計</th><th>粗利計</th><th>操作</th></tr></thead>
    <tbody>${custs.map(c=>`<tr><td style="font-weight:700">${c.name}</td>
      <td style="color:var(--txt2);font-size:12px">${c.veh}</td>
      <td>${c.bpCnt>0?`<span class="bx bx-bp">${c.bpCnt}件</span>`:'-'}</td>
      <td>${c.hpCnt>0?`<span class="bx bx-hp">${c.hpCnt}件</span>`:'-'}</td>
      <td><span class="bx bx-n">${c.cnt}件</span></td>
      <td style="font-family:var(--mono);font-weight:700;color:${c.totalProfit>=0?'var(--grn)':'var(--red)'}">¥${c.totalProfit.toLocaleString()}</td>
      <td><button class="btn btn-n btn-sm">詳細</button></td></tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ── REPORTS ──────────────────────────────────────────
function vReports(){
  const {user}=STATE;
  if(!canSeeMoney(user))return'<div class="alert danger">⚠️ 売上レポートを閲覧する権限がありません</div>';
  const bpJobs=STATE.jobs.filter(j=>j.div==='bp');
  const hpJobs=STATE.jobs.filter(j=>j.div==='hp');
  const sum=(arr,fn)=>arr.reduce((s,j)=>s+(fn(j)||0),0);
  const bpTot=sum(bpJobs,j=>j.estimateAmount);const bpP=sum(bpJobs,getProfit);
  const hpTot=sum(hpJobs,j=>j.estimateAmount);const hpP=sum(hpJobs,getProfit);
  return`
  <div style="margin-bottom:18px">
    <div style="font-size:13px;font-weight:700;color:var(--bp);margin-bottom:10px;display:flex;align-items:center;gap:6px">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--bp)"></span> BP事業（板金）
    </div>
    <div class="kpi-grid">
      <div class="kpi bl"><div class="kpi-lbl">売上合計（見込）</div><div class="kpi-val">${(bpTot/10000).toFixed(0)}<span style="font-size:16px">万</span></div></div>
      <div class="kpi gn"><div class="kpi-lbl">粗利合計（見込）</div><div class="kpi-val">${(bpP/10000).toFixed(0)}<span style="font-size:16px">万</span></div></div>
      <div class="kpi gn"><div class="kpi-lbl">粗利率</div><div class="kpi-val">${bpTot?Math.round(bpP/bpTot*100):0}%</div></div>
      <div class="kpi bl"><div class="kpi-lbl">案件数</div><div class="kpi-val">${bpJobs.length}</div></div>
    </div>
  </div>
  <div style="margin-bottom:18px">
    <div style="font-size:13px;font-weight:700;color:var(--hp);margin-bottom:10px;display:flex;align-items:center;gap:6px">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--hp)"></span> HP事業（一般整備）
    </div>
    <div class="kpi-grid">
      <div class="kpi hp-c"><div class="kpi-lbl">売上合計（見込）</div><div class="kpi-val">${(hpTot/10000).toFixed(0)}<span style="font-size:16px">万</span></div></div>
      <div class="kpi gn"><div class="kpi-lbl">粗利合計（見込）</div><div class="kpi-val">${(hpP/10000).toFixed(0)}<span style="font-size:16px">万</span></div></div>
      <div class="kpi gn"><div class="kpi-lbl">粗利率</div><div class="kpi-val">${hpTot?Math.round(hpP/hpTot*100):0}%</div></div>
      <div class="kpi hp-c"><div class="kpi-lbl">案件数</div><div class="kpi-val">${hpJobs.length}</div></div>
    </div>
  </div>
  <div class="card"><div class="card-t">全案件明細</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>区分</th><th>番号</th><th>顧客</th><th>売上見込</th><th>部品原価</th><th>工賃</th><th>粗利</th><th>粗利率</th></tr></thead>
      <tbody>${STATE.jobs.map(j=>{const p=getProfit(j);return`<tr>
        <td>${divTag(j.div)}</td>
        <td class="td-m">${j.jobNumber}</td><td style="font-weight:700">${j.customerName}</td>
        <td style="font-family:var(--mono)">¥${(j.estimateAmount||0).toLocaleString()}</td>
        <td style="font-family:var(--mono);color:var(--red)">¥${(j.estimatePartsCost||0).toLocaleString()}</td>
        <td style="font-family:var(--mono);color:var(--red)">¥${(j.estimateLaborCost||0).toLocaleString()}</td>
        <td style="font-family:var(--mono);font-weight:700;color:${p>0?'var(--grn)':'var(--red)'}">¥${p.toLocaleString()}</td>
        <td style="font-weight:700;color:${p>0?'var(--grn)':'var(--red)'}">${j.estimateAmount?Math.round(p/j.estimateAmount*100):0}%</td>
      </tr>`;}).join('')}
      </tbody>
    </table></div>
  </div>`;
}

// ── MASTERS ──────────────────────────────────────────
function vMasters(){
  const {user}=STATE;
  if(!['admin','manager'].includes(user.role))return'<div class="alert danger">⚠️ マスタ設定を編集する権限がありません</div>';
  const tab=STATE.masterTab||'stages';
  const mDiv=STATE.masterDiv||'bp';

  const divSwitch=(user.role==='admin'||user.div==='all')?`
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="fchip bp-chip ${mDiv==='bp'?'on':''}" data-mdiv="bp">🔵 BP事業</button>
      <button class="fchip hp-chip ${mDiv==='hp'?'on':''}" data-mdiv="hp">🩵 HP事業</button>
      <button class="fchip ${mDiv==='common'?'on':''}" data-mdiv="common">共通</button>
    </div>`:
    `<div style="margin-bottom:12px;font-size:12px;font-weight:700;color:${mDiv==='hp'?'var(--hp)':'var(--bp)'}">${mDiv==='hp'?'🩵 HP事業':'🔵 BP事業'} のマスタを表示中</div>`;

  const masterTabs=mDiv==='common'
    ?[['upstreams','元受け'],['users','ユーザー']]
    :[['stages','工程マスタ'],['wip','WIP上限'],['hold','保留理由'],['ng','NG理由'],['kpi','目標KPI']];

  const th=masterTabs.map(([id,l])=>`<button class="tab ${tab===id?'on':''}" data-mtab="${id}">${l}</button>`).join('');
  let body='';

  if(tab==='stages'){
    const stages=getStagesForDiv(mDiv);
    body=`<div class="tbl-wrap"><table>
      <thead><tr><th>ID</th><th>工程名</th><th>グループ</th><th>標準時間</th></tr></thead>
      <tbody>${stages.map(s=>`<tr>
        <td class="td-m">${s.id}</td>
        <td style="font-weight:600">${s.name}</td>
        <td><span class="bx bx-n">${s.group}</span></td>
        <td>${s.hrs}h</td></tr>`).join('')}
      </tbody></table></div>
      <div class="alert info" style="margin-top:12px">ℹ️ 工程マスタの追加・編集は次期バージョンで対応予定です。</div>`;
  } else if(tab==='wip'){
    const wipLimits=getWipLimits(mDiv);
    const stages=getStagesForDiv(mDiv);
    const wipStages=stages.filter(s=>s.group==='作業'||s.group==='品質');
    body=`<div class="alert info">ℹ️ 各工程の同時進行可能件数（WIP上限）を設定します。上限を超えると赤色で警告されます。</div>
    <div class="card" style="margin-bottom:14px">
      <div class="tbl-wrap"><table>
        <thead><tr><th>工程名</th><th>現在の上限</th><th>新しい上限</th></tr></thead>
        <tbody>${wipStages.map(s=>`<tr>
          <td style="font-weight:600">${s.name}</td>
          <td style="font-family:var(--mono)">${wipLimits[s.id]??'—'}</td>
          <td><input type="number" class="fi" data-wip-input="${s.id}" value="${wipLimits[s.id]??3}" min="1" style="max-width:120px"></td>
        </tr>`).join('')}
        </tbody></table></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button class="btn btn-n" id="wip-reset-btn">初期値に戻す</button>
        <button class="btn btn-p" id="wip-save-btn">WIP上限を保存</button>
      </div>
    </div>`;
  } else if(tab==='hold'){
    body=`<div class="tbl-wrap"><table>
      <thead><tr><th>コード</th><th>理由名</th></tr></thead>
      <tbody>${HOLD_REASONS.map(h=>`<tr><td class="td-m">${h.code}</td><td style="font-weight:600">${h.name}</td></tr>`).join('')}
      </tbody></table></div>`;
  } else if(tab==='ng'){
    const ngR=getNgReasons(mDiv);
    body=`<div class="tbl-wrap"><table>
      <thead><tr><th>ID</th><th>NG理由</th></tr></thead>
      <tbody>${ngR.map(r=>`<tr><td class="td-m">${r.id}</td><td style="font-weight:600">${r.name}</td></tr>`).join('')}
      </tbody></table></div>`;
  } else if(tab==='kpi'){
    const targets=mDiv==='hp'?STATE.hpKpiTargets:STATE.bpKpiTargets;
    body=`<div class="alert info">ℹ️ 月別の売上・粗利・件数目標（千円単位）を設定します。</div>
    <div class="card" style="margin-bottom:14px">
      <div class="tbl-wrap"><table>
        <thead><tr><th>月</th><th>売上目標（千円）</th><th>粗利目標（千円）</th><th>件数目標</th></tr></thead>
        <tbody>${(targets||[]).map((r,idx)=>`<tr>
          <td class="td-m">${r.month}</td>
          <td><input type="number" class="fi" data-kpi-sales="${idx}" value="${r.salesTarget}" style="max-width:180px"></td>
          <td><input type="number" class="fi" data-kpi-profit="${idx}" value="${r.profitTarget}" style="max-width:180px"></td>
          <td><input type="number" class="fi" data-kpi-count="${idx}" value="${r.countTarget}" style="max-width:120px"></td>
        </tr>`).join('')}
        </tbody></table></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button class="btn btn-n" id="kpi-reset-btn">初期値に戻す</button>
        <button class="btn btn-p" id="kpi-save-btn">KPI目標を保存</button>
      </div>
    </div>`;
  } else if(tab==='upstreams'){
    body=`<div class="alert info">ℹ️ 元受け名と表示色はBP・HP両事業で共通です。</div>
    <div class="card" style="margin-bottom:14px">
      <div class="tbl-wrap"><table>
        <thead><tr><th>No.</th><th>元受け名</th><th>色</th><th>プレビュー</th></tr></thead>
        <tbody>${(STATE.upstreams||[]).map((up,idx)=>`<tr>
          <td class="td-m">${String(idx+1).padStart(2,'0')}</td>
          <td><input class="fi" data-upstream-input="${idx}" value="${typeof up==='string'?up:up.name}" style="max-width:240px"></td>
          <td><input type="color" class="fi" data-upstream-color="${idx}" value="${(typeof up==='string'?'#1d4ed8':up.color)||'#1d4ed8'}" style="width:72px;padding:4px"></td>
          <td><span class="up-badge" style="background:${(typeof up==='string'?'#1d4ed8':up.color)||'#1d4ed8'}">${typeof up==='string'?up:up.name}</span></td>
        </tr>`).join('')}
        <tr><td class="td-m">+</td>
          <td><input class="fi" id="upstream-new" placeholder="新しい元受け" style="max-width:240px"></td>
          <td><input type="color" class="fi" id="upstream-new-color" value="#1d4ed8" style="width:72px;padding:4px"></td>
          <td></td></tr>
        </tbody></table></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button class="btn btn-n" id="upstream-reset-btn">初期値に戻す</button>
        <button class="btn btn-p" id="upstream-save-btn">元受けマスタを保存</button>
      </div>
    </div>`;
  } else {
    body=`<div class="alert info">ℹ️ ロール変更は管理者と工場長のみ可能です。</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>氏名</th><th>メール</th><th>区分</th><th>ロール</th><th>状態</th></tr></thead>
      <tbody>${getUsers().map((u,idx)=>`<tr>
        <td style="font-weight:600">${u.name}</td>
        <td style="font-family:var(--mono);font-size:12px">${u.email}</td>
        <td>${divTag(u.div==='all'?'bp':u.div)} ${u.div==='all'?'全事業':u.div==='hp'?'HP':'BP'}</td>
        <td>
          <select class="fi" data-user-role="${idx}" style="max-width:150px">
            ${['admin','manager','front','worker','inspector','parts','process','driver','readonly'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${ROLE_LABELS[r]}</option>`).join('')}
          </select>
        </td>
        <td style="color:var(--grn)">✓ 有効</td></tr>`).join('')}
      </tbody></table></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button class="btn btn-p" id="user-save-btn">ユーザー権限を保存</button>
      </div>`;
  }

  return`${divSwitch}<div style="display:flex;gap:0;border-bottom:1px solid var(--bdr);margin-bottom:15px">${th}</div>${body}`;
}

// ============================================================
// MODALS
// ============================================================
function modalHTML(){
  const {modal}=STATE;
  if(!modal)return'';
  if(modal==='task')return mTask();
  if(modal==='jobDetail')return mJobDetail();
  if(modal==='newJob')return mNewJob();
  if(modal==='conflict')return mConflict();
  if(modal==='qr')return mQR();
  if(modal==='csvExport')return mCsvExport();
  if(modal==='checkin')return mCheckin();
  if(modal==='todayWork')return mTodayWork();
  if(modal==='delayAlert')return mDelayAlert();
  if(modal==='versionHistory')return mVersionHistory();
  return'';
}

// ── QR ──────────────────────────────────────────
function mQR(){
  const scanned=STATE.qrScanned;
  const camErr=STATE.qrCameraError;
  return`<div class="mbk" id="mbk">
  <div class="mo" style="max-width:520px">
    <div class="mo-hdr">
      <div>
        <div class="mo-ttl">📷 車検証QRコード読取</div>
        <div style="font-size:12px;color:var(--txt2);margin-top:2px">車検証のQRコードをカメラでスキャンして車両情報を自動入力</div>
      </div>
      <button class="mo-x" id="mc-x">×</button>
    </div>
    <div class="mo-body">
      ${!scanned?`
        ${camErr?`
          <div class="alert danger" style="margin-bottom:12px">
            ⚠️ カメラを起動できませんでした<br>
            <span style="font-size:11px">${camErr}</span>
          </div>
        `:`
          <div class="qr-camera-wrap" id="qr-camera-wrap">
            <video id="qr-video" autoplay playsinline muted style="width:100%;max-height:280px;border-radius:10px;display:block;object-fit:cover;background:#000"></video>
            <canvas id="qr-canvas" style="display:none"></canvas>
            <div class="qr-overlay">
              <div class="qr-frame-live">
                <div class="qr-corner tl"></div><div class="qr-corner tr"></div>
                <div class="qr-corner bl"></div><div class="qr-corner br"></div>
                <div class="qr-scan-line"></div>
              </div>
              <div class="qr-live-lbl" id="qr-status-lbl">🔍 QRコードを枠内に合わせてください</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px">
            <span style="font-size:11px;color:var(--txt3)">▼ テスト用サンプル（実機カメラが使えない場合）</span>
            <button id="qr-cam-stop" style="font-size:11px;padding:3px 8px;border:1px solid var(--bdr);border-radius:6px;background:#fff;cursor:pointer;color:var(--txt2)">カメラを停止</button>
          </div>
        `}
        <div class="scan-demo-btns" id="qr-demo-btns">
          ${QR_DEMO_VEHICLES.map((v,i)=>`<button class="scan-demo-btn" data-qr-idx="${i}">
            <div class="scan-demo-lbl">📋 ${v.plate}</div>
            <div class="scan-demo-sub">${v.maker} ${v.model} (${v.year}) — ${v.owner}</div>
          </button>`).join('')}
        </div>
      `:`
        <div class="qr-result">
          <div class="qr-result-t">✅ QRコード読取成功</div>
          <div class="qr-field">
            <span class="qr-key">ナンバー</span><span class="qr-val">${scanned.plate}</span>
            <span class="qr-key">メーカー</span><span class="qr-val">${scanned.maker}</span>
            <span class="qr-key">車種</span><span class="qr-val">${scanned.model}</span>
            <span class="qr-key">年式</span><span class="qr-val">${scanned.year}年</span>
            <span class="qr-key">車台番号</span><span class="qr-val" style="font-family:var(--mono);font-size:11.5px">${scanned.vin}</span>
            <span class="qr-key">所有者</span><span class="qr-val">${scanned.owner}</span>
            <span class="qr-key">色</span><span class="qr-val">${scanned.color}</span>
          </div>
        </div>
        <div class="alert success">✅ 上記の情報で受付フォームに自動入力されます</div>
      `}
    </div>
    <div class="mo-ft">
      <button class="btn btn-n" id="mc-x2">閉じる</button>
      ${scanned?`<button class="btn btn-p" id="qr-to-job">この車両で受付 →</button>`:''}
      ${scanned?`<button class="btn btn-n" id="qr-rescan" style="margin-right:auto;order:-1">↺ 再スキャン</button>`:''}
    </div>
  </div></div>`;
}

// ── TASK MODAL ──────────────────────────────────────────
function mTask(){
  const {selectedJob:j,selectedTask:t,user}=STATE;
  if(!j||!t)return'';
  const stage=STAGES.find(s=>s.id===t.stageId);
  const isInsp=stage?.code==='inspection'||stage?.code==='shaken_insp';
  const isQualityCheck=stage?.code==='quality_check';
  const ngReasons=getNgReasons(j.div);
  const dsc=`<div class="dsc">
    <button class="ds" data-dsc="${isoDate(today)}">今日</button>
    <button class="ds" data-dsc="${addD(today,1)}">明日</button>
    <button class="ds" data-dsc="${addD(today,2)}">明後日</button>
    <button class="ds" data-dsc="${nextMon()}">来週月曜</button>
  </div>`;
  const stBtns=['pending','ready','in_progress','completed','hold'].map(s=>
    `<button class="st-btn ${s} ${t.status===s?'sel':''}" data-sst="${s}">${ST_LABELS[s]}</button>`).join('');
  const hrOpts=HOLD_REASONS.map(h=>`<option value="${h.id}" ${t.holdReasonId===h.id?'selected':''}>${h.name}</option>`).join('');
  const assOpts=['<option value="">未割当</option>',...getUsersForDiv(j.div).filter(u=>u.role!=='readonly').map(u=>`<option value="${u.id}" ${t.assigneeId===u.id?'selected':''}>${u.name}（${ROLE_LABELS[u.role]}）</option>`)].join('');
  const ngOpts=ngReasons.map(r=>`<option value="${r.id}" ${t.ngReasonId===r.id?'selected':''}>${r.name}</option>`).join('');
  return`<div class="mbk" id="mbk">
  <div class="mo">
    <div class="mo-hdr">
      <div>
        <div class="mo-ttl">${divTag(j.div)} 工程更新：${stage?.name||'—'}</div>
        <div style="font-size:12px;color:var(--txt2);margin-top:2px">${j.jobNumber} ${j.customerName} / ${j.vehicleName.split('　')[0]}</div>
        ${t.reworkCount>0?`<span class="bx bx-r" style="display:inline-block;margin-top:4px">差戻 ${t.reworkCount}回</span>`:''}
      </div>
      <button class="mo-x" id="mc-x">×</button>
    </div>
    <div class="mo-body">
      <div id="mo-err"></div>
      <div class="fg">
        <div class="flbl">ステータス変更</div>
        <div class="st-grp">${stBtns}</div>
      </div>
      <div id="hold-block" style="display:${t.status==='hold'?'block':'none'}">
        <div class="fg">
          <label class="flbl">⚠️ 保留理由 ★必須</label>
          <select class="fi" id="hr-sel"><option value="">選択してください</option>${hrOpts}</select>
        </div>
      </div>
      ${(isInsp||isQualityCheck)?`<div style="background:rgba(26,86,219,.05);border:1px solid rgba(26,86,219,.15);border-radius:var(--r10);padding:13px;margin-bottom:13px">
        <div style="font-size:12px;font-weight:700;color:var(--acc2);margin-bottom:9px">🔍 ${isInsp?'検査判定':'できばえ確認'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
          <button class="btn btn-lg" id="insp-ok" style="border:2px solid var(--grn);background:rgba(4,120,87,.08);color:var(--grn)">✅ OK（合格）</button>
          <button class="btn btn-lg" id="insp-ng" style="border:2px solid var(--red);background:rgba(185,28,28,.08);color:var(--red)">❌ NG（不合格）</button>
        </div>
        <div id="ng-block" style="display:none;margin-top:10px">
          <label class="flbl">NG理由 ★必須</label>
          <select class="fi" id="ng-sel"><option value="">選択してください</option>${ngOpts}</select>
        </div>
      </div>`:''}
      <div class="fg">
        <label class="flbl">完了予定日（ETA）</label>
        <input type="date" class="fi" id="eta-in" value="${t.finishEta||''}">
        ${dsc}
      </div>
      <div class="fg">
        <label class="flbl">担当者</label>
        <select class="fi" id="ass-sel">${assOpts}</select>
      </div>
      <details style="margin-top:8px">
        <summary style="cursor:pointer;font-size:12px;color:var(--txt3);padding:6px 0;border-top:1px solid var(--bdr)">▼ 詳細入力（実績工数・メモ）</summary>
        <div style="padding-top:10px">
          <div class="fg"><label class="flbl">実績工数（時間）</label>
            <input type="number" class="fi" id="act-h" value="${t.actualHours||''}" step="0.5" min="0"></div>
          <div class="fg" style="margin-bottom:0"><label class="flbl">作業メモ</label>
            <textarea class="fi" id="t-note">${t.note||''}</textarea></div>
        </div>
      </details>
    </div>
    <div class="mo-ft">
      <button class="btn btn-n" id="mc-x2">キャンセル</button>
      <button class="btn btn-p" id="t-save">保存する</button>
    </div>
  </div>
</div>`;
}

// ── JOB DETAIL ──────────────────────────────────────────
function mJobDetail(){
  const {selectedJob:j,user}=STATE;if(!j)return'';
  const sm=canSeeMoney(user);const tab=STATE.jobDetailTab||'flow';
  const canEditThis=canEditFinance(user,j);
  const canEditJobThis=canEditJob(user,j);
  const flowRows=j.tasks.map((t,i)=>{
    const st=STAGES.find(s=>s.id===t.stageId);
    const ass=t.assigneeId?getUserById(t.assigneeId):null;
    const hr=t.holdReasonId?HOLD_REASONS.find(h=>h.id===t.holdReasonId):null;
    const isDone=t.status==='completed';const isCur=['in_progress','hold'].includes(t.status);
    const editable=canEdit(user,t,j);
    return`<div class="sf-row ${isCur?'cur':''} ${isDone?'done':''} ${t.status==='hold'?'hld':''} ${editable?'':'no-edit'}"
      ${editable?`data-otask="${j.id}__${t.id}"`:''}>
      <div class="sf-num ${isDone?'d':isCur?'c':t.status==='hold'?'h':'p'}">${isDone?'✓':i+1}</div>
      <div class="sf-nm">${st?.name||'—'}${hr?`<span style="margin-left:6px;font-size:10px;color:var(--ylw)">⚠️ ${hr.name}</span>`:''}
        ${t.reworkCount>0?`<span style="margin-left:6px;font-size:10px;color:var(--red)">差戻${t.reworkCount}回</span>`:''}</div>
      <div class="sf-sub">${ass?ass.name.split(' ')[1]||ass.name:'—'}</div>
      <div class="sf-sub">${fmtD(t.finishEta)}</div>
      <div><span style="font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:3px;background:${ST_COLORS[t.status]}18;color:${ST_COLORS[t.status]}">${ST_LABELS[t.status]}</span></div>
      ${editable?'<span style="font-size:11px;color:var(--txt3)">✏️</span>':''}
    </div>`;}).join('');

  const p=getProfit(j);
  return`<div class="mbk" id="mbk">
  <div class="mo">
    <div class="mo-hdr">
      <div>
        <div class="mo-ttl">${divTag(j.div)} ${j.jobNumber} — ${j.customerName}${j.subType?` <span style="font-size:12px;color:var(--txt3)">${subTypeLabel(j.subType)}</span>`:''}</div>
        <div style="font-size:12px;color:var(--txt2);margin-top:2px">${j.vehicleName?`🚗 ${j.vehicleName}`:'🚗 <span style="color:var(--txt3)">車両未確定</span>'}</div>
        ${j.status==='reserved'?`<span style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:4px 10px;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.3);border-radius:6px;font-size:11px;color:#7c3aed;font-weight:700">📅 予約済 — 入庫時に「受付する」を押してください</span>`:''}
      </div>
      <div style="display:flex;align-items:flex-start;gap:8px">
        ${j.status==='reserved'?`<button class="btn btn-p" id="job-checkin-btn" style="background:#7c3aed;border-color:#7c3aed;white-space:nowrap">🚗 受付する</button>`:''}
        <button class="mo-x" id="mc-x">×</button>
      </div>
    </div>
    <div class="tabs">
      <button class="tab ${tab==='flow'?'on':''}" data-jdtab="flow">工程</button>
      <button class="tab ${tab==='info'?'on':''}" data-jdtab="info">基本情報</button>
      ${sm?`<button class="tab ${tab==='fin'?'on':''}" data-jdtab="fin">収益</button>`:''}
    </div>
    <div class="mo-body">
      <div id="mo-err"></div>
      ${tab==='flow'?`<div class="sf">${flowRows}</div>`:''}
      ${tab==='info'?`
        <div class="pr-row"><span class="pr-lbl">区分</span><span>${divTag(j.div)} ${j.div==='hp'?'HP事業（一般整備）':'BP事業（板金）'}</span></div>
        ${j.subType?`<div class="pr-row"><span class="pr-lbl">種別</span><span>${subTypeLabel(j.subType)}</span></div>`:''}
        <div class="pr-row"><span class="pr-lbl">案件番号</span><span class="pr-val">${j.jobNumber}</span></div>
        <div class="pr-row"><span class="pr-lbl">顧客</span><span style="font-weight:600">${j.customerName}</span></div>
        <div class="pr-row"><span class="pr-lbl">元受け</span><span>${upstreamBadge(j.upstream||'自受け')}</span></div>
        ${vehicleDetailHTML(j)}
        <div class="pr-row"><span class="pr-lbl">優先度</span><span>${PRI_LABELS[j.priority]}</span></div>
        <div class="pr-row"><span class="pr-lbl">入庫日</span><span>${fmtD(j.entryDate)}</span></div>
        <div class="pr-row"><span class="pr-lbl">約束納車日</span><span>${fmtD(j.promisedDelivery)}</span></div>
        <div class="pr-row"><span class="pr-lbl">清算予定日</span><span>${fmtD(j.settlementDate)}</span></div>
        <div class="pr-row"><span class="pr-lbl">備考</span><span>${j.note||'—'}</span></div>
        ${canEditJobThis?`
        <hr style="border:none;border-top:1px solid var(--bdr);margin:12px 0">
        <div class="fg"><label class="flbl">顧客名</label><input class="fi" id="ji-customer" value="${j.customerName||''}"></div>
        <div class="fg"><label class="flbl">元受け</label><select class="fi" id="ji-upstream">${getUpstreamOptions().map(v=>`<option value="${v}" ${v===(j.upstream||'自受け')?'selected':''}>${v}</option>`).join('')}</select></div>
        <div class="fg">
          <label class="flbl">車両
            <button id="ji-qr-btn" style="margin-left:10px;font-size:10px;padding:2px 8px;border:1px solid #bfdbfe;border-radius:6px;background:#eff6ff;color:var(--acc2);cursor:pointer;font-weight:700">📷 QRで補充</button>
          </label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
            <div>
              <label style="font-size:10px;color:var(--txt3);display:block;margin-bottom:3px">メーカー</label>
              <select class="fi" id="ji-vm" style="width:100%">
                <option value="">-- 選択 --</option>${VEHICLE_MAKERS.map(m=>`<option value="${m.name}"${m.name===j.vehicleMaker?' selected':''}>${m.name}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:10px;color:var(--txt3);display:block;margin-bottom:3px">車種</label>
              <input class="fi" id="ji-vmod" list="ji-vmod-list" value="${j.vehicleModel||''}" placeholder="プリウス" style="width:100%">
              <datalist id="ji-vmod-list">${(()=>{const makerId=VEHICLE_MAKERS.find(m=>m.name===j.vehicleMaker)?.id;return makerId?VEHICLE_MODELS.filter(m=>m.maker_id===makerId).map(m=>`<option value="${m.name}">`).join(''):''})()}</datalist>
            </div>
          </div>
          <div>
            <label style="font-size:10px;color:var(--txt3);display:block;margin-bottom:3px">登録番号</label>
            <input class="fi" id="ji-vp" value="${j.vehiclePlate||''}" placeholder="品川 530 す 1234" style="width:100%">
          </div>
          <input type="hidden" id="ji-vehicle" value="${j.vehicleName||''}"></div>
        <div class="fg"><label class="flbl">優先度</label><select class="fi" id="ji-priority">${Object.entries(PRI_LABELS).map(([k,v])=>`<option value="${k}" ${j.priority===k?'selected':''}>${v}</option>`).join('')}</select></div>
        <div class="fg"><label class="flbl">約束納車日</label><input type="date" class="fi" id="ji-promised" value="${j.promisedDelivery||''}"></div>
        <div class="fg"><label class="flbl">社内締切</label><input type="date" class="fi" id="ji-deadline" value="${j.internalDeadline||''}"></div>
        <div class="fg"><label class="flbl">担当フロント</label><select class="fi" id="ji-front">${getUsersForDiv(j.div).filter(u=>['admin','manager','front'].includes(u.role)).map(u=>`<option value="${u.id}" ${j.frontOwnerId===u.id?'selected':''}>${u.name}</option>`).join('')}</select></div>
        <div class="fg"><label class="flbl">備考</label><textarea class="fi" id="ji-note">${j.note||''}</textarea></div>
        <div style="display:flex;justify-content:flex-end"><button class="btn btn-p" id="ji-save">案件情報を保存</button></div>`:''}
      `:''}
      ${tab==='fin'&&sm?`
        <div class="pr-row"><span class="pr-lbl">見込み売上</span><span class="pr-val">${j.estimateAmount?`¥${j.estimateAmount.toLocaleString()}`:'—'}</span></div>
        <div class="pr-row"><span class="pr-lbl">見込み部品原価</span><span class="pr-val neg">${j.estimatePartsCost?`¥${j.estimatePartsCost.toLocaleString()}`:'—'}</span></div>
        <div class="pr-row"><span class="pr-lbl">見込み工賃</span><span class="pr-val neg">${j.estimateLaborCost?`¥${j.estimateLaborCost.toLocaleString()}`:'—'}</span></div>
        <div class="pr-row"><span class="pr-lbl">── 見込み粗利</span><span class="pr-val ${p>=0?'pos':'neg'}">¥${Math.abs(p).toLocaleString()}</span></div>
        <div class="pr-row"><span class="pr-lbl">粗利率</span><span class="pr-val ${p>=0?'pos':'neg'}">${j.estimateAmount?Math.round(p/j.estimateAmount*100):0}%</span></div>
        ${canEditThis?`
        <hr style="border:none;border-top:1px solid var(--bdr);margin:12px 0">
        <div class="fg"><label class="flbl">見込み売上</label><input type="number" class="fi" id="jf-sales" value="${j.estimateAmount||0}"></div>
        <div class="fg"><label class="flbl">見込み部品原価</label><input type="number" class="fi" id="jf-parts" value="${j.estimatePartsCost||0}"></div>
        <div class="fg"><label class="flbl">見込み工賃</label><input type="number" class="fi" id="jf-labor" value="${j.estimateLaborCost||0}"></div>
        <div class="fg"><label class="flbl">清算予定日</label><input type="date" class="fi" id="jf-settlement" value="${j.settlementDate||j.promisedDelivery||''}"></div>
        <div style="display:flex;justify-content:flex-end"><button class="btn btn-p" id="jf-save">収益情報を保存</button></div>`:''}
      `:''}
    </div>
    <div class="mo-ft">
      <button class="btn btn-n" id="mc-x2">閉じる</button>
    </div>
  </div>
</div>`;
}

// ── NEW JOB ──────────────────────────────────────────
function mNewJob(){
  const {user,qrScanned:qr}=STATE;
  const selDiv=STATE.newJobDiv||(user.div==='all'||user.role==='admin'?null:user.div);
  const njMode=STATE.newJobMode||'checkin';
  const defCust=qr?qr.owner:'';
  const defMaker=qr?qr.maker:'';
  const defModel=qr?qr.model:'';
  const defPlate=qr?qr.plate:'';
  const fOpts=getUsersForDiv(selDiv||'bp').filter(u=>['admin','manager','front'].includes(u.role)&&(user.role!=='front'||u.id===user.id)).map(u=>`<option value="${u.id}" ${user.id===u.id?'selected':''}>${u.name}</option>`).join('');

  if(!selDiv){
    return`<div class="mbk" id="mbk">
    <div class="mo" style="max-width:480px">
      <div class="mo-hdr"><span class="mo-ttl">＋ 受付登録</span><button class="mo-x" id="mc-x">×</button></div>
      <div class="mo-body">
        <div style="font-size:13px;font-weight:600;color:var(--txt2);margin-bottom:14px">受付する事業を選択してください</div>
        <div class="div-sel-row">
          <button class="div-sel-btn" id="sel-div-bp">
            <div class="ds-ico">🔧</div>
            <div class="ds-nm" style="color:var(--bp)">BP事業</div>
            <div class="ds-sub">板金・ボディリペア</div>
          </button>
          <button class="div-sel-btn" id="sel-div-hp">
            <div class="ds-ico">🔩</div>
            <div class="ds-nm" style="color:var(--hp)">HP事業</div>
            <div class="ds-sub">車検・定点・一般整備</div>
          </button>
        </div>
      </div>
      <div class="mo-ft"><button class="btn btn-n" id="mc-x2">キャンセル</button></div>
    </div></div>`;
  }

  const templates=getTemplatesForDiv(selDiv);
  const tmplOpts=Object.entries(templates).map(([k,v])=>`<option value="${k}">${v.name}</option>`).join('');
  const isHP=selDiv==='hp';
  const divBtnClass=isHP?'btn-hp':'btn-p';

  return`<div class="mbk" id="mbk">
  <div class="mo">
    <div class="mo-hdr">
      <span class="mo-ttl">${divTag(selDiv)} ${njMode==='reserve'?'📅 予約登録':'受付登録'}${qr?`<span class="bx bx-g" style="margin-left:8px;font-size:11px">QR読取済</span>`:''}</span>
      <button class="mo-x" id="mc-x">×</button>
    </div>
    <div class="tabs" style="margin-bottom:0">
      <button class="tab ${njMode!=='reserve'?'on':''}" id="nj-mode-checkin">🚗 受付登録（今日入庫）</button>
      <button class="tab ${njMode==='reserve'?'on':''}" id="nj-mode-reserve">📅 予約登録（後日入庫）</button>
    </div>
    <div class="mo-body">
      <div id="nj-err"></div>
      ${njMode==='reserve'?`
        <div class="alert info" style="margin-bottom:12px">ℹ️ 予約は最小限の情報で登録できます。入庫時に「受付する」ボタンからQRで詳細を補充してください。</div>
      `:''}
      ${qr&&njMode!=='reserve'?`<div class="alert success" style="margin-bottom:12px">✅ QRコードから車両情報を自動入力しました</div>`:''}
      ${customerSuggestHTML(defCust)}
      ${njMode==='reserve'?`
        <div class="fg">
          <label class="flbl">電話番号（任意）</label>
          <input class="fi" id="nj-phone" placeholder="090-0000-0000" type="tel">
        </div>
      `:vehicleInputHTML(defMaker,defModel,defPlate)}
      <div class="fg"><label class="flbl">元受け${njMode==='reserve'?' （任意）':' ★必須'}</label><select class="fi" id="nj-up">${getUpstreamOptions().map(v=>`<option value="${v}" ${v==='自受け'?'selected':''}>${v}</option>`).join('')}</select></div>
      ${njMode!=='reserve'?`<div class="fg">
        <label class="flbl">工程テンプレート</label>
        <select class="fi" id="nj-t">${tmplOpts}</select>
        <div id="tmpl-st" style="font-size:11px;color:var(--txt3);margin-top:5px"></div>
      </div>`:''}
      <div class="fg">
        <label class="flbl">優先度</label>
        <div style="display:flex;gap:7px;margin-top:4px">
          ${[['urgent','🔴 緊急'],['high','🟠 急ぎ'],['normal','⬜ 通常'],['low','🟢 余裕']].map(([v,l])=>
            `<button class="btn btn-n btn-sm nj-pri" data-pri="${v}" style="flex:1">${l}</button>`).join('')}
        </div>
        <input type="hidden" id="nj-pri" value="normal">
      </div>
      <div class="fg">
        <label class="flbl">約束納車日</label>
        <input type="date" class="fi" id="nj-d" value="${addD(today,isHP?3:7)}">
        <div class="dsc">
          <button class="ds" data-dsc3="${addD(today,isHP?2:7)}">${isHP?'2日後':'1週間後'}</button>
          <button class="ds" data-dsc3="${addD(today,isHP?7:14)}">${isHP?'1週間後':'2週間後'}</button>
          <button class="ds" data-dsc3="${addD(today,isHP?14:21)}">${isHP?'2週間後':'3週間後'}</button>
        </div>
      </div>
      <div class="fg"><label class="flbl">見積金額（円）${njMode==='reserve'?' （任意）':''}</label><input type="number" class="fi" id="nj-e" placeholder="${isHP?'50000':'150000'}"></div>
      <div class="fg"><label class="flbl">清算予定日</label><input type="date" class="fi" id="nj-sd" value="${addD(today,isHP?3:7)}"></div>
      <div class="fg"><label class="flbl">担当フロント</label><select class="fi" id="nj-f">${fOpts}</select></div>
    </div>
    <div class="mo-ft">
      <button class="btn btn-n" id="mc-x2">キャンセル</button>
      <button class="btn btn-n btn-sm" id="nj-back" style="margin-right:auto">◀ 事業選択へ戻る</button>
      <button class="btn ${divBtnClass}" id="nj-save">案件を登録する</button>
    </div>
  </div>
</div>`;
}

// ── CHECKIN（予約→受付）モーダル ──────────────────────────────────────────
function mCheckin(){
  const j=STATE.jobs.find(x=>x.id===STATE.checkinJobId);
  if(!j)return'';
  const scanned=STATE.qrScanned;
  const camErr=STATE.qrCameraError;
  const templates=getTemplatesForDiv(j.div);
  const tmplOpts=Object.entries(templates).map(([k,v])=>`<option value="${k}">${v.name}</option>`).join('');
  const isHP=j.div==='hp';
  const divBtnClass=isHP?'btn-hp':'btn-p';
  const fOpts=getUsersForDiv(j.div).filter(u=>['admin','manager','front'].includes(u.role))
    .map(u=>`<option value="${u.id}" ${j.frontOwnerId===u.id?'selected':''}>${u.name}</option>`).join('');

  // QRで上書きされた値 or 既存値をデフォルトに
  const defMaker=scanned?.maker||j.vehicleMaker||'';
  const defModel=scanned?.model||j.vehicleModel||'';
  const defPlate=scanned?.plate||j.vehiclePlate||'';
  const defCust =scanned?.owner||j.customerName||'';

  // 車種セレクトHTML
  const makerOpts=VEHICLE_MAKERS.map(m=>`<option value="${m.name}"${m.name===defMaker?' selected':''}>${m.name}</option>`).join('');

  return`<div class="mbk" id="mbk">
  <div class="mo" style="max-width:560px">
    <div class="mo-hdr">
      <div>
        <div class="mo-ttl" style="color:#7c3aed">🚗 受付する — ${j.jobNumber} ${j.customerName}</div>
        <div style="font-size:12px;color:var(--txt2);margin-top:2px">予約済案件を受付します。車検証QRで車両情報を補充できます。</div>
      </div>
      <button class="mo-x" id="mc-x">×</button>
    </div>
    <div class="mo-body">
      <div id="ci-err"></div>

      <!-- ① QRスキャンエリア -->
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:var(--txt2);margin-bottom:6px">📷 車検証QRスキャン（任意）</div>
        ${camErr?`
          <div class="alert danger" style="margin-bottom:8px">
            ⚠️ カメラ: ${camErr}
          </div>
        `:`
          ${!scanned?`
            <div class="qr-camera-wrap" id="qr-camera-wrap">
              <video id="qr-video" autoplay playsinline muted style="width:100%;max-height:200px;border-radius:10px;display:block;object-fit:cover;background:#000"></video>
              <canvas id="qr-canvas" style="display:none"></canvas>
              <div class="qr-overlay">
                <div class="qr-frame-live">
                  <div class="qr-corner tl"></div><div class="qr-corner tr"></div>
                  <div class="qr-corner bl"></div><div class="qr-corner br"></div>
                  <div class="qr-scan-line"></div>
                </div>
                <div class="qr-live-lbl" id="qr-status-lbl">🔍 車検証QRを枠内に</div>
              </div>
            </div>
            <div style="display:flex;justify-content:flex-between;align-items:center;margin:4px 0 8px;gap:8px">
              <button id="qr-cam-stop" style="font-size:11px;padding:3px 8px;border:1px solid var(--bdr);border-radius:6px;background:#fff;cursor:pointer;color:var(--txt2)">■ カメラ停止</button>
              <span style="font-size:11px;color:var(--txt3)">または下のテスト用サンプルを選択</span>
            </div>
          `:`
            <div class="alert success" style="margin-bottom:8px">
              ✅ QR読取済 — <strong>${scanned.plate}</strong> ${scanned.maker} ${scanned.model}
              <button id="qr-rescan" style="margin-left:10px;font-size:10px;padding:2px 7px;border:1px solid var(--grn);border-radius:4px;background:#fff;cursor:pointer;color:var(--grn)">再スキャン</button>
            </div>
          `}
        `}
        <!-- テスト用デモボタン（折りたたみ） -->
        <details style="font-size:11px">
          <summary style="cursor:pointer;color:var(--txt3);user-select:none">▶ テスト用サンプル</summary>
          <div class="scan-demo-btns" style="margin-top:6px">
            ${QR_DEMO_VEHICLES.map((v,i)=>`<button class="scan-demo-btn" data-qr-idx="${i}">
              <div class="scan-demo-lbl">📋 ${v.plate}</div>
              <div class="scan-demo-sub">${v.maker} ${v.model} (${v.year}) — ${v.owner}</div>
            </button>`).join('')}
          </div>
        </details>
      </div>

      <hr style="border:none;border-top:1px solid var(--bdr);margin:0 0 14px">

      <!-- ② 顧客名（QRで補充可） -->
      <div class="fg">
        <label class="flbl">顧客名</label>
        <input class="fi" id="ci-c" value="${defCust}" placeholder="山田 太郎">
      </div>

      <!-- ③ 車両情報（QRで補充可・3分割） -->
      <div class="fg" style="margin-bottom:0">
        <label class="flbl">車両情報
          ${scanned?`<span class="bx bx-g" style="margin-left:6px;font-size:10px">QR自動入力済</span>`:''}
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
          <div>
            <label style="font-size:10px;color:var(--txt3);display:block;margin-bottom:3px">メーカー</label>
            <select class="fi" id="ci-vm" style="width:100%">
              <option value="">-- 選択 --</option>${makerOpts}
            </select>
          </div>
          <div>
            <label style="font-size:10px;color:var(--txt3);display:block;margin-bottom:3px">車種</label>
            <input class="fi" id="ci-vmod" list="ci-vmod-list" value="${defModel}" placeholder="プリウス" style="width:100%">
            <datalist id="ci-vmod-list"></datalist>
          </div>
        </div>
        <div>
          <label style="font-size:10px;color:var(--txt3);display:block;margin-bottom:3px">登録番号</label>
          <input class="fi" id="ci-vp" value="${defPlate}" placeholder="品川 530 す 1234" style="width:100%">
        </div>
      </div>

      <!-- ④ 工程テンプレート（予約時に省略されていた場合） -->
      ${j.tasks.length===0?`
        <div class="fg" style="margin-top:10px">
          <label class="flbl">工程テンプレート</label>
          <select class="fi" id="ci-t">${tmplOpts}</select>
        </div>
      `:''}

      <!-- ⑤ 約束納車日・見積（既存値引き継ぎ＋上書き可） -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
        <div class="fg">
          <label class="flbl">約束納車日</label>
          <input type="date" class="fi" id="ci-d" value="${j.promisedDelivery||addD(today,isHP?3:7)}">
        </div>
        <div class="fg">
          <label class="flbl">見積金額（円）</label>
          <input type="number" class="fi" id="ci-e" value="${j.estimateAmount||''}" placeholder="${isHP?'50000':'150000'}">
        </div>
      </div>

      <!-- ⑥ 元受け -->
      <div class="fg">
        <label class="flbl">元受け</label>
        <select class="fi" id="ci-up">
          ${getUpstreamOptions().map(v=>`<option value="${v}" ${v===(j.upstream||'自受け')?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>

    </div>
    <div class="mo-ft">
      <button class="btn btn-n" id="mc-x2">キャンセル</button>
      <button class="btn ${divBtnClass}" id="ci-save" style="background:#7c3aed;border-color:#7c3aed">🚗 受付を確定する</button>
    </div>
  </div></div>`;
}

// ── CONFLICT ──────────────────────────────────────────
function mConflict(){
  const {conflictData:cd}=STATE;if(!cd)return'';
  const st=STAGES.find(s=>s.id===cd.task.stageId);
  return`<div class="mbk" id="mbk">
  <div class="mo" style="max-width:560px">
    <div class="mo-hdr">
      <span class="mo-ttl" style="color:var(--red)">⚠️ 更新競合 (HTTP 409)</span>
      <button class="mo-x" id="mc-x">×</button>
    </div>
    <div class="mo-body">
      <div class="cf-box">
        <div class="cf-ttl">🔒 楽観ロック競合を検知</div>
        <div style="font-size:12.5px;color:var(--txt2)">別端末が先に「${st?.name}」を更新しました。</div>
        <div class="cf-grid">
          <div class="cf-col"><div class="cf-cl">サーバー現在値</div>
            <div style="font-weight:700;color:var(--grn)">${ST_LABELS[cd.task.status]}</div>
          </div>
          <div class="cf-col"><div class="cf-cl">あなたの変更</div>
            <div style="font-weight:700;color:var(--ylw)">${ST_LABELS[cd.attempted.status||cd.task.status]}</div>
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-n" id="cf-reload">🔄 再読み込みして最新を確認<span style="margin-left:auto;font-size:11px;color:var(--grn)">推奨</span></button>
        <button class="btn btn-y" id="cf-force">⚡ 自分の変更で上書き保存<span style="margin-left:auto;font-size:11px;color:var(--red)">要注意</span></button>
        <button class="btn btn-n" id="cf-cancel">✖ キャンセル</button>
      </div>
    </div>
  </div>
</div>`;
}

// ============================================================
// BIND ALL
// ============================================================
function bindAll(){
  const close=()=>setState({modal:null,selectedJob:null,selectedTask:null,conflictData:null,jobDetailTab:'flow'});

  document.getElementById('sb-toggle')?.addEventListener('click',()=>setState({sidebarOpen:!STATE.sidebarOpen}));
  document.getElementById('sb-backdrop')?.addEventListener('click',()=>setState({sidebarOpen:false}));
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setState({view:b.dataset.view,listFilter:'all',masterTab:'stages',sidebarOpen:isCompactViewport()?false:STATE.sidebarOpen})));
  window.onresize=()=>{if(!isCompactViewport()&&STATE.sidebarOpen)setState({sidebarOpen:false});};
  document.getElementById('logout')?.addEventListener('click',()=>setState({user:null,view:'myview',sidebarOpen:false}));

  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-kbmode]');
    if(!btn)return;
    const mode=btn.dataset.kbmode;
    if(mode==='scroll'||mode==='fit'){
      e.preventDefault();
      if(STATE.kanbanMode!==mode)setState({kanbanMode:mode});
    }
  });

  const openQR=()=>setState({modal:'qr',qrScanned:null});
  document.getElementById('qr-btn')?.addEventListener('click',openQR);
  document.getElementById('qr-btn-cust')?.addEventListener('click',openQR);

  document.querySelectorAll('[data-ojob]').forEach(el=>el.addEventListener('click',()=>{
    const j=STATE.jobs.find(j=>j.id===el.dataset.ojob);
    if(j)setState({selectedJob:j,modal:'jobDetail',jobDetailTab:'flow'});
  }));
  document.querySelectorAll('[data-otask]').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const [jid,tid]=el.dataset.otask.split('__');
    const j=STATE.jobs.find(j=>j.id===jid);const t=j?.tasks.find(t=>t.id===tid);
    if(j&&t)setState({selectedJob:j,selectedTask:t,modal:'task'});
  }));
  document.querySelectorAll('[data-qdone]').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const [jid,tid]=el.dataset.qdone.split('__');
    const j=STATE.jobs.find(j=>j.id===jid);const t=j?.tasks.find(t=>t.id===tid);
    if(!j||!t)return;
    updateTask(jid,tid,{status:'completed',completedAt:new Date().toISOString()},t.version)
      .then(ok=>{ if(ok)showToast('工程を完了しました'); });
  }));
  document.querySelectorAll('[data-qhold]').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const [jid,tid]=el.dataset.qhold.split('__');
    const j=STATE.jobs.find(j=>j.id===jid);const t=j?.tasks.find(t=>t.id===tid);
    if(j&&t)setState({selectedJob:j,selectedTask:t,modal:'task'});
  }));

  document.querySelectorAll('[data-fl]').forEach(b=>b.addEventListener('click',()=>setState({listFilter:b.dataset.fl})));
  document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>setState({listPeriod:b.dataset.period})));
  document.querySelectorAll('[data-dash-period]').forEach(b=>b.addEventListener('click',()=>setState({dashboardPeriod:b.dataset.dashPeriod})));
  document.querySelectorAll('[data-listdiv]').forEach(b=>b.addEventListener('click',()=>setState({listDiv:b.dataset.listdiv})));
  document.getElementById('list-upstream')?.addEventListener('change',e=>setState({listUpstream:e.target.value}));
  document.getElementById('list-sort')?.addEventListener('change',e=>setState({listSort:e.target.value}));
  document.getElementById('list-date-from')?.addEventListener('change',e=>setState({listPeriod:'custom',listDateFrom:e.target.value}));
  document.getElementById('list-date-to')?.addEventListener('change',e=>setState({listPeriod:'custom',listDateTo:e.target.value}));

  document.getElementById('new-job-btn')?.addEventListener('click',()=>{
    const canAuto=STATE.user?.div!=='all'&&STATE.user?.role!=='admin';
    setState({modal:'newJob',newJobDiv:canAuto?STATE.user.div:null});
  });

  document.querySelectorAll('[data-mtab]').forEach(b=>b.addEventListener('click',()=>setState({masterTab:b.dataset.mtab})));
  document.querySelectorAll('[data-mdiv]').forEach(b=>b.addEventListener('click',()=>setState({masterDiv:b.dataset.mdiv,masterTab:'stages'})));

  // WIP
  document.getElementById('wip-save-btn')?.addEventListener('click',()=>{
    const next={...getWipLimits(STATE.masterDiv)};
    let hasError=false;
    document.querySelectorAll('[data-wip-input]').forEach(input=>{
      const val=parseInt(input.value,10);
      if(Number.isNaN(val)||val<1){input.style.borderColor='var(--red)';hasError=true;return;}
      input.style.borderColor='';next[input.dataset.wipInput]=val;
    });
    if(hasError){showToast('WIP上限は1以上の整数で入力してください','e');return;}
    saveWipLimits(STATE.masterDiv,next).then(()=>showToast('WIP上限を更新しました'));
  });
  document.getElementById('wip-reset-btn')?.addEventListener('click',()=>{
    const patch=STATE.masterDiv==='hp'?{hpWipLimits:{...DEFAULT_HP_WIP}}:{bpWipLimits:{...DEFAULT_BP_WIP}};
    setState({...patch,masterTab:'wip'});
    showToast('WIP上限を初期値に戻しました','i');
  });

  // KPI
  document.getElementById('kpi-save-btn')?.addEventListener('click',()=>{
    const targets=STATE.masterDiv==='hp'?STATE.hpKpiTargets:STATE.bpKpiTargets;
    const next=(targets||[]).map((row,idx)=>({
      ...row,
      salesTarget:parseInt(document.querySelector(`[data-kpi-sales="${idx}"]`)?.value||0,10)||0,
      profitTarget:parseInt(document.querySelector(`[data-kpi-profit="${idx}"]`)?.value||0,10)||0,
      countTarget:parseInt(document.querySelector(`[data-kpi-count="${idx}"]`)?.value||0,10)||0,
    }));
    saveKpiTargets(STATE.masterDiv,next).then(()=>showToast('KPI目標を更新しました'));
  });
  document.getElementById('kpi-reset-btn')?.addEventListener('click',()=>{
    const patch=STATE.masterDiv==='hp'
      ?{hpKpiTargets:buildDefaultKpiTargets('hp')}
      :{bpKpiTargets:buildDefaultKpiTargets('bp')};
    setState({...patch,masterTab:'kpi'});
    showToast('KPI目標を初期値に戻しました','i');
  });

  // Upstream
  document.getElementById('upstream-save-btn')?.addEventListener('click',()=>{
    const vals=[...document.querySelectorAll('[data-upstream-input]')].map((i,idx)=>({
      name:i.value.trim(),color:document.querySelector(`[data-upstream-color="${idx}"]`)?.value||'#1d4ed8'
    })).filter(v=>v.name);
    const extra=document.getElementById('upstream-new')?.value.trim();
    const extraColor=document.getElementById('upstream-new-color')?.value||'#1d4ed8';
    if(extra)vals.push({name:extra,color:extraColor});
    const seen=new Set();
    const unique=vals.filter(v=>{if(seen.has(v.name))return false;seen.add(v.name);return true;});
    if(unique.length===0){showToast('元受けを1件以上入力してください','e');return;}
    saveUpstreams(unique).then(()=>showToast('元受けマスタを更新しました（次回起動まで有効）','i'));
  });
  document.getElementById('upstream-reset-btn')?.addEventListener('click',()=>{
    setState({upstreams:JSON.parse(JSON.stringify(DEFAULT_UPSTREAMS)),masterTab:'upstreams'});
    showToast('元受けマスタを初期値に戻しました','i');
  });

  // Users
  document.getElementById('user-save-btn')?.addEventListener('click',()=>{
    if(!['admin','manager'].includes(STATE.user?.role)){showToast('ユーザー権限を変更できません','e');return;}
    const next=getUsers().map((u,idx)=>({...u,role:document.querySelector(`[data-user-role="${idx}"]`)?.value||u.role}));
    const current=STATE.user?next.find(u=>u.id===STATE.user.id):null;
    Promise.all(next.map(u=>API.put(`/api/users/${u.id}`,{role:u.role}))).then(()=>{
      showToast('ユーザー権限を更新しました');
    }).catch(e=>showToast('更新失敗: '+e.message,'e'));
    setState({users:next,user:current||STATE.user,masterTab:'users'});
  });

  // MODAL CLOSE
  document.getElementById('mc-x')?.addEventListener('click',close);
  document.getElementById('mc-x2')?.addEventListener('click',close);
  document.getElementById('mbk')?.addEventListener('click',e=>{if(e.target.id==='mbk')close();});

  // QR MODAL
  if(STATE.modal==='qr'){
    // デモボタン
    document.querySelectorAll('[data-qr-idx]').forEach(b=>b.addEventListener('click',()=>{
      const v=QR_DEMO_VEHICLES[parseInt(b.dataset.qrIdx)];
      stopQRCamera();
      setState({qrScanned:v,modal:'qr',qrCameraError:null});
      showToast(`${v.plate} を読み取りました`,'i');
    }));
    document.getElementById('qr-to-job')?.addEventListener('click',()=>{
      stopQRCamera();
      if(STATE._jiQrReturn&&STATE.selectedJob){
        // infoタブからQR補充で飛んできた場合 → jobDetailに戻ってフィールドに反映
        const qr=STATE.qrScanned;
        const j=STATE.selectedJob;
        setState({modal:'jobDetail',selectedJob:j,jobDetailTab:'info',_jiQrReturn:false});
        // フィールドに遅延反映
        requestAnimationFrame(()=>{
          const makerSel=document.getElementById('ji-vm');
          const modelInput=document.getElementById('ji-vmod');
          const plateInput=document.getElementById('ji-vp');
          if(qr&&makerSel) makerSel.value=qr.maker||'';
          if(qr&&modelInput) modelInput.value=qr.model||'';
          if(qr&&plateInput) plateInput.value=qr.plate||'';
          if(qr&&makerSel){
            const makerId=VEHICLE_MAKERS.find(m=>m.name===makerSel.value)?.id;
            const models=makerId?VEHICLE_MODELS.filter(m=>m.maker_id===makerId):[];
            const dl=document.getElementById('ji-vmod-list');
            if(dl)dl.innerHTML=models.map(m=>`<option value="${m.name}">`).join('');
          }
          if(qr) showToast('QRコードから車両情報を補充しました。「案件情報を保存」で確定してください。','i');
        });
        return;
      }
      const u=STATE.user;
      const div=u.div==='all'||u.role==='admin'?null:u.div;
      setState({modal:'newJob',newJobDiv:div});
    });
    document.getElementById('qr-rescan')?.addEventListener('click',()=>{
      stopQRCamera();
      setState({qrScanned:null,modal:'qr',qrCameraError:null});
    });
    document.getElementById('qr-cam-stop')?.addEventListener('click',()=>{
      stopQRCamera();
      setState({qrCameraError:'カメラを手動停止しました。下のサンプルからお選びください。'});
    });
    // カメラ起動（エラーがない場合のみ）
    if(!STATE.qrCameraError&&!STATE.qrScanned){
      startQRCamera();
    }
  }

  // DIV SELECT (new job pre-screen)
  document.getElementById('sel-div-bp')?.addEventListener('click',()=>setState({modal:'newJob',newJobDiv:'bp'}));
  document.getElementById('sel-div-hp')?.addEventListener('click',()=>setState({modal:'newJob',newJobDiv:'hp'}));
  document.getElementById('nj-back')?.addEventListener('click',()=>setState({modal:'newJob',newJobDiv:null}));

  // TASK MODAL
  if(STATE.modal==='task'){
    const j=STATE.selectedJob,t=STATE.selectedTask;
    if(!j||!t)return;
    let curSt=t.status;
    const hl=()=>{
      document.querySelectorAll('.st-btn').forEach(b=>b.classList.toggle('sel',b.dataset.sst===curSt));
      const hb=document.getElementById('hold-block');
      if(hb)hb.style.display=curSt==='hold'?'block':'none';
    };
    hl();
    document.querySelectorAll('[data-sst]').forEach(b=>b.addEventListener('click',()=>{curSt=b.dataset.sst;hl();}));
    document.querySelectorAll('[data-dsc]').forEach(b=>b.addEventListener('click',()=>{const i=document.getElementById('eta-in');if(i)i.value=b.dataset.dsc;}));
    document.getElementById('insp-ok')?.addEventListener('click',()=>{curSt='completed';hl();document.getElementById('ng-block').style.display='none';});
    document.getElementById('insp-ng')?.addEventListener('click',()=>{curSt='hold';hl();document.getElementById('ng-block').style.display='block';});
    document.getElementById('t-save')?.addEventListener('click',()=>{
      const err=document.getElementById('mo-err');
      if(curSt==='hold'&&!document.getElementById('hr-sel').value){
        err.innerHTML='<div class="alert danger">⚠️ 保留理由を選択してください</div>';return;
      }
      const stage=STAGES.find(s=>s.id===t.stageId);
      if((stage?.code==='inspection'||stage?.code==='shaken_insp'||stage?.code==='quality_check')&&curSt==='hold'&&!document.getElementById('ng-sel')?.value){
        err.innerHTML='<div class="alert danger">⚠️ NG理由を選択してください</div>';return;
      }
      const changes={
        status:curSt,
        holdReasonId:curSt==='hold'?(document.getElementById('hr-sel')?.value||null):null,
        assigneeId:document.getElementById('ass-sel')?.value||null,
        finishEta:document.getElementById('eta-in')?.value||null,
        actualHours:parseFloat(document.getElementById('act-h')?.value)||null,
        note:document.getElementById('t-note')?.value||'',
        ngReasonId:document.getElementById('ng-sel')?.value||null,
        completedAt:curSt==='completed'?new Date().toISOString():null,
      };
      if(!canEdit(STATE.user,t,j)){err.innerHTML='<div class="alert danger">⚠️ この工程を変更する権限がありません</div>';return;}
      updateTask(j.id,t.id,changes,t.version).then(ok=>{
        if(ok){setState({modal:null,selectedJob:null,selectedTask:null});showToast('工程を更新しました');}
      });
    });
  }

  // JOB DETAIL TABS
  if(STATE.modal==='jobDetail'){
    document.querySelectorAll('[data-jdtab]').forEach(b=>b.addEventListener('click',()=>setState({jobDetailTab:b.dataset.jdtab,selectedJob:STATE.selectedJob})));
    document.querySelectorAll('[data-otask]').forEach(el=>el.addEventListener('click',e=>{
      e.stopPropagation();
      const [jid,tid]=el.dataset.otask.split('__');
      const j2=STATE.jobs.find(j=>j.id===jid);const t2=j2?.tasks.find(t=>t.id===tid);
      if(j2&&t2)setState({selectedJob:j2,selectedTask:t2,modal:'task'});
    }));
    document.getElementById('jf-save')?.addEventListener('click',()=>{
      const j2=STATE.selectedJob;if(!j2)return;
      updateJob(j2.id,{
        estimateAmount:parseInt(document.getElementById('jf-sales')?.value||0,10)||0,
        estimatePartsCost:parseInt(document.getElementById('jf-parts')?.value||0,10)||0,
        estimateLaborCost:parseInt(document.getElementById('jf-labor')?.value||0,10)||0,
        settlementDate:document.getElementById('jf-settlement')?.value||j2.settlementDate,
      }).then(()=>showToast('収益情報を更新しました'));
    });
    document.getElementById('ji-save')?.addEventListener('click',()=>{
      const j2=STATE.selectedJob;if(!j2)return;
      const promised=document.getElementById('ji-promised')?.value||j2.promisedDelivery;
      const maker=document.getElementById('ji-vm')?.value||j2.vehicleMaker||'';
      const model=document.getElementById('ji-vmod')?.value?.trim()||j2.vehicleModel||'';
      const plate=document.getElementById('ji-vp')?.value?.trim()||j2.vehiclePlate||'';
      const vFull=[maker,model,plate].filter(Boolean).join('　')||j2.vehicleName||'';
      const changes={
        customerName:document.getElementById('ji-customer')?.value?.trim()||j2.customerName,
        upstream:document.getElementById('ji-upstream')?.value||j2.upstream,
        vehicleName:vFull,
        vehicleMaker:maker,vehicleModel:model,vehiclePlate:plate,
        priority:document.getElementById('ji-priority')?.value||j2.priority,
        promisedDelivery:promised,
        internalDeadline:document.getElementById('ji-deadline')?.value||j2.internalDeadline||addD(promised,-1),
        frontOwnerId:document.getElementById('ji-front')?.value||j2.frontOwnerId,
        note:document.getElementById('ji-note')?.value||''
      };
      // STATE即時反映
      const updJob={...j2,...changes};
      setState({jobs:STATE.jobs.map(x=>x.id===j2.id?updJob:x),selectedJob:updJob});
      updateJob(j2.id,changes).then(()=>showToast('案件情報を更新しました'));
    });
  }

  // NEW JOB モード切り替え
  document.getElementById('nj-mode-checkin')?.addEventListener('click',()=>setState({newJobMode:'checkin'}));
  document.getElementById('nj-mode-reserve')?.addEventListener('click',()=>setState({newJobMode:'reserve'}));

  // チェックイン（予約→受付）
  document.querySelectorAll('[data-checkin]').forEach(btn=>btn.addEventListener('click',e=>{
    e.stopPropagation();
    const j=STATE.jobs.find(x=>x.id===btn.dataset.checkin);
    if(!j)return;
    setState({checkinJobId:j.id,modal:'checkin',qrScanned:null,qrCameraError:null});
  }));
  document.getElementById('job-checkin-btn')?.addEventListener('click',()=>{
    const j=STATE.selectedJob;
    if(!j)return;
    setState({checkinJobId:j.id,modal:'checkin',qrScanned:null,qrCameraError:null});
  });

  // checkinモーダル内のバインド
  if(STATE.modal==='checkin'){
    const j=STATE.jobs.find(x=>x.id===STATE.checkinJobId);
    // QRスキャン起動
    if(!STATE.qrCameraError&&!STATE.qrScanned){
      startQRCamera();
    }
    // デモボタン
    document.querySelectorAll('[data-qr-idx]').forEach(b=>b.addEventListener('click',()=>{
      const v=QR_DEMO_VEHICLES[parseInt(b.dataset.qrIdx)];
      stopQRCamera();
      setState({qrScanned:v,modal:'checkin',qrCameraError:null});
      showToast(`${v.plate} を読み取りました`,'i');
    }));
    // カメラ停止
    document.getElementById('qr-cam-stop')?.addEventListener('click',()=>{
      stopQRCamera();
      setState({qrCameraError:'カメラを手動停止しました。'});
    });
    // 再スキャン
    document.getElementById('qr-rescan')?.addEventListener('click',()=>{
      stopQRCamera();
      setState({qrScanned:null,modal:'checkin',qrCameraError:null});
    });
    // メーカー→車種datalist連動
    document.getElementById('ci-vm')?.addEventListener('change',function(){
      const makerId=VEHICLE_MAKERS.find(m=>m.name===this.value)?.id;
      const models=makerId?VEHICLE_MODELS.filter(m=>m.maker_id===makerId):[];
      const dl=document.getElementById('ci-vmod-list');
      if(dl)dl.innerHTML=models.map(m=>`<option value="${m.name}">`).join('');
    });
    // 初期値がある場合も車種リストを設定
    (function(){
      const sel=document.getElementById('ci-vm');
      if(sel&&sel.value){
        const makerId=VEHICLE_MAKERS.find(m=>m.name===sel.value)?.id;
        const models=makerId?VEHICLE_MODELS.filter(m=>m.maker_id===makerId):[];
        const dl=document.getElementById('ci-vmod-list');
        if(dl)dl.innerHTML=models.map(m=>`<option value="${m.name}">`).join('');
      }
    })();
    // 受付確定
    document.getElementById('ci-save')?.addEventListener('click',async()=>{
      if(!j)return;
      const qr=STATE.qrScanned;
      const maker=document.getElementById('ci-vm')?.value||qr?.maker||j.vehicleMaker||'';
      const model=document.getElementById('ci-vmod')?.value.trim()||qr?.model||j.vehicleModel||'';
      const plate=document.getElementById('ci-vp')?.value.trim()||qr?.plate||j.vehiclePlate||'';
      const cName=document.getElementById('ci-c')?.value.trim()||j.customerName;
      const del=document.getElementById('ci-d')?.value||j.promisedDelivery;
      const tk=document.getElementById('ci-t')?.value;
      const est=parseInt(document.getElementById('ci-e')?.value)||j.estimateAmount||0;
      const upstream=document.getElementById('ci-up')?.value||j.upstream||'自受け';
      const vFull=[maker,model,plate].filter(Boolean).join('　');

      // タスク生成（テンプレートから）
      const tmpl=getTemplatesForDiv(j.div)[tk];
      let newTasks=j.tasks;
      if(tmpl&&j.tasks.length===0){
        newTasks=tmpl.stages.map((sid,i)=>({
          id:`${j.id}_t${i}`,jobId:j.id,stageId:sid,sequence:i,
          status:i===0?'ready':'pending',assigneeId:null,finishEta:addD(today,i+1),
          holdReasonId:null,ngReasonId:null,reworkCount:0,note:'',version:1,completedAt:null,
        }));
      }
      // STATE更新
      const updJob={...j,
        status:'open',
        customerName:cName,
        vehicleName:vFull||j.vehicleName,
        vehicleMaker:maker,vehicleModel:model,vehiclePlate:plate,
        promisedDelivery:del,
        estimateAmount:est,
        upstream,
        tasks:newTasks,
      };
      const newJobs=STATE.jobs.map(x=>x.id===j.id?updJob:x);
      setState({jobs:newJobs,modal:'jobDetail',selectedJob:updJob,checkinJobId:null,qrScanned:null,jobDetailTab:'flow'});
      showToast(`${j.jobNumber} ${cName} — 受付しました`,'s');
      // サーバー保存
      try{
        await updateJob(j.id,{
          status:'open',
          customerName:cName,vehicleName:vFull||j.vehicleName,
          vehicleMaker:maker,vehicleModel:model,vehiclePlate:plate,
          promisedDelivery:del,estimateAmount:est,upstream,
        });
        if(newTasks!==j.tasks){
          await API.post('/api/jobs/'+j.id+'/tasks',newTasks.map(t=>({
            id:t.id,job_id:t.jobId,stage_id:t.stageId,sequence:t.sequence,
            status:t.status,assignee_id:null,finish_eta:t.finishEta,
            hold_reason_id:null,ng_reason_id:null,rework_count:0,note:'',version:1,
          })));
        }
        const custId=await saveCustomerAndVehicle(cName,maker,model,plate,null);
        if(custId) await updateJob(j.id,{customerId:custId});
      }catch(e){showToast('サーバー保存に失敗しました: '+e.message,'e');}
    });
    // (ci-vm連動は上部で設定済み)
  }

  // infoタブのQR補充ボタン（ji-qr-btn）
  document.getElementById('ji-qr-btn')?.addEventListener('click',()=>{
    stopQRCamera();
    setState({qrScanned:null,qrCameraError:null,modal:'qr',_jiQrReturn:true});
  });
  // infoタブのメーカー連動
  const jiVm=document.getElementById('ji-vm');
  if(jiVm){
    jiVm.addEventListener('change',()=>{
      const makerId=VEHICLE_MAKERS.find(m=>m.name===jiVm.value)?.id;
      const models=makerId?VEHICLE_MODELS.filter(m=>m.maker_id===makerId):[];
      const dl=document.getElementById('ji-vmod-list');
      if(dl)dl.innerHTML=models.map(m=>`<option value="${m.name}">`).join('');
    });
  }

  // NEW JOB
  if(STATE.modal==='newJob'&&STATE.newJobDiv){
    const div=STATE.newJobDiv;
    const showTmpl=()=>{
      const k=document.getElementById('nj-t')?.value;
      const tmpl=getTemplatesForDiv(div)[k];
      const el=document.getElementById('tmpl-st');
      if(el&&tmpl)el.textContent=tmpl.stages.map(id=>STAGES.find(s=>s.id===id)?.name).join(' → ');
    };
    document.getElementById('nj-t')?.addEventListener('change',showTmpl);
    showTmpl();
    document.querySelectorAll('.nj-pri').forEach(b=>{
      const pri=document.getElementById('nj-pri');
      if(b.dataset.pri===pri?.value)b.style.background='#dbeafe';
      b.addEventListener('click',()=>{
        document.querySelectorAll('.nj-pri').forEach(x=>x.style.background='');
        b.style.background='#dbeafe';
        if(pri)pri.value=b.dataset.pri;
      });
    });
    document.querySelectorAll('[data-dsc3]').forEach(b=>b.addEventListener('click',()=>{const i=document.getElementById('nj-d');if(i)i.value=b.dataset.dsc3;}));
    bindCustomerSuggest();
    bindVehicleInput();
    bindNewJobSave(div);
    document.getElementById('cf-reload')?.addEventListener('click',()=>{
      setState({modal:null,conflictData:null,selectedJob:null,selectedTask:null});
      refreshJobs().then(()=>showToast('最新データに更新しました','i'));
    });
    document.getElementById('cf-force')?.addEventListener('click',()=>{
      const {conflictData:cd,selectedJob:j,selectedTask:t}=STATE;
      if(!cd||!j||!t)return;
      const jobs=STATE.jobs.map(jb=>{
        if(jb.id!==j.id)return jb;
        return{...jb,tasks:jb.tasks.map(tk=>{
          if(tk.id!==t.id)return tk;
          return{...tk,...cd.attempted,version:tk.version+1};
        })};
      });
      setState({jobs,modal:null,conflictData:null,selectedJob:null,selectedTask:null});
      showToast('上書き保存しました','i');
    });
    document.getElementById('cf-cancel')?.addEventListener('click',()=>
      setState({modal:null,conflictData:null,selectedJob:null,selectedTask:null}));
  }

  // ── v4: 検索・アラート・履歴 ──────────────────────
  document.getElementById('vehicle-search')?.addEventListener('keydown',function(e){
    if(e.isComposing||e.keyCode===229)return;
    if(e.key==='Enter'){e.preventDefault();setState({vehicleSearch:e.target.value});}
  });
  document.getElementById('vehicle-search')?.addEventListener('input',function(e){
    if(e.target.value==='')setState({vehicleSearch:''});
  });
  document.getElementById('today-work-btn')?.addEventListener('click',()=>setState({modal:'todayWork'}));
  document.getElementById('delay-alert-btn')?.addEventListener('click',()=>setState({modal:'delayAlert'}));
  document.getElementById('version-history-btn')?.addEventListener('click',()=>setState({modal:'versionHistory'}));
  document.querySelectorAll('[data-openjob]').forEach(el=>el.addEventListener('click',function(e){
    e.stopPropagation();
    const j=(STATE.jobs||[]).find(x=>x.id===el.dataset.openjob);
    if(j)setState({selectedJob:j,modal:'jobDetail',jobDetailTab:'flow'});
  }));

  // ── v5.2: CSV ────────────────────────────────────
  bindCsvExport();
  bindCsvModal();
}


// ============================================================
// v4 スタイル注入（起動時に一度だけ）
// ============================================================
(function(){
  if(document.getElementById('v4-style'))return;
  const s=document.createElement('style');
  s.id='v4-style';
  s.textContent=`
    .v4-top-tools{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
    .v4-search{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--bdr);border-radius:999px;padding:5px 10px;min-width:240px;cursor:text}
    .v4-search input{border:none;background:transparent;outline:none;width:210px;font-size:12.5px;color:var(--txt)}
    .v4-chip-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border-radius:999px;border:1px solid var(--bdr);background:#fff;color:var(--txt2);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .15s}
    .v4-chip-btn:hover{background:var(--bg2)}
    .v4-chip-btn.alert{border-color:rgba(185,28,28,.25);background:rgba(185,28,28,.06);color:var(--red)}
    .v4-chip-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--red);color:#fff;font-size:10px;font-weight:800}
    .v4-modal-table{width:100%;border-collapse:collapse;font-size:12px}
    .v4-modal-table th,.v4-modal-table td{border-bottom:1px solid var(--bdr);padding:8px 10px;text-align:left;vertical-align:top}
    .v4-modal-table th{background:#eef2f8;color:var(--txt3);font-size:10px;text-transform:uppercase;letter-spacing:.4px;position:sticky;top:0}
    .v4-mini{font-size:11px;color:var(--txt3);margin-top:2px}
    .v4-job-btn{padding:4px 8px;border:1px solid var(--bdr);background:#fff;border-radius:6px;font-size:11px;font-weight:700;color:var(--acc2);cursor:pointer}
    .v4-job-btn:hover{background:#eff6ff}
    @media(max-width:1024px){.v4-top-tools{width:100%;order:2}.v4-search{min-width:0;flex:1}.v4-search input{width:100%}}
    @media(max-width:640px){.v4-top-tools{gap:5px}.v4-search{width:100%}.v4-chip-btn{font-size:11px;padding:5px 8px}}
  `;
  document.head.appendChild(s);
})();

// ============================================================
// バージョン履歴データ
// ============================================================
const VERSION_HISTORY=[
  {version:'v2.0',     date:'初版',      changes:['工程管理の基本UI','HP/BP/引取り納車/顧客・車両/売上レポート/マスタ設定の基本構成']},
  {version:'v2.3',     date:'機能調整',  changes:['「仕上がり確認」→「できばえ確認」','トースト通知の自動消去を安定化']},
  {version:'v3.0',     date:'大型改修',  changes:['元請け・登録番号・詳細情報レイアウトの拡張','引取・納車カンバン、印刷、担当者未確定表示、顧客/車両管理の強化']},
  {version:'v3.1',     date:'不具合修正',changes:['BP/HPカンバンの「ボード/一覧」切替の補強']},
  {version:'v3.2',     date:'運用安定化',changes:['引取未完了車を引取側優先表示','予約段階車両の納車側表示抑制','当日完了の残置制御改善']},
  {version:'v3.2.1',   date:'切替修正',  changes:['BP/HPカンバンの「ボード/一覧」切替を追加補強']},
  {version:'v3.2.1.1', date:'表記調整',  changes:['システム名称・バージョン表記を運用版に合わせて調整']},
  {version:'v4.0',     date:'機能追加',  changes:['車両検索バーを追加','今日の作業一覧を追加','作業遅延アラートを追加','更新履歴表示を追加']},
  {version:'v4.0.1',   date:'不具合修正',changes:['検索バー・今日の作業一覧・作業遅延・履歴の重複表示を修正']},
  {version:'v4.0.2',   date:'不具合修正',changes:['BP / HPカンバン画面の元受け情報表示を復元']},
  {version:'v4.0.3',   date:'不具合修正',changes:['今日の作業一覧クリック時に無反応となり、画面がフリーズしたように見える不具合を修正','作業遅延・履歴も同じ原因で正常にモーダル表示されない問題を修正']},
  {version:'v4.0.4',   date:'不具合修正',changes:['検索窓と履歴ボタンが重複表示される不具合を修正']},
  {version:'v4.0.5',   date:'不具合修正',changes:['検索窓と履歴の重複表示原因となっていた重複V4トップツール描画ブロックを除去']},
  {version:'v4.1',     date:'不具合修正',changes:['ログイン画面が表示されない致命的な不具合を修正','壊れていた履歴追記コードを整理','重複防止ガードを安全な形に再構成']},
  {version:'v4.1.1',   date:'検索修正',  changes:['検索窓は入力中に即時検索せず、Enterキー押下時のみ検索する仕様に変更']},
  {version:'v4.1.2',   date:'不具合修正',changes:['一覧が表示されなくなる不具合を修正','レスポンシブ時に下部へHTML文字列が露出する不具合を解消']},
  {version:'v5.0',     date:'機能追加',  changes:['APIサーバー分離（Express + SQLite）','多拠点対応（7センター）アーキテクチャ設計']},
  {version:'v5.1',     date:'機能追加',  changes:['招待URL認証機能（CSV一括登録・トークン発行・72時間有効）']},
  {version:'v5.2',     date:'機能追加',  changes:['車両情報3分割（メーカー/車種/登録番号）','顧客・車両マスターDB化','案件一覧CSV出力（manager=自拠点/admin=全拠点）','v4機能を完全版app.jsに統合']},
];

// ============================================================
// v4 検索ユーティリティ
// ============================================================
function qNormV4(v){return String(v||'').toLowerCase().replace(/\s+/g,' ').trim();}

function plateOfSafe(j){
  if(j.vehiclePlate)return j.vehiclePlate;
  try{const p=(j.vehicleName||'').split(/[\s　]+/);return p.slice(2).join(' ')||'';}catch(e){return '';}
}

function jobMatchesSearch(j){
  const q=qNormV4(STATE.vehicleSearch||'');
  if(!q)return true;
  const assignees=(j.tasks||[]).map(t=>{
    try{return getUserById(t.assigneeId)?.name||'';}catch(e){return '';}
  }).join(' ');
  const blob=qNormV4([
    j.jobNumber,j.customerName,j.vehicleName,
    j.vehicleMaker||'',j.vehicleModel||'',j.vehiclePlate||'',
    plateOfSafe(j),j.upstream,j.subType,assignees,j.note
  ].join(' '));
  return blob.includes(q);
}

function isDeliveryCompleted(job){
  const d=(job.tasks||[]).find(t=>{
    try{return STAGES.find(s=>s.id===t.stageId)?.code==='delivery';}catch(e){return false;}
  });
  return !!(d&&d.status==='completed');
}
function currentTaskForDelay(job){
  try{return getCurTask(job);}catch(e){
    return(job.tasks||[]).find(t=>t.status!=='completed')||job.tasks?.[0]||null;
  }
}
function isDelayedJob(job){
  const cur=currentTaskForDelay(job);
  const prom=String(job.promisedDelivery||'');
  const eta=String(cur?.finishEta||'');
  if(!isDeliveryCompleted(job)&&prom&&prom<T)return true;
  if(cur&&cur.status!=='completed'&&eta&&eta<T)return true;
  return false;
}
function getDelayedJobs(){
  return(STATE.jobs||[]).filter(jobMatchesSearch).filter(isDelayedJob)
    .sort((a,b)=>
      String(a.promisedDelivery||'').localeCompare(String(b.promisedDelivery||''))||
      String(a.jobNumber||'').localeCompare(String(b.jobNumber||''))
    );
}
function getDelayedCount(){return getDelayedJobs().length;}

function getTodayWorkJobs(){
  return(STATE.jobs||[]).filter(jobMatchesSearch).filter(j=>{
    const cur=currentTaskForDelay(j);
    const code=(()=>{try{return STAGES.find(s=>s.id===cur?.stageId)?.code||'';}catch(e){return '';}})();
    const active=['in_progress','hold','ready'];
    const codes=['work','bankin','painting','mechanical','polishing','inspection','quality_check','shaken_insp','pickup','delivery'];
    return[j.promisedDelivery,cur?.finishEta].includes(T)||(cur&&active.includes(cur.status)&&codes.includes(code));
  }).sort((a,b)=>String(a.promisedDelivery||'').localeCompare(String(b.promisedDelivery||'')));
}
function vehShortV4(name){if(!name)return'—';const p=name.split(/[\s　]+/);return p.slice(0,2).join(' ')||name;}
function delayReason(job){
  const cur=currentTaskForDelay(job);
  if(job.promisedDelivery&&job.promisedDelivery<T&&!isDeliveryCompleted(job))return'納車予定超過';
  if(cur?.finishEta&&cur.finishEta<T)return'工程予定超過';
  return'要確認';
}
function assigneeNameSafe(job){
  const cur=currentTaskForDelay(job);
  try{return getUserById(cur?.assigneeId)?.name||'未割当';}catch(e){return'未割当';}
}
function curStageNameSafe(job){
  try{return getCurStageName(job)||'—';}catch(e){return'—';}
}

// ============================================================
// v4 モーダル: 今日の作業一覧
// ============================================================
function mTodayWork(){
  const rows=getTodayWorkJobs();
  return`<div class="mbk" id="mbk">
  <div class="mo" style="max-width:980px">
    <div class="mo-hdr">
      <div><div class="mo-ttl">🗓 今日の作業一覧</div><div class="v4-mini">${new Date().toLocaleDateString('ja-JP')} 時点 / 検索フィルター反映済み</div></div>
      <button class="mo-x" id="mc-x">×</button>
    </div>
    <div class="mo-body">
      ${rows.length?`<table class="v4-modal-table">
        <thead><tr><th>区分</th><th>案件番号</th><th>顧客</th><th>車両</th><th>元請け</th><th>現在工程</th><th>担当</th><th>納車予定</th><th></th></tr></thead>
        <tbody>${rows.map(j=>`<tr>
          <td>${divTag(j.div)}<div class="v4-mini">${j.div==='hp'?(subTypeLabel(j.subType)||'HP'):'板金'}</div></td>
          <td style="font-family:var(--mono);font-size:11px;font-weight:700">${j.jobNumber}</td>
          <td style="font-weight:700">${j.customerName}</td>
          <td><div>${vehShortV4(j.vehicleName)}</div><div class="v4-mini">${plateOfSafe(j)}</div></td>
          <td>${upstreamBadge(j.upstream||'自受け')}</td>
          <td>${curStageNameSafe(j)}</td>
          <td>${assigneeNameSafe(j)}</td>
          <td>${fmtD(j.promisedDelivery||'')}</td>
          <td><button class="v4-job-btn" data-openjob="${j.id}">詳細</button></td>
        </tr>`).join('')}</tbody>
      </table>`:`<div class="alert info">本日の対象案件はありません。</div>`}
    </div>
    <div class="mo-ft"><button class="btn btn-n" id="mc-x2">閉じる</button></div>
  </div></div>`;
}

// ============================================================
// v4 モーダル: 作業遅延アラート
// ============================================================
function mDelayAlert(){
  const rows=getDelayedJobs();
  return`<div class="mbk" id="mbk">
  <div class="mo" style="max-width:980px">
    <div class="mo-hdr">
      <div><div class="mo-ttl">🚨 作業遅延アラート</div><div class="v4-mini">検索フィルター反映済み / 納車予定・工程予定の超過を表示</div></div>
      <button class="mo-x" id="mc-x">×</button>
    </div>
    <div class="mo-body">
      ${rows.length
        ?`<div class="alert danger" style="margin-bottom:12px">⚠️ 遅延案件 <strong>${rows.length}件</strong> を検出しています</div>
        <table class="v4-modal-table">
          <thead><tr><th>区分</th><th>案件番号</th><th>顧客</th><th>車両</th><th>現在工程</th><th>担当</th><th>遅延理由</th><th>納車予定</th><th></th></tr></thead>
          <tbody>${rows.map(j=>`<tr>
            <td>${divTag(j.div)}</td>
            <td style="font-family:var(--mono);font-size:11px;font-weight:700">${j.jobNumber}</td>
            <td style="font-weight:700">${j.customerName}</td>
            <td><div>${vehShortV4(j.vehicleName)}</div><div class="v4-mini">${plateOfSafe(j)}</div></td>
            <td>${curStageNameSafe(j)}</td>
            <td>${assigneeNameSafe(j)}</td>
            <td><span class="bx bx-r">${delayReason(j)}</span></td>
            <td style="color:var(--red);font-weight:700">${fmtD(j.promisedDelivery||'')}</td>
            <td><button class="v4-job-btn" data-openjob="${j.id}">詳細</button></td>
          </tr>`).join('')}</tbody>
        </table>`
        :`<div class="alert success">✅ 現在、遅延アラート対象案件はありません。</div>`}
    </div>
    <div class="mo-ft"><button class="btn btn-n" id="mc-x2">閉じる</button></div>
  </div></div>`;
}

// ============================================================
// v4 モーダル: バージョン履歴
// ============================================================
function mVersionHistory(){
  return`<div class="mbk" id="mbk">
  <div class="mo" style="max-width:860px">
    <div class="mo-hdr">
      <div><div class="mo-ttl">🕘 バージョン履歴</div><div class="v4-mini">Ams PRO の変更履歴</div></div>
      <button class="mo-x" id="mc-x">×</button>
    </div>
    <div class="mo-body">
      <table class="v4-modal-table">
        <thead><tr><th style="width:100px">Version</th><th style="width:110px">分類</th><th>変更内容</th></tr></thead>
        <tbody>${[...VERSION_HISTORY].reverse().map(v=>`<tr>
          <td style="font-weight:800;color:var(--acc2)">${v.version}</td>
          <td style="color:var(--txt2)">${v.date}</td>
          <td>${v.changes.map(c=>`<div style="margin-bottom:3px">・${c}</div>`).join('')}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="mo-ft"><button class="btn btn-n" id="mc-x2">閉じる</button></div>
  </div></div>`;
}

// ============================================================
// v5.2 車両入力UI（メーカー/車種/登録番号の3分割）
// ============================================================
function vehicleInputHTML(defMaker='',defModel='',defPlate=''){
  const makerOpts=VEHICLE_MAKERS.map(m=>`<option value="${m.name}"${m.name===defMaker?' selected':''}>${m.name}</option>`).join('');
  return`<div class="fg">
    <label class="flbl">車両 ★必須</label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
      <div>
        <label style="font-size:10px;color:var(--txt3);display:block;margin-bottom:3px">メーカー</label>
        <select class="fi" id="nj-vm" style="width:100%">
          <option value="">-- 選択 --</option>${makerOpts}
        </select>
      </div>
      <div>
        <label style="font-size:10px;color:var(--txt3);display:block;margin-bottom:3px">車種</label>
        <input class="fi" id="nj-vmod" list="vmod-list" value="${defModel}" placeholder="プリウス" style="width:100%">
        <datalist id="vmod-list"></datalist>
      </div>
    </div>
    <div>
      <label style="font-size:10px;color:var(--txt3);display:block;margin-bottom:3px">登録番号（ナンバー）</label>
      <input class="fi" id="nj-vp" value="${defPlate}" placeholder="品川 530 す 1234" style="width:100%">
    </div>
  </div>`;
}

function bindVehicleInput(){
  const makerSel=document.getElementById('nj-vm');
  const modelInput=document.getElementById('nj-vmod');
  if(!makerSel)return;
  makerSel.addEventListener('change',()=>{
    const makerId=VEHICLE_MAKERS.find(m=>m.name===makerSel.value)?.id;
    const models=makerId?VEHICLE_MODELS.filter(m=>m.maker_id===makerId):[];
    const dl=document.getElementById('vmod-list');
    if(dl)dl.innerHTML=models.map(m=>`<option value="${m.name}">`).join('');
  });
  // 初期値があれば車種リストを設定
  if(makerSel.value){
    const makerId=VEHICLE_MAKERS.find(m=>m.name===makerSel.value)?.id;
    const models=makerId?VEHICLE_MODELS.filter(m=>m.maker_id===makerId):[];
    const dl=document.getElementById('vmod-list');
    if(dl)dl.innerHTML=models.map(m=>`<option value="${m.name}">`).join('');
  }
}

// ============================================================
// v5.2 顧客サジェスト入力
// ============================================================
function customerSuggestHTML(defValue=''){
  return`<div class="fg" style="position:relative">
    <label class="flbl">顧客名 ★必須</label>
    <input class="fi" id="nj-c" value="${defValue}" placeholder="例: 山田 太郎" autocomplete="off">
    <div id="cust-suggest" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--bdr);border-radius:var(--r8);box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:9999;max-height:200px;overflow-y:auto"></div>
  </div>`;
}

let _custSuggestTimer=null;
let _selectedCustomerId=null;

function bindCustomerSuggest(){
  _selectedCustomerId=null;
  const input=document.getElementById('nj-c');
  const suggest=document.getElementById('cust-suggest');
  if(!input||!suggest)return;
  input.addEventListener('input',()=>{
    clearTimeout(_custSuggestTimer);
    const q=input.value.trim();
    if(!q){suggest.style.display='none';return;}
    _custSuggestTimer=setTimeout(async()=>{
      try{
        const customers=await API.get(`/api/customers?q=${encodeURIComponent(q)}`);
        if(!customers.length){suggest.style.display='none';return;}
        suggest.innerHTML=customers.map(c=>`
          <div data-cust-id="${c.id}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--bdr);font-size:13px"
            onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
            <div style="font-weight:700">${c.name}</div>
            ${c.kana?`<div style="font-size:10px;color:var(--txt3)">${c.kana}</div>`:''}
            ${c.phone?`<div style="font-size:10px;color:var(--txt3)">📞 ${c.phone}</div>`:''}
          </div>`).join('');
        suggest.style.display='block';
        suggest.querySelectorAll('[data-cust-id]').forEach(el=>{
          el.addEventListener('click',async()=>{
            const cust=customers.find(c=>c.id===el.dataset.custId);
            if(!cust)return;
            input.value=cust.name;
            _selectedCustomerId=cust.id;
            suggest.style.display='none';
            try{
              const detail=await API.get(`/api/customers/${cust.id}`);
              if(detail.vehicles?.length>0){
                const v=detail.vehicles[0];
                const makerSel=document.getElementById('nj-vm');
                const modelInput=document.getElementById('nj-vmod');
                const plateInput=document.getElementById('nj-vp');
                if(makerSel)makerSel.value=v.maker||'';
                if(modelInput)modelInput.value=v.model||'';
                if(plateInput)plateInput.value=v.plate||'';
                const makerId=VEHICLE_MAKERS.find(m=>m.name===v.maker)?.id;
                const models=makerId?VEHICLE_MODELS.filter(m=>m.maker_id===makerId):[];
                const dl=document.getElementById('vmod-list');
                if(dl)dl.innerHTML=models.map(m=>`<option value="${m.name}">`).join('');
                showToast(`${cust.name} の車両情報を自動入力しました`,'i');
              }
            }catch(e){}
          });
        });
      }catch(e){suggest.style.display='none';}
    },200);
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('#nj-c')&&!e.target.closest('#cust-suggest'))suggest.style.display='none';
  });
}

// ============================================================
// v5.2 顧客・車両の自動保存
// ============================================================
async function saveCustomerAndVehicle(custName,maker,model,plate,customerId){
  try{
    let cId=customerId;
    if(!cId){
      const existing=await API.get(`/api/customers?q=${encodeURIComponent(custName)}`);
      const match=existing.find(c=>c.name===custName);
      cId=match?match.id:(await API.post('/api/customers',{name:custName})).id;
    }
    if(plate||model){
      const existing=await API.get(`/api/vehicles?customer_id=${cId}`);
      if(!existing.find(v=>v.plate===plate&&v.model===model)){
        await API.post('/api/vehicles',{customer_id:cId,maker,model,plate});
      }
    }
    return cId;
  }catch(e){console.warn('顧客・車両の自動保存失敗:',e.message);return null;}
}

// ============================================================
// v5.2 新規案件登録ハンドラ（3分割対応）
// ============================================================
function bindNewJobSave(div){
  document.getElementById('nj-save')?.addEventListener('click',async()=>{
    const c=document.getElementById('nj-c')?.value.trim();
    const maker=document.getElementById('nj-vm')?.value||'';
    const model=document.getElementById('nj-vmod')?.value.trim()||'';
    const plate=document.getElementById('nj-vp')?.value.trim()||'';
    const vFull=[maker,model,plate].filter(Boolean).join('　');
    const mode=STATE.newJobMode||'checkin';
    if(!c){document.getElementById('nj-err').innerHTML='<div class="alert danger">⚠️ 顧客名を入力してください</div>';return;}
    if(mode!=='reserve'&&!maker&&!model&&!plate){document.getElementById('nj-err').innerHTML='<div class="alert danger">⚠️ 車両情報を入力してください</div>';return;}
    const tk=document.getElementById('nj-t')?.value;
    const tmpl=getTemplatesForDiv(div)[tk];
    const del=document.getElementById('nj-d')?.value;
    const est=parseInt(document.getElementById('nj-e')?.value)||0;
    const pri=document.getElementById('nj-pri')?.value||'normal';
    const upstream=document.getElementById('nj-up')?.value;
    const frontId=document.getElementById('nj-f')?.value;
    const settlementDate=document.getElementById('nj-sd')?.value||del;
    const prefix=div==='hp'?'h':'j';
    const newId=prefix+Date.now();
    const bpCount=STATE.jobs.filter(j=>j.div==='bp').length;
    const hpCount=STATE.jobs.filter(j=>j.div==='hp').length;
    const num=div==='hp'?String(30000+hpCount+1):String(20000+bpCount+1);
    const tasks=(mode==='reserve'&&!tmpl)?[]:tmpl.stages.map((sid,i)=>({
      id:`${newId}_t${i}`,jobId:newId,stageId:sid,sequence:i,
      status:i===0?'ready':'pending',assigneeId:null,finishEta:addD(today,i+1),
      holdReasonId:null,ngReasonId:null,reworkCount:0,note:'',version:1,completedAt:null,
    }));
    const nj={
      id:newId,jobNumber:`#${num}`,
      customerName:c,vehicleName:vFull,
      vehicleMaker:maker,vehicleModel:model,vehiclePlate:plate,
      customerId:_selectedCustomerId||null,vehicleId:null,
      upstream,priority:pri,div,subType:div==='hp'?tk:null,
      entryDate:isoDate(today),promisedDelivery:del,settlementDate,
      frontOwnerId:frontId,createdBy:STATE.user?.id||frontId,
      internalDeadline:addD(del,-1),
      estimateAmount:est,
      estimatePartsCost:Math.floor(est*.22),
      estimateLaborCost:Math.floor(est*(div==='hp'?.25:.2)),
      actualAmount:null,settlementStatus:'unsettled',status:mode==='reserve'?'reserved':'open',version:1,note:'',tasks,
    };
    setState({jobs:[nj,...STATE.jobs],modal:null,qrScanned:null,newJobDiv:null});
    showToast(`案件 #${num} を登録しました`);
    try{
      const custId=await saveCustomerAndVehicle(c,maker,model,plate,_selectedCustomerId);
      nj.customerId=custId;
      await createJob({...nj},tasks);
    }catch(e){showToast('サーバーへの保存に失敗しました: '+e.message,'e');}
    _selectedCustomerId=null;
  });
}

// ============================================================
// v5.2 車両詳細表示（案件詳細モーダル）
// ============================================================
function vehicleDetailHTML(j){
  const maker=j.vehicleMaker||'';
  const model=j.vehicleModel||'';
  const plate=j.vehiclePlate||'';
  if(maker||model||plate){
    return`<div class="pr-row">
      <span class="pr-lbl">車両</span>
      <span>
        <span style="font-weight:600">${maker} ${model}</span>
        ${plate?`<span style="margin-left:8px;font-family:var(--mono);font-size:12px;color:var(--txt2)">${plate}</span>`:''}
      </span>
    </div>`;
  }
  return`<div class="pr-row"><span class="pr-lbl">車両</span><span style="font-weight:600">${j.vehicleName||'—'}</span></div>`;
}

// ============================================================
// v5.2 CSV出力
// ============================================================
function canExportCSV(user){return user&&['admin','manager'].includes(user.role);}

function bindCsvExport(){
  document.getElementById('csv-export-btn')?.addEventListener('click',()=>setState({modal:'csvExport'}));
}

function mCsvExport(){
  if(STATE.modal!=='csvExport')return'';
  const user=STATE.user;
  const isAdmin=user?.role==='admin';
  const today8=isoDate(new Date());
  const mon1=today8.slice(0,7)+'-01';
  return`<div class="mbk" id="mbk">
  <div class="mo" style="max-width:480px">
    <div class="mo-hdr">
      <span class="mo-ttl">📥 案件一覧 CSV出力</span>
      <button class="mo-x" id="mc-x">×</button>
    </div>
    <div class="mo-body">
      <div class="alert info" style="margin-bottom:14px">
        ${isAdmin?'ℹ️ 管理者権限：全拠点・全事業の案件を出力できます':'ℹ️ 工場長権限：自拠点の案件を出力します'}
      </div>
      <div class="fg"><label class="flbl">事業絞り込み</label>
        <select class="fi" id="csv-div">
          <option value="all">全事業（BP + HP）</option>
          <option value="bp">BP事業のみ</option>
          <option value="hp">HP事業のみ</option>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="fg"><label class="flbl">受付日 開始</label><input type="date" class="fi" id="csv-from" value="${mon1}"></div>
        <div class="fg"><label class="flbl">受付日 終了</label><input type="date" class="fi" id="csv-to" value="${today8}"></div>
      </div>
      <div class="fg"><label class="flbl">ステータス</label>
        <select class="fi" id="csv-status">
          <option value="all">全ステータス</option>
          <option value="in_progress">進行中</option>
          <option value="completed">完了</option>
          <option value="cancelled">キャンセル</option>
        </select>
      </div>
      <div style="background:var(--bg2);border-radius:8px;padding:12px;font-size:12px;color:var(--txt2)">
        <div style="font-weight:700;margin-bottom:4px">出力フィールド（22項目）</div>
        <div style="font-size:11px;color:var(--txt3);line-height:1.6">
          案件番号 / 受付日 / 事業 / 顧客名 / メーカー / 車種 / 登録番号 / 車両名(旧) / 優先度 / 元受け / 約束納車日 / 清算予定日 / 見込み売上 / 見込み部品原価 / 見込み工賃 / 実績金額 / 清算状況 / 進捗ステータス / 担当フロント / 備考 / 登録日時 / 更新日時
        </div>
      </div>
    </div>
    <div class="mo-ft">
      <button class="btn btn-n" id="mc-x2">キャンセル</button>
      <button class="btn btn-p" id="csv-dl-btn">📥 ダウンロード</button>
    </div>
  </div></div>`;
}

function bindCsvModal(){
  if(STATE.modal!=='csvExport')return;
  const user=STATE.user;
  document.getElementById('csv-dl-btn')?.addEventListener('click',()=>{
    const div=document.getElementById('csv-div')?.value||'all';
    const dateFrom=document.getElementById('csv-from')?.value||'';
    const dateTo=document.getElementById('csv-to')?.value||'';
    const status=document.getElementById('csv-status')?.value||'all';
    const params=new URLSearchParams();
    params.set('role',user.role);
    if(user.role==='manager'&&user.centerId)params.set('center_id',user.centerId);
    if(div!=='all')params.set('div',div);
    if(dateFrom)params.set('date_from',dateFrom);
    if(dateTo)params.set('date_to',dateTo);
    if(status!=='all')params.set('status',status);
    const a=document.createElement('a');
    a.href=`/api/jobs/csv?${params.toString()}`;
    a.download='';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setState({modal:null});
    showToast('CSVのダウンロードを開始しました','i');
  });
}


// ============================================================
// 車検証QRコード パーサー
// 国土交通省の車検証電子化QR仕様に対応
// フォーマット: CTF<version>\n<field1>\t<field2>...
// ============================================================
function parseShakkenQR(rawText){
  try{
    // 国交省形式: 先頭が CTF または QR識別子で始まる
    // フィールドはタブ区切り、改行区切り混在
    const lines = rawText.split(/\r?\n/);
    let fields = [];
    lines.forEach(l => { fields = fields.concat(l.split('\t')); });
    // 空フィールドを除去しつつ順序保持
    fields = fields.map(f => f.trim()).filter(f => f.length > 0);

    // 国交省QR仕様（2023年1月施行）フィールド順序
    // [0]:識別子 [1]:車台番号 [2]:型式 [3]:原動機型式
    // [4]:車名(メーカー) [5]:車種 [6]:用途 [7]:自家用/事業用
    // [8]:軸重... [N-4]:ナンバー地域 [N-3]:分類番号
    // [N-2]:ひらがな [N-1]:一連指定番号
    // 所有者・使用者・住所等も含む

    // 実際のQRデータ例をもとに柔軟にパース
    const result = {
      maker: '',
      model: '',
      plate: '',
      year: null,
      vin: '',
      owner: '',
      color: '',
      engine: '',
      disp: 0,
      raw: rawText,
    };

    // ① 車台番号を探す（英数字8文字以上）
    const vinPat = /^[A-Z0-9]{8,20}$/;
    for(let i=0;i<fields.length;i++){
      if(vinPat.test(fields[i]) && fields[i].length >= 10){
        result.vin = fields[i];
        break;
      }
    }

    // ② ナンバーを再構成
    // 地域名・分類番号・ひらがな・一連番号の組み合わせ
    // 「品川」「530」「す」「1234」→「品川 530 す 1234」
    // パターン検索: 都道府県名または地域名を含むフィールド
    const prefPattern = /^(札幌|函館|旭川|室蘭|釧路|帯広|北見|岩手|宮城|秋田|山形|福島|水戸|宇都宮|群馬|大宮|川越|川口|春日部|所沢|千葉|習志野|柏|船橋|市川|成田|横浜|川崎|相模|湘南|横須賀|多摩|八王子|品川|練馬|足立|葛飾|江東|杉並|世田谷|板橋|墨田|新宿|北|山梨|長野|松本|静岡|沼津|浜松|名古屋|岡崎|一宮|三河|春日井|豊田|豊橋|尾張小牧|京都|大阪|堺|和泉|なにわ|摂津|神戸|姫路|奈良|和歌山|岡山|広島|福山|山口|徳島|香川|愛媛|高知|北九州|福岡|筑豊|筑後|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄|盛岡|山形|福島|高崎|長野|岐阜|三重|滋賀|鳥取|島根|下関|徳島|高松|松山|高知|久留米|佐世保|那覇)/;
    let plateIdx = -1;
    for(let i=0;i<fields.length;i++){
      if(prefPattern.test(fields[i])){
        plateIdx = i;
        break;
      }
    }
    if(plateIdx >= 0){
      const region = fields[plateIdx] || '';
      const num1   = fields[plateIdx+1] || ''; // 分類番号
      const kana   = fields[plateIdx+2] || ''; // ひらがな
      const num2   = fields[plateIdx+3] || ''; // 一連指定番号
      result.plate = [region, num1, kana, num2].filter(Boolean).join(' ');
    }

    // ③ 車名・型式からメーカー・車種を推定
    // 国交省QRでは「車名」=メーカー系識別名、「型式」=型式記号
    // 日本語車種名が含まれるフィールドを探す
    const jaPattern = /^[\u3040-\u30FF\u4E00-\u9FAF\uFF66-\uFF9F][^\t]{1,30}$/;
    const candidates = fields.filter(f => jaPattern.test(f) && f.length >= 2 && f.length <= 20);
    
    // 既知メーカー名リストでマッチ
    const knownMakers = ['トヨタ','ホンダ','日産','マツダ','スバル','三菱','ダイハツ','スズキ','いすゞ','日野','レクサス','三菱ふそう','UDトラックス'];
    for(const c of candidates){
      if(knownMakers.some(m => c.includes(m))){
        result.maker = knownMakers.find(m => c.includes(m)) || c;
        break;
      }
    }
    // 車種名（メーカー名フィールドの次のフィールドが多い）
    if(result.maker){
      const mIdx = fields.findIndex(f => f.includes(result.maker));
      if(mIdx >= 0 && fields[mIdx+1] && jaPattern.test(fields[mIdx+1])){
        result.model = fields[mIdx+1];
      }
    }

    // ④ 初年度登録（YYYY年M月形式）
    const yearPat = /(\d{4})年/;
    for(const f of fields){
      const m = f.match(yearPat);
      if(m){result.year = parseInt(m[1]);break;}
    }
    // 和暦対応: 令和n年 → 2018+n
    const jYearPat = /令和(\d+)年/;
    for(const f of fields){
      const m = f.match(jYearPat);
      if(m){result.year = 2018 + parseInt(m[1]);break;}
    }

    // ⑤ 所有者名（漢字フルネームを推定）
    const ownerPat = /^[\u4E00-\u9FAF]{1,3}[\u3040-\u309F\u4E00-\u9FAF]{1,10}$/;
    for(const f of fields){
      if(ownerPat.test(f) && f.length >= 3 && f.length <= 8){
        result.owner = f;
        break;
      }
    }

    // 最低限プレートが取れていればOKとする
    return result.plate ? result : null;
  }catch(e){
    console.warn('QRパース失敗:', e);
    return null;
  }
}

// ============================================================
// カメラ制御（jsQR使用）
// ============================================================
let _qrStream = null;
let _qrRafId  = null;
let _jsQRLoaded = false;

async function loadJsQR(){
  if(_jsQRLoaded || window.jsQR) { _jsQRLoaded=true; return true; }
  return new Promise(resolve=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    s.onload=()=>{_jsQRLoaded=true;resolve(true);};
    s.onerror=()=>resolve(false);
    document.head.appendChild(s);
  });
}

function stopQRCamera(){
  if(_qrRafId){cancelAnimationFrame(_qrRafId);_qrRafId=null;}
  if(_qrStream){_qrStream.getTracks().forEach(t=>t.stop());_qrStream=null;}
}

async function startQRCamera(){
  // すでに起動中なら何もしない
  if(_qrStream) return;

  const jsqrOk = await loadJsQR();
  if(!jsqrOk){
    setState({qrCameraError:'jsQRライブラリの読み込みに失敗しました。インターネット接続を確認してください。'});
    return;
  }

  const video = document.getElementById('qr-video');
  const canvas = document.getElementById('qr-canvas');
  const statusLbl = document.getElementById('qr-status-lbl');
  if(!video || !canvas) return;

  try{
    _qrStream = await navigator.mediaDevices.getUserMedia({
      video:{
        facingMode:{ideal:'environment'}, // リアカメラ優先
        width:{ideal:1280},
        height:{ideal:720},
      }
    });
    video.srcObject = _qrStream;
    video.play();
  }catch(err){
    let msg = 'カメラへのアクセスが拒否されました。';
    if(err.name === 'NotFoundError')      msg = 'カメラが見つかりません。';
    else if(err.name === 'NotAllowedError') msg = 'カメラのアクセス許可が必要です。ブラウザのアドレスバー横のアイコンから許可してください。';
    else if(err.name === 'NotReadableError') msg = 'カメラが別のアプリで使用中です。';
    else if(err.name === 'OverconstrainedError') msg = 'カメラの解像度に対応していません。';
    else if(location.protocol !== 'https:' && location.hostname !== 'localhost')
      msg = 'カメラを使用するにはHTTPS接続が必要です（現在HTTP）。';
    setState({qrCameraError: msg});
    return;
  }

  const ctx = canvas.getContext('2d',{willReadFrequently:true});
  let lastScanTime = 0;

  function tick(){
    if(!document.getElementById('qr-video')){stopQRCamera();return;}
    if(video.readyState === video.HAVE_ENOUGH_DATA){
      const now = Date.now();
      // 200ms毎にスキャン（CPU負荷軽減）
      if(now - lastScanTime > 200){
        lastScanTime = now;
        canvas.height = video.videoHeight;
        canvas.width  = video.videoWidth;
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const imgData = ctx.getImageData(0,0,canvas.width,canvas.height);
        const code = window.jsQR(imgData.data,imgData.width,imgData.height,{inversionAttempts:'dontInvert'});
        if(code){
          // QRコード検出
          if(statusLbl) statusLbl.textContent = '🟢 QRコードを検出しました…';
          const raw = code.data;
          let parsed = parseShakkenQR(raw);

          if(!parsed){
            // 汎用QR（URL等）として扱う
            // プレートらしき文字列があるか確認
            const plateMatch = raw.match(/([\u3040-\u30FF\u4E00-\u9FAF]{1,4})\s*(\d{2,3})\s*([\u3041-\u3096])\s*(\d{3,4})/);
            if(plateMatch){
              const plate = `${plateMatch[1]} ${plateMatch[2]} ${plateMatch[3]} ${plateMatch[4]}`;
              parsed = {plate,maker:'',model:'',year:null,vin:'',owner:'',color:'',raw};
            } else {
              if(statusLbl) statusLbl.textContent = '⚠️ 車検証のQRコードではありません。読み直してください。';
              _qrRafId = requestAnimationFrame(tick);
              return;
            }
          }

          stopQRCamera();
          setState({qrScanned:parsed,modal:'qr',qrCameraError:null});
          showToast(parsed.plate ? `${parsed.plate} を読み取りました` : 'QRコードを読み取りました','i');
          return;
        }
      }
    }
    _qrRafId = requestAnimationFrame(tick);
  }

  video.addEventListener('loadedmetadata',()=>{
    if(statusLbl) statusLbl.textContent = '🔍 QRコードを枠内に合わせてください';
    _qrRafId = requestAnimationFrame(tick);
  },{once:true});
}

// モーダルを閉じる際にカメラを必ず停止
const _setState_orig = setState;
setState = function(patch){
  if(patch.modal !== undefined && patch.modal !== 'qr'){
    stopQRCamera();
  }
  return _setState_orig(patch);
};

// ============================================================
// 起動
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('app').innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f0f3f7;">
      <div style="text-align:center;color:#4a5872;">
        <div style="font-size:32px;margin-bottom:12px;">🔧</div>
        <div style="font-size:14px;font-weight:600;">Ams PRO を起動中...</div>
        <div style="font-size:12px;margin-top:6px;color:#8496ae;">サーバーに接続しています</div>
      </div>
    </div>`;

  try {
    await loadMasters();
    const jobs = await loadJobs();
    STATE.jobs = jobs;
    render();
  } catch (e) {
    document.getElementById('app').innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f0f3f7;">
        <div style="text-align:center;max-width:400px;padding:20px;">
          <div style="font-size:32px;margin-bottom:12px;">❌</div>
          <div style="font-size:15px;font-weight:700;color:#b91c1c;margin-bottom:8px;">サーバーに接続できません</div>
          <div style="font-size:12px;color:#4a5872;margin-bottom:16px;">${e.message}</div>
          <div style="font-size:12px;background:#f5f7fa;border:1px solid #dde3ec;border-radius:8px;padding:12px;text-align:left;color:#4a5872;">
            <b>確認事項:</b><br>
            1. <code>node server.js</code> が起動しているか<br>
            2. <code>node seed.js</code> を実行済みか<br>
            3. ブラウザのアドレスが正しいか
          </div>
          <button onclick="location.reload()" style="margin-top:12px;padding:8px 20px;background:#1a56db;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">再接続</button>
        </div>
      </div>`;
  }
});