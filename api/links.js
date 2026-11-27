// API da Biblioteca de vídeos (Vercel Function).
// Guarda os vídeos e a mensagem padrão num Postgres do Neon, usando a API HTTP
// do Neon direto com fetch, sem dependências.
//
// GET  /api/links                          -> { links: [...], modelo, donos: [...] }
// POST /api/links { acao: 'salvar',  link }
// POST /api/links { acao: 'importar', links: [...] }
// POST /api/links { acao: 'excluir', id }
// POST /api/links { acao: 'copiado', id }
// POST /api/links { acao: 'modelo',  texto }
// POST /api/links { acao: 'dono',    nome }   (cria um novo dono)

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const MAX_LINKS = 5000;
const DONOS_INICIAIS = ['Kauã', 'Maria Julia', 'Central de ajuda'];
const MAX_DONOS = 100;

async function sql(query, params = []) {
  const host = new URL(DB_URL).hostname;
  const r = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': DB_URL },
    body: JSON.stringify({ query, params }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Erro no banco (${r.status})`);
  return data.rows || [];
}

let ready = null;
function setup() {
  ready ??= (async () => {
    await sql(`CREATE TABLE IF NOT EXISTS links (
      id text PRIMARY KEY, titulo text NOT NULL, url text NOT NULL,
      categoria text NOT NULL DEFAULT '', tags text NOT NULL DEFAULT '', mensagem text NOT NULL DEFAULT '',
      criado_em bigint NOT NULL, copiado_em bigint)`);
    await sql(`ALTER TABLE links ADD COLUMN IF NOT EXISTS dono text NOT NULL DEFAULT ''`);
    await sql(`CREATE TABLE IF NOT EXISTS config (chave text PRIMARY KEY, valor text NOT NULL)`);
    await sql(`CREATE TABLE IF NOT EXISTS donos (nome text PRIMARY KEY, criado_em bigint NOT NULL)`);
    const vals = DONOS_INICIAIS.map((_, i) => `($${i + 1}, ${i + 1})`).join(', ');
    await sql(`INSERT INTO donos (nome, criado_em) VALUES ${vals} ON CONFLICT (nome) DO NOTHING`, DONOS_INICIAIS);
  })().catch(e => { ready = null; throw e; });
  return ready;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const listDonos = async () => (await sql('SELECT nome FROM donos ORDER BY criado_em, nome')).map(r => r.nome);

function clean(l, donos) {
  if (!l || typeof l !== 'object') throw new Error('Vídeo inválido.');
  const v = {
    id: str(l.id, 40), titulo: str(l.titulo, 160), url: str(l.url, 2000),
    categoria: str(l.categoria, 60), dono: str(l.dono, 60), tags: str(l.tags, 200), mensagem: str(l.mensagem, 1000),
    criadoEm: Number.isFinite(l.criadoEm) ? Math.trunc(l.criadoEm) : Date.now(),
  };
  if (!/^[a-z0-9]{4,40}$/i.test(v.id)) throw new Error('Identificador inválido.');
  if (!v.titulo) throw new Error('Informe o título.');
  if (!/^https?:\/\/\S+$/i.test(v.url)) throw new Error('O link precisa começar com https://');
  if (!donos.includes(v.dono)) throw new Error('Selecione de quem é o vídeo.');
  return v;
}

async function upsert(v) {
  await sql(`INSERT INTO links (id, titulo, url, categoria, tags, mensagem, criado_em, dono)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (id) DO UPDATE SET titulo=$2, url=$3, categoria=$4, tags=$5, mensagem=$6, dono=$8`,
    [v.id, v.titulo, v.url, v.categoria, v.tags, v.mensagem, v.criadoEm, v.dono]);
}

async function room(n) {
  const [{ total }] = await sql('SELECT count(*)::int AS total FROM links');
  if (total + n > MAX_LINKS) throw new Error(`Limite de ${MAX_LINKS} vídeos atingido.`);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!DB_URL) return res.status(500).json({ erro: 'Banco de dados não configurado.' });
  try {
    await setup();

    if (req.method === 'GET') {
      const rows = await sql('SELECT * FROM links ORDER BY criado_em DESC');
      const [cfg] = await sql("SELECT valor FROM config WHERE chave='modelo'");
      const donos = await listDonos();
      return res.status(200).json({
        links: rows.map(r => ({
          id: r.id, titulo: r.titulo, url: r.url, categoria: r.categoria, dono: r.dono || '', tags: r.tags, mensagem: r.mensagem,
          criadoEm: Number(r.criado_em), copiadoEm: r.copiado_em == null ? null : Number(r.copiado_em),
        })),
        modelo: cfg ? cfg.valor : null,
        donos,
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    switch (b.acao) {
      case 'salvar': {
        const v = clean(b.link, await listDonos());
        const [existe] = await sql('SELECT 1 FROM links WHERE id=$1', [v.id]);
        if (!existe) await room(1);
        await upsert(v);
        break;
      }
      case 'importar': {
        if (!Array.isArray(b.links) || b.links.length > 500) throw new Error('Lista inválida (máximo 500 por vez).');
        const donos = await listDonos();
        const vs = b.links.map(l => clean(l, donos));
        await room(vs.length);
        for (const v of vs) await upsert(v);
        break;
      }
      case 'excluir':
        await sql('DELETE FROM links WHERE id=$1', [str(b.id, 40)]);
        break;
      case 'copiado':
        await sql('UPDATE links SET copiado_em=$2 WHERE id=$1', [str(b.id, 40), Date.now()]);
        break;
      case 'modelo':
        await sql(`INSERT INTO config (chave, valor) VALUES ('modelo', $1)
          ON CONFLICT (chave) DO UPDATE SET valor=$1`, [str(b.texto, 1000)]);
        break;
      case 'dono': {
        const nome = str(b.nome, 60);
        if (!nome) throw new Error('Informe o nome do dono.');
        const donos = await listDonos();
        const igual = donos.find(d => d.localeCompare(nome, 'pt-BR', { sensitivity: 'accent' }) === 0);
        if (igual) return res.status(200).json({ ok: true, nome: igual });
        if (donos.length >= MAX_DONOS) throw new Error(`Limite de ${MAX_DONOS} donos atingido.`);
        await sql('INSERT INTO donos (nome, criado_em) VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING', [nome, Date.now()]);
        return res.status(200).json({ ok: true, nome });
      }
      default:
        return res.status(400).json({ erro: 'Ação desconhecida.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    const msg = String(e && e.message || e);
    const doUsuario = /inválid|Informe|precisa|Limite|Selecione/.test(msg);
    if (!doUsuario) console.error(e);
    return res.status(doUsuario ? 400 : 500).json({ erro: doUsuario ? msg : 'Não foi possível acessar o banco de dados.' });
  }
};
