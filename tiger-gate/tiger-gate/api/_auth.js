// Confere a senha do painel (variável SENHA_PAINEL na Vercel). Arquivos com "_" não viram rota.
const crypto = require("crypto");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => crypto.createHash("sha256").update(String(s)).digest();

module.exports = async function auth(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const esperado = process.env.SENHA_PAINEL;
  if (!esperado) {
    res.status(500).json({ ok: false, error: "Senha não configurada: crie a variável SENHA_PAINEL na Vercel e faça Redeploy" });
    return false;
  }
  let dada = "";
  try { dada = decodeURIComponent(String(req.headers["x-senha"] || "")); } catch (e) { dada = ""; }
  if (!crypto.timingSafeEqual(hash(dada), hash(esperado))) {
    await sleep(800); // atrasa tentativas erradas
    res.status(401).json({ ok: false, error: "Senha incorreta" });
    return false;
  }
  return true;
};
