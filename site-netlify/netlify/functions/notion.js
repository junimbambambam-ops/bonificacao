// Netlify Function: /.netlify/functions/notion
// Lê os bancos do Notion e devolve os fechamentos em JSON.
// Requer a variável de ambiente NOTION_TOKEN no Netlify.

const NOTION_VERSION = "2022-06-28";

const DATABASES = [
  { nome: "Bruna",    id: "2b6d8c28036c81a89ad5f1ce38375595", tipo: "Seguro" },
  { nome: "Caroline", id: "2b6d8c28036c81c8bb34cef88cbb8aed", tipo: "Seguro" },
  { nome: "Adriana",  id: "2b2d8c28036c81b487bdffd20dc0a5f6", tipo: "Seguro" },
  { nome: "MKT",      id: "2d7a8b9d89e447749775c0a28d03e978", tipo: "Marketing" }
];

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

// Busca TODAS as páginas do banco (o Notion devolve no máximo 100 por vez)
async function queryDatabase(id) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("Variável NOTION_TOKEN não configurada no Netlify");

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
      const valor = find(p, ["valor"]);
      const comp = find(p, ["comprovante", "arquivo", "anexo"]);
      if (hasValue(valor) && hasFile(comp)) {
        out.push({
          tipo: "Seguro",
          funcionario: db.nome,
          cliente: titleProperty(p) || text(find(p, ["fechamento", "cliente", "nome"])),
          data: dateOf(find(p, ["data", "dia"]))
        });
      }
    }

    if (db.tipo === "Marketing") {
      const cliente = titleProperty(p);
      if (cliente) {
        out.push({
          tipo: "Marketing",
          funcionario: text(find(p, ["funcion", "responsavel", "colaborador"])),
          cliente,
          data: dateOf(find(p, ["data", "dia"]))
        });
      }
    }
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const debug = event.queryStringParameters && event.queryStringParameters.debug;
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

  // Só falha de vez se TODOS os bancos deram erro
  const tudoFalhou = erros.length === DATABASES.length;
  return {
    statusCode: tudoFalhou ? 500 : 200,
    headers,
    body: JSON.stringify({
      ok: !tudoFalhou,
      total: fechamentos.length,
      fechamentos,
      erros,
      ...(debug ? { diagnostico } : {})
    })
  };
};
