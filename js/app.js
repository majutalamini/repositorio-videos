// Biblioteca de vídeos: busca, categorias, cadastro e cópia com mensagem.
// Os componentes visuais (modais e toast) são do Bootstrap 5; aqui fica só a lógica da aplicação.
{
const $ = id => document.getElementById(id);
const DEF_TPL = 'Confira esse vídeo que eu preparei sobre {titulo}:\n{link}';
const STOP = new Set('de da do das dos o a os as e em no na nos nas um uma uns umas para pra por com como que se ao aos sobre video videos'.split(' '));
const ICON_COPY = '<svg class="ic" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>';
const ICON_LINK = '<svg class="ic" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
const ICON_OPEN = '<svg class="ic" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const ICON_EDIT = '<svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';

let links = [], tpl = DEF_TPL, cat = '', editing = null, local = false, shown = [], loading = true;

const bs = window.bootstrap;
const modal = id => bs ? bs.Modal.getOrCreateInstance($(id)) : null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function toast(t){
  $('toastMsg').textContent = t;
  if (bs) bs.Toast.getOrCreateInstance($('toast')).show();
}
function showErr(id, t){ const el=$(id); el.textContent=t; el.classList.toggle('d-none', !t); }

/* ---------- busca inteligente ---------- */
function lev(a,b){ if(Math.abs(a.length-b.length)>2) return 9; let p=[...Array(b.length+1).keys()];
  for(let i=1;i<=a.length;i++){ const c=[i]; for(let j=1;j<=b.length;j++) c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1)); p=c; } return p[b.length]; }

function score(l, toks){
  if(!toks.length) return {s:1,m:[]};
  const tw = words(l.titulo), ow = words((l.categoria||'')+' '+(l.tags||'')), hay = norm(l.titulo+' '+(l.categoria||'')+' '+(l.tags||''));
  let s=0, hit=0; const m=[];
  for(const t of toks){
    const tol = t.length>6 ? 2 : 1;
    let best=0, mark=null;
    for(const w of tw){ let v=0;
      if(w===t) v=4; else if(w.startsWith(t)) v=3;
      else if(t.length>=4 && (lev(t, w.slice(0,t.length+1))<=tol || lev(t,w)<=tol)) v=2;
      if(v>best){best=v;mark=w;} }
    if(!best) for(const w of ow){ if(w===t||w.startsWith(t)) best=Math.max(best,2.5); else if(t.length>=4&&lev(t,w)<=1) best=Math.max(best,1.5); }
    if(!best && t.length>=3 && hay.includes(t)) best=1;
    if(best){ hit++; s+=best; if(mark) m.push(mark); }
  }
  return {s: hit>=Math.ceil(toks.length*0.6) ? s+hit*3 : 0, m};
}

function highlight(text, marks){
  if(!marks.length) return esc(text);
  const n=[...text].map(c=>norm(c)); if(n.some(x=>x.length!==1)) return esc(text);
  const flat=n.join(''), on=new Array(flat.length).fill(false);
  for(const w of marks){ let i=-1; while((i=flat.indexOf(w,i+1))>-1){ if(i===0||!/[a-z0-9]/.test(flat[i-1])) for(let k=i;k<i+w.length;k++) on[k]=true; } }
  let out='', open=false;
  [...text].forEach((c,i)=>{ if(on[i]&&!open){out+='<mark>';open=true;} if(!on[i]&&open){out+='</mark>';open=false;} out+=esc(c); });
  return out+(open?'</mark>':'');
}

/* ---------- mensagem ---------- */
function message(l){
  const t=l.titulo||'';
  const low = t.length>1 && t[1]===t[1].toLowerCase() ? t[0].toLowerCase()+t.slice(1) : t;
  const raw = l.mensagem||tpl, url = l.url||'';
  const txt = raw.replaceAll('{titulo}',low).replaceAll('{Titulo}',t).replaceAll('{link}',url).replaceAll('{categoria}',l.categoria||'');
  // Garante que o link sempre vá junto, mesmo se a mensagem não tiver {link}
  return raw.includes('{link}') || !url ? txt : txt.trimEnd()+'\n'+url;
}

