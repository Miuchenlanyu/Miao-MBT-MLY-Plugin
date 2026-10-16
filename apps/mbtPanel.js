import fs from 'node:fs'
import path from 'node:path'
import lodash from 'lodash'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { AsyncLocalStorage } from 'node:async_hooks'

const reqStore = new AsyncLocalStorage()

const ROOT = process.cwd()
const PLUGIN = path.join(ROOT, 'plugins', 'Miao-MBT-MLY-Plugin')
const MLY_MBT = path.join(PLUGIN, 'resources', 'MLY-MBT')
const MIAO_PROFILE = path.join(ROOT, 'plugins', 'miao-plugin', 'resources', 'profile', 'normal-character')
const ZZZ_IMAGES = path.join(ROOT, 'plugins', 'ZZZ-Plugin', 'resources', 'panel', 'images')
const DATA_DIR = path.join(PLUGIN, 'data')
const CFG_FILE = path.join(DATA_DIR, 'mly-config.json')
const WEB_PORT = 11001

const GAME_ALIAS = {
  原神: 'genshin', 原: 'genshin',
  星铁: 'starrail', 崩铁: 'starrail', 星穹铁道: 'starrail',
  绝区零: 'zzz', zzz: 'zzz',
}
const GAME_NAME = { genshin: '原神', starrail: '崩坏：星穹铁道', zzz: '绝区零' }
// 简写命令前缀：<符号>MLY <角色> —— # 原神 / * 崩铁 / % 绝区零
const GAME_PREFIX = { '#': 'genshin', '*': 'starrail', '%': 'zzz' }
const PREFIX_OF = { genshin: '#', starrail: '*', zzz: '%' }
const GS_ELEM = { geo: '岩', pyro: '火', anemo: '风', cryo: '冰', electro: '雷', hydro: '水', dendro: '草', multi: '旅行者' }
const ELEM_ORDER = ['岩', '火', '水', '风', '雷', '冰', '草', '物理', '量子', '虚数', '旅行者', '其他']
// 元素图标取自 Yunzai：原神 = genshin 插件 element 目录；崩铁 = miao-plugin meta-sr public/icons
const ELEM_DIR = {
  genshin: path.join(ROOT, 'plugins', 'genshin', 'resources', 'img', 'element'),
  starrail: path.join(ROOT, 'plugins', 'miao-plugin', 'resources', 'meta-sr', 'public', 'icons'),
  zzz: path.join(ROOT, 'plugins', 'ZZZ-Plugin', 'resources', 'common', 'images', 'element'),
}
const ELEM_FILE = {
  genshin: { 岩: 'geo.png', 火: 'pyro.png', 水: 'hydro.png', 风: 'anemo.png', 雷: 'electro.png', 冰: 'cryo.png', 草: 'dendro.png', 旅行者: 'multi.png' },
  starrail: { 雷: 'elem-elec.webp', 火: 'elem-fire.webp', 物理: 'elem-phy.webp', 冰: 'elm-ice.webp', 风: 'elem-wind.webp', 量子: 'elem-auantum.webp', 虚数: 'elem-imaginary.webp' },
  zzz: { 物理: 'Physical.png', 火: 'Fire.png', 冰: 'Ice.png', 电: 'Electric.png', 风: 'Wind.png', 以太: 'Ether.png', 流明: 'Lumiflux.png' },
}
// 图库可选根目录：mly=MBT 仓库(R)，miao=面板候选池(R17/R18)，zzz=绝区零图库
const IMG_ROOTS = { mly: MLY_MBT, miao: MIAO_PROFILE, zzz: ZZZ_IMAGES }
// 仓库分级目录：resources/MLY-MBT/<游戏>/R | R17 | R18
const LEVELS = ['R', 'R17', 'R18']
const IMG_EXT = ['.webp', '.png', '.jpg', '.jpeg', '.gif']

