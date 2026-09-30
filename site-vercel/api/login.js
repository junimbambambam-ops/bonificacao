// Usado pela tela de senha do painel: responde 200 se a senha estiver certa.
const auth = require("./_auth");
module.exports = async (req, res) => {
  if (await auth(req, res)) res.status(200).json({ ok: true });
};