/* ---------- tela ---------- */
function cats(){ const m=new Map(); for(const l of links){ const c=(l.categoria||'').trim()||'Sem categoria'; m.set(c,(m.get(c)||0)+1); } return [...m].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR')); }

function render(){
  const toks=words($('q').value.trim()).filter(w=>!STOP.has(w)), sort=$('sort').value, cs=cats();
  $('cats').innerHTML = [['',links.length],...cs].map(([c,n])=>{ const on=c===cat;
    return `<button type="button" class="btn btn-sm rounded-pill ${on?'btn-success':'btn-outline-secondary'}" data-c="${esc(c)}" aria-pressed="${on}">${c?esc(c):'Todos'} <span class="badge rounded-pill ${on?'text-bg-dark':'text-bg-secondary'} ms-1">${n}</span></button>`; }).join('');
  $('catList').innerHTML = cs.filter(([c])=>c!=='Sem categoria').map(([c])=>`<option value="${esc(c)}">`).join('');
  $('count').textContent = links.length ? `${links.length} vídeo${links.length>1?'s':''} · ${cs.length} categoria${cs.length>1?'s':''}` : 'Nenhum vídeo salvo ainda';

  const r = links.filter(l=>!cat || ((l.categoria||'').trim()||'Sem categoria')===cat).map(l=>({l,...score(l,toks)})).filter(x=>x.s>0);
  const by = {new:(a,b)=>(b.l.criadoEm||0)-(a.l.criadoEm||0), az:(a,b)=>a.l.titulo.localeCompare(b.l.titulo,'pt-BR'), used:(a,b)=>(b.l.copiadoEm||0)-(a.l.copiadoEm||0)};
  r.sort(sort==='rel' ? (toks.length ? (a,b)=>b.s-a.s||a.l.titulo.localeCompare(b.l.titulo,'pt-BR') : by.new) : by[sort]);
  shown = r.map(x=>x.l);
  $('info').textContent = toks.length||cat ? `${r.length} resultado${r.length===1?'':'s'}` : '';

  $('list').innerHTML = r.map(({l,m},i)=>`
    <article class="card video border rounded-4${i===0&&toks.length?' top':''}" data-id="${esc(l.id)}">
      <div class="card-body p-3 p-md-4">
        <div class="row g-3 align-items-center">
          <div class="col-lg">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
              <span class="badge rounded-pill text-bg-success">${esc(l.categoria||'Sem categoria')}</span>
              ${i===0&&toks.length?'<span class="small text-success">Enter copia este</span>':''}
            </div>
            <h3 class="h6 fw-semibold mb-1">${highlight(l.titulo,m)}</h3>
            <div class="small text-body-secondary text-truncate url">${esc(l.url)}</div>
            <p class="small text-body-secondary mb-0 mt-2 msg">${esc(message(l))}</p>
          </div>
          <div class="col-lg-auto d-flex flex-wrap gap-2">
            <button class="btn btn-success fw-semibold" data-a="msg">${ICON_COPY}Copiar mensagem com link</button>
            ${/^https:\/\//i.test(l.url)?`<a class="btn btn-outline-success" href="${esc(l.url)}" target="_blank" rel="noopener" aria-label="Abrir ${esc(l.titulo)}">${ICON_OPEN}Abrir</a>`:''}
            <button class="btn btn-link text-body-secondary" data-a="edit" aria-label="Editar ${esc(l.titulo)}">${ICON_EDIT}Editar</button>
          </div>
        </div>
      </div>
    </article>`).join('');

  $('empty').innerHTML = loading ? '' : !links.length
    ? `<div class="vazio rounded-4 text-center p-5 mt-2"><h2 class="h4 fw-bold">Sua biblioteca está vazia</h2><p class="text-body-secondary">Adicione o primeiro vídeo ou cole a lista que hoje está no Discord.</p>
       <div class="d-flex flex-wrap justify-content-center gap-2"><button class="btn btn-success fw-semibold" data-e="new">Novo vídeo</button><button class="btn btn-outline-light" data-e="imp">Importar lista</button></div></div>`
    : !r.length ? `<div class="vazio rounded-4 text-center p-5 mt-2"><h2 class="h5 fw-bold">Nada encontrado</h2><p class="text-body-secondary mb-0">Tente outra palavra${cat?' ou remova o filtro de categoria':''}.</p></div>` : '';
}

/* ---------- armazenamento ---------- */
// Na Vercel os dados ficam no banco (api/links.js); aberto direto do computador, no navegador.
const API='/api/links';
function persist(){ try{ localStorage.setItem('videoteca', JSON.stringify({links,tpl})); }catch(e){} }
async function api(body){
  const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.erro||'Não foi possível salvar. Tente de novo.');
  return d;
}
function putLocal(l){ const i=links.findIndex(x=>x.id===l.id); i>-1?links[i]=l:links.push(l); }
async function saveLink(l){ if(!local) await api({acao:'salvar',link:l}); putLocal(l); if(local) persist(); render(); }
async function saveMany(ls){ if(!local) await api({acao:'importar',links:ls}); ls.forEach(putLocal); if(local) persist(); render(); }
async function delLink(id){ if(!local) await api({acao:'excluir',id}); links=links.filter(x=>x.id!==id); if(local) persist(); render(); }
async function saveTpl(t){ if(!local) await api({acao:'modelo',texto:t}); tpl=t; if(local) persist(); render(); }
function fail(e){ toast(e&&e.message ? e.message : 'Não foi possível salvar. Tente de novo.'); }

