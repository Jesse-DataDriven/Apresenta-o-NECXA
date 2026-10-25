// Utilitários compartilhados pelas funções: chamada à API da Anthropic,
// limite de uso, log no GitHub e ranking no Netlify Blobs.
import { getStore } from "@netlify/blobs";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/* ---------- Anthropic ---------- */
export async function claude({ system, messages, max_tokens = 700 }) {
  // remove espaços, quebras de linha e aspas coladas por engano
  const key = (process.env.ANTHROPIC_API_KEY || "").trim().replace(/^["']|["']$/g, "").trim();
  if (!key) throw Object.assign(new Error("ANTHROPIC_API_KEY não configurada no Netlify."), { status: 500 });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens, system, messages }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("Anthropic", r.status, t.slice(0, 500));
    if (r.status === 401) console.error(`Diagnóstico da chave: começa com "${key.slice(0, 13)}", tem ${key.length} caracteres (o normal é começar com "sk-ant-api03-" e ter ~108).`);
    let tipo = "", detalhe = "";
    try { const e = JSON.parse(t).error || {}; tipo = e.type || ""; detalhe = e.message || ""; } catch {}
    const motivos = {
      authentication_error: "A chave da Anthropic (ANTHROPIC_API_KEY) foi recusada. Confira se foi colada inteira.",
      permission_error: "A chave da Anthropic não tem permissão para este modelo.",
      not_found_error: `O modelo "${MODEL}" não foi encontrado. Ajuste ANTHROPIC_MODEL no Netlify.`,
      rate_limit_error: "Limite de uso da Anthropic atingido. Espere alguns segundos.",
      overloaded_error: "A Anthropic está sobrecarregada agora. Tente de novo em instantes.",
    };
    let msg = motivos[tipo];
    if (!msg && /credit|balance|billing/i.test(detalhe)) msg = "Sem créditos na conta da Anthropic. Adicione créditos em console.anthropic.com → Billing.";
    if (!msg) msg = `A IA não respondeu (Anthropic ${r.status}${tipo ? " · " + tipo : ""}${detalhe ? ": " + detalhe.slice(0, 160) : ""}).`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  const j = await r.json();
  return j.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

export function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : text);
}

/* ---------- limite simples por IP (best-effort, por instância) ---------- */
const hits = new Map();
export function rateLimited(ip, max = Number(process.env.RATE_LIMIT || 40), windowMs = 10 * 60e3) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > max;
}

/* ---------- log no GitHub (branch "logs", um arquivo por interação) ---------- */
export async function logGitHub(entry) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;
  const repo = process.env.GITHUB_REPO || "Jesse-DataDriven/Apresenta-o-NECXA";
  const branch = process.env.LOG_BRANCH || "logs";
  const api = `https://api.github.com/repos/${repo}`;
  const h = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "necxa-lab",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const d = new Date();
  const day = d.toISOString().slice(0, 10);
  const stamp = d.toISOString().replace(/[:.]/g, "-");
  const path = `logs/${day}/${stamp}-${entry.modo}-${Math.random().toString(36).slice(2, 7)}.json`;
  const body = JSON.stringify({
    message: `log(${entry.modo}): ${entry.apelido || "anônimo"} · ${day}`,
    content: Buffer.from(JSON.stringify(entry, null, 2)).toString("base64"),
    branch,
  });

  const put = () => fetch(`${api}/contents/${path}`, { method: "PUT", headers: h, body });
  try {
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const r = await put();
      if (r.ok) return;
      if (r.status === 404 || r.status === 422) {
        // branch de logs ainda não existe: cria a partir do branch padrão
        const info = await (await fetch(api, { headers: h })).json();
        const ref = await (await fetch(`${api}/git/ref/heads/${info.default_branch}`, { headers: h })).json();
        await fetch(`${api}/git/refs`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }),
        });
      } else if (r.status === 409) {
        // commits simultâneos no branch: espera um pouco e tenta de novo
        await new Promise((ok) => setTimeout(ok, 300 + Math.random() * 900));
      } else {
        console.error("GitHub log", r.status, (await r.text()).slice(0, 300));
        return;
      }
    }
  } catch (e) {
    console.error("GitHub log falhou", e);
  }
}

/* ---------- ranking (Netlify Blobs) ---------- */
export function rankingStore() {
  // Troque RANKING_STORE no Netlify (ex.: "aula") para começar um ranking zerado.
  return getStore({ name: process.env.RANKING_STORE || "ranking-desafio", consistency: "strong" });
}

export function clean(s, max = 1500) {
  return String(s ?? "").replace(/\u0000/g, "").slice(0, max).trim();
}
