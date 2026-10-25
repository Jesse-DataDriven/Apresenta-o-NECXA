// POST /api/ia
// modos: "chat" (Pergunte ao Jessé·IA), "caso" (gera caso do desafio), "avaliar" (pontua a resposta)
import { PERSONA_CHAT, PERSONA_CASO, PERSONA_AVALIA } from "../lib/conteudo.mjs";
import { claude, parseJSON, json, rateLimited, logGitHub, rankingStore, clean, MODEL } from "../lib/util.mjs";

const TEMAS = [
  "banco digital com cartão de crédito",
  "varejo online com entregas",
  "operadora de internet residencial",
  "plano de saúde",
  "companhia aérea",
  "app de delivery",
  "seguradora de automóveis",
  "fintech de Pix e conta digital",
];

export default async (req, context) => {
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ erro: "JSON inválido." }, 400); }

  const code = process.env.ACCESS_CODE;
  if (code && clean(body.codigo, 64).toLowerCase() !== code.toLowerCase()) {
    return json({ erro: "Código da turma incorreto.", precisaCodigo: true }, 401);
  }

  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "anon";
  if (rateLimited(ip)) return json({ erro: "Muitas mensagens em pouco tempo. Respira e tenta de novo em alguns minutos." }, 429);

  const apelido = clean(body.apelido, 40) || "anônimo";
  const modo = body.modo;
  const bg = (p) => (context.waitUntil ? context.waitUntil(p) : p);

  try {
    if (modo === "chat") {
      const msgs = (Array.isArray(body.mensagens) ? body.mensagens : [])
        .slice(-12)
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
        .map((m) => ({ role: m.role, content: clean(m.content) }));
      if (!msgs.length || msgs[msgs.length - 1].role !== "user") return json({ erro: "Mensagem vazia." }, 400);
      if (msgs[0].role !== "user") msgs.shift();

      const texto = await claude({ system: PERSONA_CHAT, messages: msgs, max_tokens: 600 });
      await bg(logGitHub({ modo, apelido, modelo: MODEL, quando: new Date().toISOString(), pergunta: msgs[msgs.length - 1].content, resposta: texto }));
      return json({ texto });
    }

    if (modo === "caso") {
      const tema = TEMAS[Math.floor(Math.random() * TEMAS.length)];
      const raw = await claude({
        system: PERSONA_CASO,
        messages: [{ role: "user", content: `Crie um caso novo para uma operação de ${tema}. Varie a causa raiz (processo, sistema, regra, capacitação ou comunicação).` }],
        max_tokens: 900,
      });
      const caso = parseJSON(raw);
      return json({ caso });
    }

    if (modo === "avaliar") {
      const caso = body.caso;
      const r = body.resposta || {};
      const resposta = { causa: clean(r.causa, 800), evidencia: clean(r.evidencia, 800), prioridade: clean(r.prioridade, 800) };
      if (!caso || !resposta.causa) return json({ erro: "Escreva ao menos a causa raiz." }, 400);

      const raw = await claude({
        system: PERSONA_AVALIA,
        messages: [{
          role: "user",
          content: `<caso>\n${JSON.stringify(caso).slice(0, 4000)}\n</caso>\n<resposta_participante>\nCausa raiz: ${resposta.causa}\nEvidência: ${resposta.evidencia}\nO que atacaria primeiro: ${resposta.prioridade}\n</resposta_participante>`,
        }],
        max_tokens: 700,
      });
      const av = parseJSON(raw);
      const cap = (n, m) => Math.max(0, Math.min(m, Math.round(Number(n) || 0)));
      av.causa = cap(av.causa, 40);
      av.evidencia = cap(av.evidencia, 30);
      av.priorizacao = cap(av.priorizacao, 30);
      av.nota = av.causa + av.evidencia + av.priorizacao;

      const quando = new Date().toISOString();
      await bg(Promise.all([
        rankingStore().setJSON(`${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, { nome: apelido, nota: av.nota, titulo: caso.titulo || "", quando }),
        logGitHub({ modo, apelido, modelo: MODEL, quando, caso, resposta, avaliacao: av }),
      ]).catch((e) => console.error(e)));
      return json({ avaliacao: av });
    }

    return json({ erro: "Modo desconhecido." }, 400);
  } catch (e) {
    console.error(e);
    return json({ erro: e.status ? e.message : "Algo deu errado do nosso lado. Tente de novo." }, e.status || 500);
  }
};

export const config = { path: "/api/ia" };