/* ---------- copiar ---------- */
async function copy(text){
  try{ await navigator.clipboard.writeText(text); return true; }
  catch(e){ const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select();
    let ok=false; try{ ok=document.execCommand('copy'); }catch(_){} ta.remove(); return ok; }
}
async function doCopy(l, onlyUrl){
  const ok = await copy(onlyUrl ? l.url : message(l));
  toast(ok ? (onlyUrl ? 'Link copiado' : 'Mensagem com link copiada, é só colar para o cliente') : 'O navegador bloqueou a cópia');
  if(!ok) return;
  l.copiadoEm=Date.now();
  if(local) persist(); else api({acao:'copiado',id:l.id}).catch(()=>{});
}

/* ---------- novo / editar ---------- */
function formVal(){ return {titulo:$('fT').value.trim(), url:$('fU').value.trim(), categoria:$('fC').value.trim(), tags:$('fK').value.trim(), mensagem:$('fM').value.trim()}; }
function prevLink(){ const v=formVal(); $('fP').textContent=message({...v, titulo:v.titulo||'título do vídeo', url:v.url||'https://…'}); }
function openLink(l){
  editing=l||null; $('mLinkT').textContent=l?'Editar vídeo':'Novo vídeo';
  $('fDel').classList.toggle('d-none',!l); $('fDelBox').classList.add('d-none'); showErr('fE',''); delete $('fE').dataset.ok;
  $('fT').value=l?.titulo||''; $('fU').value=l?.url||''; $('fC').value=l?.categoria||(cat&&cat!=='Sem categoria'?cat:''); $('fK').value=l?.tags||''; $('fM').value=l?.mensagem||'';
  prevLink(); modal('mLink')?.show();
}
['fT','fU','fC','fM'].forEach(id=>$(id).addEventListener('input',prevLink));
$('mLink').addEventListener('shown.bs.modal',()=>$('fT').focus());
$('fLink').addEventListener('submit', async e=>{ e.preventDefault(); const v=formVal();
  if(!v.titulo) return showErr('fE','Informe o título.');
  if(!/^https?:\/\/\S+$/i.test(v.url)) return showErr('fE','O link precisa começar com https://');
  const dup=links.find(x=>x.url===v.url && x.id!==editing?.id);
  if(dup && !$('fE').dataset.ok){ $('fE').dataset.ok='1'; return showErr('fE',`Este link já está salvo como “${dup.titulo}”. Clique em Salvar de novo para manter os dois.`); }
  const l={...(editing||{}), ...v, id:editing?.id||uid(), criadoEm:editing?.criadoEm||Date.now()};
  try{ await saveLink(l); modal('mLink')?.hide(); toast(editing?'Vídeo atualizado':'Vídeo salvo'); }catch(err){ fail(err); } });
$('fDel').onclick=()=>$('fDelBox').classList.remove('d-none');
$('fDelNo').onclick=()=>$('fDelBox').classList.add('d-none');
$('fDelOk').onclick=async()=>{ try{ await delLink(editing.id); modal('mLink')?.hide(); toast('Vídeo excluído'); }catch(err){ fail(err); } };

/* ---------- mensagem padrão ---------- */
function prevCfg(){ $('cP').textContent=message({titulo:'Cancelar um título financeiro', url:'https://youtu.be/exemplo', categoria:'Next Fit Pay', mensagem:$('cT').value}); }
$('mCfg').addEventListener('show.bs.modal',()=>{ $('cT').value=tpl; prevCfg(); });
$('cT').addEventListener('input',prevCfg);
$('cR').onclick=()=>{ $('cT').value=DEF_TPL; prevCfg(); };
$('fCfg').addEventListener('submit', async e=>{ e.preventDefault(); try{ await saveTpl($('cT').value.trim()||DEF_TPL); modal('mCfg')?.hide(); toast('Mensagem padrão salva'); }catch(err){ fail(err); } });