function loadCfg() {
  let c = {}
  try { c = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) } catch {}
  return lodash.defaults(c, { r18_view: '主人', r: true, r17: false, r18: false, intercept: true,
    syncHost: '127.0.0.1', syncPort: 11002 })
}
function saveCfg(c) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2))
}
function listImages(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => IMG_EXT.includes(path.extname(f).toLowerCase())).sort()
}
function gradeOf(name) {
  const n = name.toLowerCase()
  if (n.includes('r18')) return 'r18'
  if (n.includes('r17')) return 'r17'
  return 'r'
}
function allowR18(cfg, e) {
  if (cfg.r18_view === '无人') return false
  if (cfg.r18_view === '主人') return !!e.isMaster
  return true
}
function resolveGame(t) {
  if (!t) return ''
  return GAME_ALIAS[t] || ''
}
function safeJoin(base, rel) {
  const p = path.resolve(base, rel)
  const b = path.resolve(base)
  if (p !== b && !p.startsWith(b + path.sep)) return null
  return p
}
const _metaCache = {}
function metaDir(game) {
  const mg = game === 'genshin' ? 'meta-gs' : game === 'starrail' ? 'meta-sr' : 'meta-zzz'
  return path.join(ROOT, 'plugins', 'miao-plugin', 'resources', mg, 'character')
}
/** 该游戏在 Yunzai meta 中存在的角色名集合（用于判定角色归属 + 快速跳过） */
function metaNames(game) {
  if (_metaCache[game]) return _metaCache[game]
  const s = new Set()
  try {
    for (const n of fs.readdirSync(metaDir(game))) {
      if (fs.statSync(path.join(metaDir(game), n)).isDirectory()) s.add(n)
    }
  } catch {}
  _metaCache[game] = s
  return s
}
/** 读取角色元数据（元素 / 星级） */
function charMeta(game, name) {
  if (!metaNames(game).has(name)) return null
  try { return JSON.parse(fs.readFileSync(path.join(metaDir(game), name, 'data.json'), 'utf8')) } catch { return null }
}
function elemOf(game, m) {
  const raw = m && m.elem
  if (!raw) return '其他'
  return game === 'genshin' ? (GS_ELEM[raw] || raw) : raw
}
/** 构建图库数据：game -> char -> { elem, star, imgs:{r,r17,r18} }，图片带来源根(s) */
function buildRepo() {
  const out = {}
  const ensure = (game, char) => {
    if (!char) return
    const g = out[game] || (out[game] = {})
    if (!g[char]) {
      const m = charMeta(game, char)
      g[char] = { elem: elemOf(game, m), star: (m && m.star) || 0, imgs: { r: [], r17: [], r18: [] } }
    }
  }
  for (const game of ['genshin', 'starrail', 'zzz']) {
    // 1) 仓库的三个分级目录 R / R17 / R18 都是角色来源（目录即分级）
    for (const lvl of LEVELS) {
      const dir = path.join(MLY_MBT, game, lvl, 'normal-character')
      if (!fs.existsSync(dir)) continue
      for (const c of fs.readdirSync(dir)) {
        if (fs.statSync(path.join(dir, c)).isDirectory()) ensure(game, c)
      }
    }
    // 2) 补充来源：miao 候选池（原神/崩铁）或 ZZZ 图库，按文件名含 r17/r18 判定
    const src = game === 'zzz' ? ZZZ_IMAGES : MIAO_PROFILE
    const srcKey = game === 'zzz' ? 'zzz' : 'miao'
    if (fs.existsSync(src)) {
      for (const c of fs.readdirSync(src)) {
        if (!fs.statSync(path.join(src, c)).isDirectory()) continue
        // 原神/崩铁：按 meta 判定归属；绝区零无 meta，且 ZZZ 图库混有 ranks/star 等 UI 素材目录，
        // 因此只纳入含中文名的目录，避免把 UI 素材当成角色
        if (game !== 'zzz') { if (!metaNames(game).has(c)) continue }
        else if (!/[\u4e00-\u9fa5]/.test(c)) continue
        ensure(game, c)
      }
    }
    for (const char of Object.keys(out[game] || {})) {
      // 仓库分级目录：目录名即分级
      for (const lvl of LEVELS) {
        const dir = path.join(MLY_MBT, game, lvl, 'normal-character', char)
        if (!fs.existsSync(dir)) continue
        for (const f of listImages(dir)) {
          out[game][char].imgs[lvl.toLowerCase()].push(
            { s: 'mly', p: path.join(game, lvl, 'normal-character', char, f) })
        }
      }
      // 候选池：按文件名标记分级
      const mdir = path.join(src, char)
      for (const f of listImages(mdir)) {
        const g = gradeOf(f)
        const item = { s: srcKey, p: path.join(char, f) }
        if (g === 'r17') out[game][char].imgs.r17.push(item)
        else if (g === 'r18') out[game][char].imgs.r18.push(item)
      }
    }
  }
  return out
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}
function renderAdmin(c) {
  const repoJson = buildRepo()   // 前端按 R/R17/R18 勾选 + 元素分组动态渲染
  const hasAny = Object.keys(repoJson).some(g => Object.keys(repoJson[g] || {}).length)
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;background:#15182a;color:#e9ecf5;padding:20px}
h1{font-size:22px;margin-bottom:4px}
.sub{color:#9aa3c4;font-size:13px;margin-bottom:18px}
.panel{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:16px 18px;margin-bottom:16px}
.row{display:flex;align-items:center;gap:12px;padding:8px 0;flex-wrap:wrap}
.row label{width:160px;color:#c3c9e0;font-size:14px}
.ck{display:inline-flex;align-items:center;gap:5px;width:auto!important;font-size:13px;cursor:pointer;padding:4px 10px;border-radius:8px;background:#222742;border:1px solid #3a3f5c}
.ck input{cursor:pointer}
.ck.on{background:#3a4474;border-color:#6a7dd0;color:#fff}
select,button{font-size:14px;padding:6px 10px;border-radius:8px;border:1px solid #3a3f5c;background:#222742;color:#e9ecf5}
button{cursor:pointer;background:linear-gradient(135deg,#ff9d54,#ff5d8f);border:none;color:#fff;font-weight:700}
.grp{font-size:14px;color:#7fe3ff;font-weight:700;margin:14px 0 8px;letter-spacing:1px}
/* 顶层页面 Tab：图库预览 / 管理设置 */
.wtabs{display:flex;gap:4px;margin-top:12px}
.wtab{padding:8px 18px;border-radius:8px 8px 0 0;cursor:pointer;background:#1b2138;color:#9aa3c4;border:1px solid #2a3050;border-bottom:none;font-size:14px}
.wtab.active{background:#222a47;color:#fff}

/* 图库：游戏 Tab + 筛选（排版与 11002 Gamewiki 一致） */
.gtabs{display:flex;gap:4px;margin-top:10px}
.gtab{padding:8px 16px;border-radius:8px 8px 0 0;cursor:pointer;background:#1b2138;color:#9aa3c4;border:1px solid #2a3050;border-bottom:none;font-size:14px}
.gtab.active{background:#222a47;color:#fff}
.gctrl{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px;background:#161b2e;border:1px solid #2a3050;border-radius:0 8px 8px 8px;margin-bottom:6px}
.gctrl input[type=text]{background:#0f1320;border:1px solid #2a3050;color:#e9ecf5;padding:7px 12px;border-radius:6px;width:220px;font-size:13px}
.panel input[type=text]{background:#0f1320;border:1px solid #3a3f5c;color:#e9ecf5;padding:6px 10px;border-radius:6px;font-size:13px;width:140px}
.bar{width:260px;height:8px;background:#0f1320;border:1px solid #3a3f5c;border-radius:6px;overflow:hidden}
.bar-in{height:100%;width:0;background:linear-gradient(135deg,#ff9d54,#ff5d8f);transition:width .2s}
.gstar{display:flex;gap:6px}
.gstar .chip{font-size:12px;padding:4px 10px;border-radius:20px;cursor:pointer;background:#1b2138;border:1px solid #2a3050;color:#9aa3c4}
.gstar .chip.on{background:#3a4474;color:#fff}
.gsum{margin-left:auto;font-size:13px;color:#9aa3c4}
.gsum b{color:#fff}
.egroup{margin-bottom:20px}
.egroup-head{display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 10px;background:#1b2138;border-radius:8px;border-left:3px solid #4a5db0}
.egroup-head .eicon{width:24px;height:24px;object-fit:contain;flex-shrink:0;background:#0f1320;border-radius:50%;padding:2px}
.egroup-head .ename{font-size:16px;font-weight:700}
.egroup-head .cnt{font-size:12px;color:#8b93b0}
.egroup.collapsed .starblock{display:none}
.badge{position:absolute;top:4px;right:4px;z-index:2;background:rgba(0,0,0,.6);color:#ffd479;font-size:11px;padding:1px 6px;border-radius:6px}
.starblock{margin:10px 0 4px 14px}
.starblock .starlabel{font-size:13px;color:#c3c9e0;margin:6px 0}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:10px}
.card{background:#1b2138;border:1px solid #2a3050;border-radius:10px;overflow:hidden;cursor:pointer;transition:transform .1s,box-shadow .1s}
.card:hover{transform:translateY(-2px);box-shadow:0 4px 10px rgba(0,0,0,.35)}
.card-bg{height:78px;overflow:hidden;display:flex;align-items:flex-end;justify-content:center;position:relative;background:linear-gradient(180deg,#3a3a3a,#222)}
.card-face{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:top center}
.card-info{padding:7px 4px;text-align:center;background:#161b2e}
.card-stars{color:#ffd479;font-size:11px;letter-spacing:1px}
.card-name{color:#e9ecf5;font-size:12px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rarity-5 .card-bg{background:linear-gradient(180deg,#7a5c18 0%,#b8860b 60%,#e6c35c 100%)}
.rarity-4 .card-bg{background:linear-gradient(180deg,#4b2c6e 0%,#7341a3 60%,#a070d9 100%)}
.rarity-3 .card-bg{background:linear-gradient(180deg,#1e4d6b 0%,#2d7bb0 100%)}
.rarity-2 .card-bg{background:linear-gradient(180deg,#315a30 0%,#4c8f49 100%)}
.rarity-1 .card-bg{background:linear-gradient(180deg,#4a4a4a 0%,#6e6e6e 100%)}
.lb{position:fixed;inset:0;background:rgba(0,0,0,.86);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:99;padding:16px}
.lb.on{display:flex}
.lbimgs{display:flex;gap:10px;overflow:auto;max-width:94vw;max-height:78vh;padding:6px}
.lbimgs img{max-height:70vh;border-radius:10px;border:1px solid rgba(255,255,255,.15);flex-shrink:0}
.lb .bar{margin-top:12px;display:flex;align-items:center;gap:12px}
.lb .lbt{color:#c3c9e0;font-size:13px}
.empty{color:#8b93b5}
.tip{color:#7CFFB2;font-size:13px;margin-top:8px;min-height:18px}
</style></head><body>
<h1>MLY 面板图 · Web 管理</h1>
<div class="sub">端口 ${WEB_PORT} · 配置实时写入 data/mly-config.json</div>
<div class="wtabs" id="wtabs">
  <div class="wtab active" data-t="gal">图库预览</div>
  <div class="wtab" data-t="adm">管理设置</div>
</div>
<div id="tabAdm" style="display:none">
<div class="panel">
  <div class="grp">分级开关与权限</div>
  <div class="row"><label>R18 可见权限</label>
    <select id="r18_view">
      <option value="无人"${c.r18_view === '无人' ? ' selected' : ''}>无人</option>
      <option value="主人"${c.r18_view === '主人' ? ' selected' : ''}>主人</option>
      <option value="所有人"${c.r18_view === '所有人' ? ' selected' : ''}>所有人</option>
    </select></div>
  <div class="row"><label>R 级开关</label><input type="checkbox" id="r" ${c.r ? 'checked' : ''}/></div>
  <div class="row"><label>R17 开关</label><input type="checkbox" id="r17" ${c.r17 ? 'checked' : ''}/></div>
  <div class="row"><label>R18 开关</label><input type="checkbox" id="r18" ${c.r18 ? 'checked' : ''}/></div>
  <div class="row"><label>拦截原图（面板立绘）</label><input type="checkbox" id="intercept" ${c.intercept ? 'checked' : ''}/></div>
  <div class="row"><button id="save">保存设置</button><span class="tip" id="tip"></span></div>
  <div class="row"><span class="cnt">当前：R=${c.r ? '开' : '关'} · R17=${c.r17 ? '开' : '关'} · R18=${c.r18 ? '开' : '关'} · R18可见=${c.r18_view} · 接管立绘=${c.intercept ? '开' : '关'}</span></div>
</div>
</div>
<div class="panel">
  <div class="grp">从 Gamewiki (11002) 同步仓库图片</div>
  <div class="row">
    <label>IP / 域名</label><input type="text" id="syncHost" value="${c.syncHost || '127.0.0.1'}" placeholder="127.0.0.1"/>
    <label>端口</label><input type="text" id="syncPort" value="${c.syncPort || 11002}" placeholder="11002"/>
    <select id="syncGame">
      <option value="">全部游戏</option>
      <option value="gs">原神</option>
      <option value="sr">崩坏：星穹铁道</option>
      <option value="zzz">绝区零</option>
    </select>
    <button id="syncTest">测试连接</button>
    <button id="syncRun">开始同步</button>
  </div>
  <div class="row"><span class="tip" id="syncTip">填写 Gamewiki 的 IP 与端口后同步，图片会写入本插件 resources/MLY-MBT/&lt;游戏&gt;/&lt;分级&gt;/normal-character/&lt;角色&gt;/</span></div>
  <div class="row"><div class="bar"><div class="bar-in" id="syncBar"></div></div><span class="tip" id="syncProg"></span></div>
</div>
</div>
<div id="tabGal">
<div class="panel">
  <div class="grp">MBT 仓库图库预览</div>
  <div class="gtabs" id="gtabs"></div>
  <div class="gctrl">
    <input type="text" id="gsearch" placeholder="搜索角色名..."/>
    <label class="ck" id="ck_r"><input type="checkbox" id="g_r" checked onchange="syncCk();render()"/> R</label>
    <label class="ck" id="ck_r17"><input type="checkbox" id="g_r17" onchange="syncCk();render()"/> R17</label>
    <label class="ck" id="ck_r18"><input type="checkbox" id="g_r18" onchange="syncCk();render()"/> R18</label>
    <div class="gstar" id="gstar"></div>
    <span class="gsum" id="gtip"></span>
  </div>
  <div id="gal">${hasAny ? '' : '<p class="empty">MLY-MBT 仓库暂无图片，请把 R 级图放到 resources/MLY-MBT/&lt;游戏&gt;/R/normal-character/&lt;角色&gt;/</p>'}</div>
</div>
</div>
<div class="lb" id="lb"><div class="lbimgs" id="lbBody"></div><div class="bar"><button id="lbClose">关闭</button><span class="lbt" id="lbTitle"></span></div></div>
<script>
const REPO=${JSON.stringify(repoJson)};
const tip=document.getElementById('tip');
document.getElementById('save').onclick=async()=>{
  const cfg={r18_view:document.getElementById('r18_view').value,
    r:document.getElementById('r').checked,
    r17:document.getElementById('r17').checked,
    r18:document.getElementById('r18').checked,
    intercept:document.getElementById('intercept').checked};
  try{
    const r=await fetch('/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
    const j=await r.json();
    tip.textContent=j.ok?'已保存 ✓':'保存失败：'+(j.msg||'');
  }catch(e){tip.textContent='请求失败：'+e;}
};
document.querySelectorAll('.wtab').forEach(t=>{
  t.onclick=()=>{
    document.querySelectorAll('.wtab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const adm=t.dataset.t==='adm';
    document.getElementById('tabAdm').style.display=adm?'':'none';
    document.getElementById('tabGal').style.display=adm?'none':'';
  };
});
const sTip=document.getElementById('syncTip'),sBar=document.getElementById('syncBar'),sProg=document.getElementById('syncProg');
function syncArg(){return {host:(document.getElementById('syncHost').value||'127.0.0.1').trim(),
  port:parseInt(document.getElementById('syncPort').value||'11002',10),
  game:document.getElementById('syncGame').value}}
document.getElementById('syncTest').onclick=async()=>{
  const a=syncArg();sTip.textContent='测试中…';
  try{
    const r=await fetch('/sync/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a)});
    const j=await r.json();
    sTip.textContent=j.ok?('连接成功 ✓ 游戏数 '+j.games):('连接失败：'+(j.error||'未知错误'));
  }catch(e){sTip.textContent='请求失败：'+e.message}
};
let syncTimer=null;
function paintSync(s){
  const pct=s.total?Math.round(s.done/s.total*100):0;
  sBar.style.width=pct+'%';
  sProg.textContent=s.phase+' · '+s.done+'/'+s.total+' · 新增 '+s.copied+' · 跳过 '+s.skipped+' · 失败 '+s.failed;
  if(!s.running){clearInterval(syncTimer);syncTimer=null;
    sTip.textContent=s.log.length?('最近错误：'+s.log.slice(-2).join(' | ')):'同步结束，刷新页面查看新图片'}
}
document.getElementById('syncRun').onclick=async()=>{
  const a=syncArg();sTip.textContent='正在启动同步…';
  try{
    const r=await fetch('/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a)});
    const j=await r.json();
    if(!j.ok){sTip.textContent='启动失败：'+(j.error||'');return}
    sTip.textContent='同步进行中…';
    if(syncTimer)clearInterval(syncTimer);
    syncTimer=setInterval(async()=>{
      try{paintSync(await (await fetch('/sync/status')).json())}catch(e){}
    },800);
  }catch(e){sTip.textContent='请求失败：'+e.message}
};
const lb=document.getElementById('lb'),lbBody=document.getElementById('lbBody'),lbTitle=document.getElementById('lbTitle');
const GAME_NAME={'genshin':'原神','starrail':'崩坏：星穹铁道','zzz':'绝区零'};
const GAMES=['genshin','starrail','zzz'];
const ELEM_ORDER=['岩','火','水','风','雷','冰','草','物理','量子','虚数','旅行者','电','以太','流明','其他'];
let gActive=null,gSearch='',gStars=new Set();
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function grades(){return ['r','r17','r18'].filter(g=>document.getElementById('g_'+g).checked)}
function syncCk(){['r','r17','r18'].forEach(g=>{const c=document.getElementById('g_'+g);if(c&&c.parentNode)c.parentNode.classList.toggle('on',!!c.checked)})}
function gradeTotals(game){const t={r:0,r17:0,r18:0};for(const n of Object.keys(REPO[game]||{})){const im=(REPO[game][n].imgs)||{};for(const k of ['r','r17','r18'])t[k]+=(im[k]||[]).length}return t}
function imgsOf(en){const gs=grades();let out=[];for(const g of gs)out=out.concat((en.imgs&&en.imgs[g])||[]);return out}
function srcOf(i){return '/img?s='+i.s+'&p='+encodeURIComponent(i.p)}
function renderTabs(){
  document.querySelectorAll('.gtab').forEach(t=>t.classList.toggle('active',t.dataset.g===gActive));
}
function starsAvail(game){
  const s=new Set();
  for(const n of Object.keys(REPO[game]||{})){const st=(REPO[game][n].star)||0;if(st)s.add(String(st))}
  return s;
}
function renderStars(){
  const box=document.getElementById('gstar');box.innerHTML='';
  for(const s of ['5','4','3','2','1']){
    if(!starsAvail(gActive).has(s))continue;
    const el=document.createElement('div');
    el.className='chip'+(gStars.has(s)?' on':'');el.textContent='★'+s;
    el.onclick=()=>{gStars.has(s)?gStars.delete(s):gStars.add(s);render()};
    box.appendChild(el);
  }
}
function render(){
  renderTabs();
  const gal=document.getElementById('gal');
  const chars=REPO[gActive]||{};
  const q=gSearch.trim();
  const byElem={};let nChar=0,nImg=0,shownChar=0;
  for(const n of Object.keys(chars)){
    const en=chars[n];const imgs=imgsOf(en);
    if(!imgs.length)continue;
    nChar++;nImg+=imgs.length;
    if(q&&!n.includes(q))continue;
    if(gStars.size&&!gStars.has(String(en.star||0)))continue;
    const e=en.elem||'其他';(byElem[e]||(byElem[e]=[])).push(n);
  }
  const elems=Object.keys(byElem).sort((a,b)=>ELEM_ORDER.indexOf(a)-ELEM_ORDER.indexOf(b));
  let html='';
  for(const e of elems){
    const list=byElem[e].slice().sort((a,b)=>(chars[b].star-chars[a].star)||a.localeCompare(b,'zh'));
    const byStar={};for(const n of list)(byStar[chars[n].star]||(byStar[chars[n].star]=[])).push(n);
    let inner='';
    for(const s of Object.keys(byStar).sort((a,b)=>b-a)){
      shownChar+=byStar[s].length;
      inner+='<div class="starblock"><div class="starlabel">'+'★'.repeat(parseInt(s))+' '+s+' 星 ('+byStar[s].length+')</div><div class="cards">';
      for(const n of byStar[s]){
        const en=chars[n];const imgs=imgsOf(en);
        inner+='<div class="card rarity-'+(en.star||0)+'" data-g="'+gActive+'" data-c="'+esc(n)+'" title="'+esc(n)+'">'+
          '<div class="card-bg"><img class="card-face" src="'+srcOf(imgs[0])+'" loading="lazy" alt="'+esc(n)+'"/>'+
          '<span class="badge">'+imgs.length+'</span></div>'+
          '<div class="card-info"><div class="card-stars">'+'★'.repeat(en.star||0)+'</div>'+
          '<div class="card-name">'+esc(n)+'</div></div></div>';
      }
      inner+='</div></div>';
    }
    html+='<div class="egroup"><div class="egroup-head">'+
      '<img class="eicon" src="/elem?g='+gActive+'&e='+encodeURIComponent(e)+'" onerror="this.style.display=&quot;none&quot;" alt="'+esc(e)+'"/>'+
      '<span class="ename">'+esc(e)+'</span><span class="cnt">'+list.length+' 个</span></div>'+inner+'</div>';
  }
  if(!html){
    let msg;
    if(nChar){ msg='没有匹配的角色（搜索或星级筛选太严）' }
    else{
      const t=gradeTotals(gActive),gs=grades();
      const empty=gs.filter(g=>!t[g]).map(g=>g.toUpperCase());
      if(gs.length&&empty.length===gs.length){
        msg='所选分级均无图片'+(empty.length?'（'+empty.join(' / ')+'）':'')+
          '：图片放到 resources/MLY-MBT/&lt;游戏&gt;/'+empty.join('/')+'/normal-character/&lt;角色&gt;/';
      } else msg='当前筛选下没有图片';
    }
    html='<p class="empty">'+msg+'</p>';
  }
  gal.innerHTML=html;
  document.getElementById('gtip').innerHTML='总数 <b>'+nChar+'</b> 角色 · <b>'+nImg+'</b> 张 · 当前显示 <b>'+shownChar+'</b>';
}
function openLb(g,c){
  const en=(REPO[g]||{})[c];if(!en)return;
  const imgs=imgsOf(en);
  lbBody.innerHTML=imgs.map(i=>'<img src="'+srcOf(i)+'">').join('');
  lbTitle.textContent=c+' · '+imgs.length+' 张';
  lb.classList.add('on');
}
document.getElementById('lbClose').onclick=()=>lb.classList.remove('on');
lb.onclick=e=>{if(e.target===lb)lb.classList.remove('on')};
document.addEventListener('keydown',e=>{if(e.key==='Escape')lb.classList.remove('on')});
document.addEventListener('click',e=>{
  const card=e.target.closest('.card[data-c]');
  if(card){openLb(card.dataset.g,card.dataset.c);return}
  const gh=e.target.closest('.egroup-head');
  if(gh){gh.parentNode.classList.toggle('collapsed')}
});
document.getElementById('gsearch').oninput=e=>{gSearch=e.target.value;render()};
function buildTabs(){
  const box=document.getElementById('gtabs');box.innerHTML='';
  for(const g of GAMES){
    const t=document.createElement('div');
    t.className='gtab';t.dataset.g=g;t.textContent=GAME_NAME[g];
    t.onclick=()=>{if(gActive===g)return;gActive=g;gStars.clear();renderStars();render()};
    box.appendChild(t);
  }
}
gActive=GAMES.find(g=>Object.keys(REPO[g]||{}).length)||'genshin';
buildTabs();renderStars();syncCk();render();
</script>
</body></html>`
}

// 让 miao 面板命令（#刻晴面板 等）优先使用 MBT 仓库立绘，并对 R17/R18 做权限拦截
// 思路：覆写 ProfileAvatar.getCostumeSplash —— MBT 仓库 R 级优先；无则回落 miao 候选池，
// 按请求级权限（reqStore）过滤 R17/R18，非授权者看不到 R18，最终回落 meta 默认立绘（原图）。
// 权限上下文在 ProfileDetail.render 内用 AsyncLocalStorage 写入，并发安全。
async function patchMiaoCostume() {
  try {
    const paMod = await import('../../miao-plugin/models/avatar/ProfileAvatar.js')
    const ProfileAvatar = paMod.default
    const ciMod = await import('../../miao-plugin/models/character/CharImg.js')
    const CharImg = ciMod.default
    const pdMod = await import('../../miao-plugin/apps/profile/ProfileDetail.js')
    const ProfileDetail = pdMod.default
    if (!ProfileAvatar || typeof ProfileAvatar.getCostumeSplash !== 'function') return
    if (ProfileAvatar.__mlyPatched) return
    const orig = ProfileAvatar.getCostumeSplash.bind(ProfileAvatar)

    ProfileAvatar.getCostumeSplash = function (profile, game = 'gs') {
      const cfg = loadCfg()
      if (!cfg.intercept) return orig(profile, game)
      const name = profile?.name
      if (name) {
        const gdir = game === 'sr' ? 'starrail' : game === 'zzz' ? 'zzz' : 'genshin'
        // 1) MBT 仓库：按 R/R17/R18 开关 + 权限，读对应分级目录（与 #MLY 命令一致）
        const ctx = reqStore.getStore() || {}
        const okR17 = !!ctx.allowR17
        const okR18 = !!ctx.allowR18
        const repoImgs = []
        for (const [lvl, on] of [['R', !!cfg.r], ['R17', okR17], ['R18', okR18]]) {
          if (!on) continue
          const dir = path.join(MLY_MBT, gdir, lvl, 'normal-character', name)
          for (const f of listImages(dir)) repoImgs.push(path.join(dir, f))
        }
        if (repoImgs.length) return pathToFileURL(lodash.sample(repoImgs)).href
        // 2) 回落 miao 候选池，按权限过滤 R17/R18
        try {
          const pool = CharImg.getProfileImgPool(name, false)
          if (Array.isArray(pool) && pool.length) {
            const allowed = pool.filter(p => {
              const g = gradeOf(p)
              if (g === 'r' || g === '') return true
              if (g === 'r17') return okR17
              if (g === 'r18') return okR18
              return true
            })
            if (allowed.length) return lodash.sample(allowed)
          }
          // 3) 回落 meta 默认立绘（原图），绝不返回 R18
          const ch = profile.char
          if (ch && typeof ch.getImgs === 'function') {
            const imgs = (game === 'sr' && typeof ch.getImgsSr === 'function')
              ? ch.getImgsSr(profile._costume)
              : ch.getImgs(profile._costume)
            if (imgs && imgs.splash) return imgs.splash
          }
        } catch (e2) { try { Bot.makeLog('error', 'MLY costume fallback: ' + e2.message, 'Plugin') } catch {} }
      }
      return orig(profile, game)
    }
    ProfileAvatar.__mlyPatched = true

    // 在 miao 渲染面板时写入请求级权限上下文（并发安全）
    if (ProfileDetail && typeof ProfileDetail.render === 'function' && !ProfileDetail.__mlyRenderPatched) {
      const origRender = ProfileDetail.render.bind(ProfileDetail)
      ProfileDetail.render = async function (e, char, mode, params) {
        const cfg = loadCfg()
        // 注意：不要用 allowR18 / allowR17 作变量名，会遮蔽同名的模块级函数导致 TDZ 报错
        const canR18 = cfg.r18 === true && allowR18(cfg, e)
        const canR17 = cfg.r17 === true && (cfg.r18_view || '无人') !== '无人'
        return reqStore.run({ allowR18: canR18, allowR17: canR17 }, () => origRender(e, char, mode, params))
      }
      ProfileDetail.__mlyRenderPatched = true
    }

    try { Bot.makeLog('info', 'MLY: 已注入 miao 面板立绘拦截（R 级优先 + R17/R18 权限）', 'Plugin') } catch {}
  } catch (e) {
    try { Bot.makeLog('error', 'MLY: 注入 miao 立绘拦截失败: ' + e.message, 'Plugin') } catch {}
  }
}

let syncState = { running: false, phase: '空闲', total: 0, done: 0, copied: 0, skipped: 0, failed: 0, log: [] }

/** 从 Gamewiki(11002) 拉取仓库图片到 resources/MLY-MBT/<游戏>/<分级>/normal-character/<角色>/ */
async function runSync(host, port, onlyGame) {
  const base = `http://${host}:${port}`
  syncState = { running: true, phase: '获取清单…', total: 0, done: 0, copied: 0, skipped: 0, failed: 0, log: [] }
  try {
    const mr = await fetch(`${base}/api/sync${onlyGame ? '?game=' + encodeURIComponent(onlyGame) : ''}`)
    if (!mr.ok) throw new Error(`获取清单失败 HTTP ${mr.status}（请确认 Gamewiki 已启动、IP 与端口正确）`)
    const rj = await mr.json()
    if (!rj.games) throw new Error('接口返回异常：' + JSON.stringify(rj).slice(0, 80))
    for (const info of Object.values(rj.games || {})) {
      for (const c of info.chars) for (const lvl of LEVELS) syncState.total += ((c.levels || {})[lvl] || 0)
    }
    syncState.phase = '下载中…'
    for (const [g, info] of Object.entries(rj.games || {})) {
      if (onlyGame && onlyGame !== g) continue
      const dir0 = info.dir || g   // 插件仓库里的游戏目录名（genshin / starrail / zzz）
      for (const c of info.chars) {
        for (const lvl of LEVELS) {
          if (!((c.levels || {})[lvl])) continue
          let files = []
          try {
            const fr = await fetch(`${base}/api/sync/files?game=${encodeURIComponent(g)}` +
              `&name=${encodeURIComponent(c.name)}&level=${encodeURIComponent(lvl)}`)
            files = (await fr.json()).files || []
          } catch (e) {
            syncState.failed++
            syncState.log.push(`${c.name} ${lvl} 列表失败: ${e.message}`)
            continue
          }
          const dir = path.join(MLY_MBT, dir0, lvl, 'normal-character', c.name)
          for (const f of files) {
            const dest = path.join(dir, f.f)
            try {
              if (fs.existsSync(dest) && fs.statSync(dest).size === f.size) {
                syncState.skipped++
              } else {
                const ir = await fetch(`${base}/repo-img?g=${encodeURIComponent(g)}` +
                  `&l=${encodeURIComponent(lvl)}&n=${encodeURIComponent(c.name)}&f=${encodeURIComponent(f.f)}`)
                if (!ir.ok) throw new Error('HTTP ' + ir.status)
                const buf = Buffer.from(await ir.arrayBuffer())
                fs.mkdirSync(dir, { recursive: true })
                fs.writeFileSync(dest, buf)
                syncState.copied++
              }
            } catch (e) {
              syncState.failed++
              syncState.log.push(`${c.name}/${f.f}: ${e.message}`.slice(0, 120))
            }
            syncState.done++
          }
        }
      }
    }
    syncState.phase = '完成'
  } catch (e) {
    syncState.phase = '失败: ' + e.message
    syncState.log.push(String(e.message))
  }
  syncState.running = false
}

let _server = null
function startServer() {
  if (_server) return _server
  _server = http.createServer(async (req, res) => {
    let u
    try { u = new URL(req.url, 'http://localhost') } catch { res.writeHead(400); res.end('bad url'); return }
    const p = u.pathname
    try {
      if (req.method === 'POST' && p === '/set') {
        let body = ''
        for await (const c of req) body += c
        const d = JSON.parse(body)
        const c = loadCfg()
        if (['无人', '主人', '所有人'].includes(d.r18_view)) c.r18_view = d.r18_view
        if (typeof d.r === 'boolean') c.r = d.r
        if (typeof d.r17 === 'boolean') c.r17 = d.r17
        if (typeof d.r18 === 'boolean') c.r18 = d.r18
        if (typeof d.intercept === 'boolean') c.intercept = d.intercept
        saveCfg(c)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, cfg: c }))
        return
      }
      if (req.method === 'POST' && p === '/sync/test') {
        let body = ''
        for await (const c of req) body += c
        const d0 = JSON.parse(body || '{}')
        const host = (d0.host || '127.0.0.1').trim()
        const port = parseInt(d0.port || 11002, 10)
        try {
          const r = await fetch(`http://${host}:${port}/api/config`)
          if (!r.ok) throw new Error('HTTP ' + r.status)
          const j = await r.json()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, games: Object.keys(j.games || {}).length }))
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
        return
      }
      if (req.method === 'POST' && p === '/sync') {
        let body = ''
        for await (const c of req) body += c
        const d0 = JSON.parse(body || '{}')
        const host = (d0.host || '127.0.0.1').trim()
        const port = parseInt(d0.port || 11002, 10)
        const cfg = loadCfg()
        cfg.syncHost = host
        cfg.syncPort = port
        saveCfg(cfg)
        if (syncState.running) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: '同步正在进行中' }))
          return
        }
        runSync(host, port, (d0 && d0.game) || '')   // 异步执行，前端轮询 /sync/status
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, started: true }))
        return
      }
      if (p === '/sync/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(syncState))
        return
      }
      if (p === '/img') {
        const s = u.searchParams.get('s') || 'mly'
        const rel = decodeURIComponent(u.searchParams.get('p') || '')
        const fp = safeJoin(IMG_ROOTS[s] || MLY_MBT, rel)
        if (!fp || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); res.end('404'); return }
        const ext = path.extname(fp).toLowerCase()
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': mime })
        fs.createReadStream(fp).pipe(res)
        return
      }
      if (p === '/elem') {
        // 元素图标：按 游戏+元素 白名单取 Yunzai 自带图标，不接受任意路径
        const g = u.searchParams.get('g') || ''
        const e = decodeURIComponent(u.searchParams.get('e') || '')
        const dir = ELEM_DIR[g]
        const fn = (ELEM_FILE[g] || {})[e]
        const fp = (dir && fn) ? path.join(dir, fn) : ''
        if (!fp || !fs.existsSync(fp)) { res.writeHead(404); res.end('404'); return }
        const ext = path.extname(fp).toLowerCase()
        const mime = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' }[ext] || 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': mime })
        fs.createReadStream(fp).pipe(res)
        return
      }
      if (p === '/' || p === '') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(renderAdmin(loadCfg()))
        return
      }
      res.writeHead(404); res.end('404')
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('err: ' + err)
    }
  })
  _server.listen(WEB_PORT, '0.0.0.0', () => {
    try {
      logger.info(`MLY 面板图 Web 管理已启动 http://localhost:${WEB_PORT}`)
      logger.info(`MLY作者提醒你：第一次使用请到Web确认 ${logger.green('是否接管 miao 面板立绘')} ${logger.green('同步仓库图片')}`)
    } catch {}
  })
  _server.on('error', e => { try { Bot.makeLog('error', `MLY Web 启动失败: ${e.message}`, 'Plugin') } catch {} })
  return _server
}

class MlyPanel extends plugin {
  constructor() {
    super({
      name: 'mly-panel',
      dsc: 'MLY 面板图（R/R17/R18 分级）',
      event: 'message',
      priority: 5000,
      rule: [
        { reg: '^#MLY面板图帮助$', fnc: 'help' },
        { reg: '^#MLY面板帮助$', fnc: 'help' },
        { reg: '^#MLY面板图设置$', fnc: 'settings' },
        { reg: '^#MLY面板设置$', fnc: 'settings' },
        { reg: '^#Web登录$', fnc: 'webLogin' },
        { reg: '^#Web登入$', fnc: 'webLogin' },
        // 取图：#MLY <角色>（原神）、*MLY <角色>（崩铁）、%MLY <角色>（绝区零）
        // 分级开关 / R18 权限 / 拦截原图 等配置一律到 11001 网页「管理设置」修改
        { reg: '^#MLY\\s+(.+)$', fnc: 'panel' },
        { reg: '^\\*MLY\\s+(.+)$', fnc: 'panel' },
        { reg: '^%MLY\\s+(.+)$', fnc: 'panel' },
      ],
    })
  }

  async init() {
    try { startServer() } catch {}
    try { await patchMiaoCostume() } catch {}
  }

  async help(e) {
    const bg = pathToFileURL(path.join(PLUGIN, '帮助背景图.jpg')).href
    return e.runtime.render('Miao-MBT-MLY-Plugin', 'help/index', { bg })
  }

  async settings(e) {
    const c = loadCfg()
    const bg = pathToFileURL(path.join(PLUGIN, '设置背景图.png')).href
    return e.runtime.render('Miao-MBT-MLY-Plugin', 'settings/index', {
      bg,
      r18_view: c.r18_view,
      r_state: c.r ? '开启' : '关闭',
      r17_state: c.r17 ? '开启' : '关闭',
      r18_state: c.r18 ? '开启' : '关闭',
      intercept_state: c.intercept ? '开启' : '关闭',
    })
  }

  async webLogin(e) {
    if (!e.isMaster) return this.reply('仅主人可使用 #Web登录')
    startServer()
    return this.reply(`MLY 面板图管理页已开启：http://localhost:${WEB_PORT}\n（局域网/外网访问请改用本机 IP:${WEB_PORT}）`)
  }

  async panel(e) {
    // 用法：<符号>MLY <角色> [序号|all]，符号决定游戏（# 原神 / * 崩铁 / % 绝区零）
    const short = e.msg.match(/^([#*%])MLY\s+(.+)$/)
    if (!short) {
      return this.reply(`用法：#MLY <角色>（原神） · *MLY <角色>（崩铁） · %MLY <角色>（绝区零），可加 [序号|all]`)
    }
    const game = GAME_PREFIX[short[1]] || ''
    const rest = short[2]
    if (!game) {
      return this.reply(`未知游戏，支持：# 原神 / * 崩铁 / % 绝区零`)
    }
    const parts = rest.trim().split(/\s+/)
    const char = parts.shift()
    if (!char) {
      return this.reply(`请指定角色。用法：${PREFIX_OF[game]}MLY <角色> [序号|all]（${GAME_NAME[game]}）`)
    }
    const idxRaw = parts.shift() || '1'
    const cfg = loadCfg()
    const files = this.collectImages(game, char, cfg, e)
    if (!files.length) {
      return this.reply(
        `未找到「${char}」的可用图片。\n` +
          `R 级图源 MLY-MBT/${game}/R/normal-character/${char}/ 为空，请放入图片（R17/R18 可平铺在 ` +
          `${game === 'zzz' ? 'ZZZ-Plugin/resources/panel/images' : 'miao-plugin/resources/profile/normal-character'}/${char}/，文件名含 r17/r18 标记）`
      )
    }
    return this.sendImages(files, idxRaw)
  }

  collectImages(game, char, cfg, e) {
    const isZZZ = game === 'zzz'
    const base = isZZZ ? ZZZ_IMAGES : MIAO_PROFILE
    const miaoDir = path.join(base, char)
    const repo = path.join(MLY_MBT, game, 'R', 'normal-character', char)
    const files = []
    // 1) R 级图：优先使用 MBT 仓库（受 cfg.r 开关控制，关掉则不发 R 级图）
    if (cfg.r) for (const f of listImages(repo)) files.push(path.join(repo, f))
    // 2) R17/R18：MBT 仓库的 R17 / R18 目录（按开关+权限）
    for (const lvl of ['R17', 'R18']) {
      if (lvl === 'R17' && !cfg.r17) continue
      if (lvl === 'R18' && !(cfg.r18 && allowR18(cfg, e))) continue
      const dir = path.join(MLY_MBT, game, lvl, 'normal-character', char)
      if (!fs.existsSync(dir)) continue
      for (const f of listImages(dir)) files.push(path.join(dir, f))
    }
    // 3) miao/ZZZ 候选池（文件名含 r17/r18），按开关叠加
    for (const f of listImages(miaoDir)) {
      const g = gradeOf(f)
      if (g === 'r17') {
        if (cfg.r17) files.push(path.join(miaoDir, f))
      } else if (g === 'r18') {
        if (cfg.r18 && allowR18(cfg, e)) files.push(path.join(miaoDir, f))
      }
    }
    return files
  }

  async sendImages(files, idxRaw) {
    let targets = []
    if (/^all$/i.test(idxRaw)) targets = files
    else {
      const n = parseInt(idxRaw, 10)
      if (isNaN(n) || n < 1) targets = files.slice(0, 1)
      else targets = files.slice(n - 1, n)
    }
    if (!targets.length) return this.reply('没有可发送的图片')
    for (const f of targets) {
      await this.reply(segment.image(f))
    }
  }
}

export default MlyPanel
