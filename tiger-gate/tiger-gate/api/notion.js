// Vercel Function: /api/notion
// Lê os bancos do Notion e devolve os fechamentos em JSON.
// Requer a variável de ambiente NOTION_TOKEN na Vercel.

const NOTION_VERSION = "2022-06-28";

const DATABASES = [
  { nome: "Bruna",    id: "2b6d8c28036c81a89ad5f1ce38375595", tipo: "Seguro" },
  { nome: "Caroline", id: "2b6d8c28036c81c8bb34cef88cbb8aed", tipo: "Seguro" },
  { nome: "Adriana",  id: "2b2d8c28036c81b487bdffd20dc0a5f6", tipo: "Seguro" },
  { nome: "MKT",      id: "2d7a8b9d89e447749775c0a28d03e978", tipo: "Marketing" }
];

// ================== CAMPOS QUE SÃO LIDOS DO NOTION ==================
// Para mudar, basta trocar os nomes abaixo. Escreva só um pedaço do nome da coluna
// (não importa maiúscula, minúscula ou acento). Vale o primeiro que for encontrado.
const CAMPOS = {
  Seguro: {
    cliente: ["fechamento", "cliente", "nome"],        // só é usado se a coluna de título estiver vazia
    data: ["data", "dia"],                              // dia do fechamento
    valor: ["valor"],                                   // precisa estar preenchido ([] = não exigir)
    comprovante: ["comprovante", "arquivo", "anexo"]    // precisa ter arquivo ou link ([] = não exigir)
  },
  Marketing: {
    funcionario: ["funcion", "responsavel", "colaborador"], // quem fechou
    data: ["data", "dia"]
  }
};
// O cliente é sempre o nome da página (coluna de título). Nos bancos de Seguro, a
// colaboradora é o nome do banco (lista DATABASES acima).
// ====================================================================

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

// Busca TODAS as páginas do banco (o Notion devolve no máximo 100 por vez)
async function queryDatabase(id) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("Variável NOTION_TOKEN não configurada na Vercel");

  let results = [];
  let cursor;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${id}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 })
    });
    if (!r.ok) throw new Error(`Notion ${r.status}: ${await r.text()}`);
    const data = await r.json();
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function text(prop) {
  if (!prop) return "";
  if (prop.title) return prop.title.map(x => x.plain_text).join("");
  if (prop.rich_text) return prop.rich_text.map(x => x.plain_text).join("");
  if (prop.select) return prop.select.name || "";
  if (prop.multi_select) return prop.multi_select.map(x => x.name).join(", ");
  if (prop.people) return prop.people.map(x => x.name || "").join(", ");
  if (prop.formula) return prop.formula.string || "";
  return "";
}

function titleProperty(props) {
  const p = Object.values(props).find(x => x.type === "title");
  return text(p);
}

function hasFile(p) {
  return !!(p && ((p.files && p.files.length) || p.url));
}

function hasValue(p) {
  if (!p) return false;
  if (p.type === "number") return p.number !== null && p.number !== undefined;
  if (p.type === "formula") return p.formula && (p.formula.number != null || !!p.formula.string);
  if (p.type === "rollup") return p.rollup && p.rollup.number != null;
  if (p.type === "rich_text") return p.rich_text.length > 0;
  return false;
}

// Procura a propriedade pelo nome, respeitando a ordem de prioridade das palavras
function find(props, words) {
  const keys = Object.keys(props);
  for (const w of words) {
    const k = keys.find(x => norm(x).includes(norm(w)));
    if (k) return props[k];
  }
  return null;
}

function dateOf(p) {
  const d = p && p.date && p.date.start;
  return d ? d.slice(0, 10) : "";
}

// (antes se chamava "process" e escondia o process.env do Node — era esse o erro)
async function lerBanco(db) {
  const pages = await queryDatabase(db.id);
  const out = [];

  for (const item of pages) {
    const p = item.properties;

    if (db.tipo === "Seguro") {
      const C = CAMPOS.Seguro;
      const valorOk = !C.valor.length || hasValue(find(p, C.valor));
      const compOk = !C.comprovante.length || hasFile(find(p, C.comprovante));
      if (valorOk && compOk) {
        out.push({
          id: item.id,
          tipo: "Seguro",
          funcionario: db.nome,
          cliente: titleProperty(p) || text(find(p, C.cliente)),
          data: dateOf(find(p, C.data))
        });
      }
    }

    if (db.tipo === "Marketing") {
      const C = CAMPOS.Marketing;
      const cliente = titleProperty(p);
      if (cliente) {
        out.push({
          id: item.id,
          tipo: "Marketing",
          funcionario: text(find(p, C.funcionario)),
          cliente,
          data: dateOf(find(p, C.data))
        });
      }
    }
  }
  return out;
}

module.exports = async (req, res) => {
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  if (!(await require("./_auth")(req, res))) return; // exige a senha do painel

  const debug = req.query && req.query.debug;
  const fechamentos = [];
  const erros = [];
  const diagnostico = [];

  for (const db of DATABASES) {
    try {
      if (debug) {
        // Mostra os nomes/tipos das colunas de cada banco para conferir
        const r = await fetch(`https://api.notion.com/v1/databases/${db.id}`, {
          headers: {
            Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
            "Notion-Version": NOTION_VERSION
          }
        });
        const j = await r.json();
        diagnostico.push({
          banco: db.nome,
          status: r.status,
          colunas: j.properties
            ? Object.entries(j.properties).map(([n, v]) => `${n} (${v.type})`)
            : j
        });
      }
      fechamentos.push(...await lerBanco(db));
    } catch (e) {
      erros.push({ banco: db.nome, erro: e.message });
    }
  }

  const tudoFalhou = erros.length === DATABASES.length;
  return res.status(tudoFalhou ? 500 : 200).json({
    ok: !tudoFalhou,
    total: fechamentos.length,
    fechamentos,
    erros,
    ...(debug ? { diagnostico } : {})
  });
};