/* ---------- importar ---------- */
$('mImp').addEventListener('show.bs.modal',()=>showErr('iE',''));
$('mImp').addEventListener('shown.bs.modal',()=>$('iT').focus());
$('fImp').addEventListener('submit', async e=>{ e.preventDefault(); const def=$('iC').value.trim(), out=[]; let bad=0;
  for(const raw of $('iT').value.split('\n')){ const line=raw.trim(); if(!line) continue;
    const um=line.match(/https?:\/\/\S+/i); if(!um){ bad++; continue; }
    let titulo, categoria=def;
    if(line.includes('|')){ const p=line.split('|').map(s=>s.trim()); titulo=p[0]; categoria=p[2]||def; }
    else titulo=line.replace(um[0],'').replace(/[\s\-–—:]+$/,'').replace(/^[\s\-–—:]+/,'').trim();
    const url=um[0].replace(/[)>,.]+$/,'');
    if(!titulo){ bad++; continue; }
    if(links.some(x=>x.url===url)||out.some(x=>x.url===url)) continue;
    out.push({id:uid(), titulo, url, categoria, tags:'', mensagem:'', criadoEm:Date.now()});
  }
  if(!out.length) return showErr('iE', bad?'Nenhuma linha reconhecida. Cada linha precisa de um título e um link.':'Nada novo para importar.');
  try{ await saveMany(out); modal('mImp')?.hide(); $('iT').value='';
    toast(`${out.length} vídeo${out.length>1?'s':''} importado${out.length>1?'s':''}${bad?` · ${bad} linha(s) ignorada(s)`:''}`); }catch(err){ fail(err); } });

/* ---------- eventos gerais ---------- */
$('bNew').onclick=()=>openLink();
$('q').addEventListener('input',render);
$('sort').addEventListener('change',render);
$('q').addEventListener('keydown',e=>{ if(e.key==='Enter'&&shown[0]){ e.preventDefault(); doCopy(shown[0]); } if(e.key==='Escape'){ $('q').value=''; render(); } });
document.addEventListener('keydown',e=>{ if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!document.querySelector('.modal.show')){ e.preventDefault(); $('q').focus(); } });
$('cats').addEventListener('click',e=>{ const b=e.target.closest('button[data-c]'); if(!b) return; cat=b.dataset.c===cat?'':b.dataset.c; render(); });
$('list').addEventListener('click',e=>{ const b=e.target.closest('button[data-a]'); if(!b) return; const l=links.find(x=>x.id===b.closest('[data-id]').dataset.id); if(!l) return;
  if(b.dataset.a==='edit') openLink(l); else doCopy(l, b.dataset.a==='url'); });
$('empty').addEventListener('click',e=>{ const b=e.target.closest('[data-e]'); if(!b) return; b.dataset.e==='new' ? openLink() : modal('mImp')?.show(); });

/* ---------- inicialização ---------- */
const LOCAL_MSG='Modo local: os vídeos ficam salvos só neste navegador.';
const NUVEM_MSG='Salvo na nuvem: todo mundo com o link vê os mesmos vídeos.';
function readLocal(){ try{ const d=JSON.parse(localStorage.getItem('videoteca')||'{}'); return {links:Array.isArray(d.links)?d.links:[], tpl:d.tpl||''}; }catch(e){ return {links:[],tpl:''}; } }
function useLocal(){ local=true; loading=false; const d=readLocal(); links=d.links; tpl=d.tpl||DEF_TPL; $('mode').textContent=LOCAL_MSG; render(); }

async function load(){
  const r=await fetch(API,{cache:'no-store'});
  const ct=r.headers.get('content-type')||'';
  if(!r.ok||!ct.includes('json')) throw new Error('sem api');
  const d=await r.json();
  links=d.links.filter(l=>typeof l.titulo==='string'&&typeof l.url==='string');
  tpl=d.modelo||DEF_TPL; loading=false;
  if(!document.querySelector('.modal.show')) render();
}

// Vídeos que ficaram salvos só neste navegador (antes do banco) podem ser enviados para a nuvem.
function offerLocal(){
  const pend=readLocal().links.filter(l=>l&&l.titulo&&l.url&&!links.some(x=>x.url===l.url));
  if(!pend.length){ $('mode').textContent=NUVEM_MSG; return; }
  $('mode').innerHTML=`${NUVEM_MSG} Há ${pend.length} vídeo${pend.length>1?'s':''} salvo${pend.length>1?'s':''} só neste navegador. <button type="button" class="btn btn-link btn-sm p-0 align-baseline" id="bSync">Enviar para a nuvem</button>`;
  $('bSync').onclick=async()=>{
    try{ await saveMany(pend.map(l=>({id:l.id||uid(),titulo:l.titulo,url:l.url,categoria:l.categoria||'',tags:l.tags||'',mensagem:l.mensagem||'',criadoEm:l.criadoEm||Date.now()})));
      localStorage.removeItem('videoteca'); $('mode').textContent=NUVEM_MSG; toast('Vídeos enviados para a nuvem'); }catch(err){ fail(err); }
  };
}

render();
(async()=>{
  $('mode').textContent='Carregando vídeos…';
  try{ await load(); }catch(e){ return useLocal(); }
  local=false; offerLocal();
  // Atualiza a lista quando alguém mais altera: ao voltar para a aba e a cada 30 s com ela aberta.
  const refresh=()=>{ if(!document.hidden) load().catch(()=>{}); };
  document.addEventListener('visibilitychange',refresh);
  setInterval(refresh,30000);
})();
}
