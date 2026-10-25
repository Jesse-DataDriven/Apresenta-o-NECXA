// GET /api/ranking → melhor nota de cada apelido, do maior para o menor
import { json, rankingStore } from "../lib/util.mjs";

export default async () => {
  try {
    const store = rankingStore();
    const { blobs } = await store.list();
    const itens = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
    const melhor = new Map();
    for (const it of itens) {
      const k = it.nome.toLowerCase();
      if (!melhor.has(k) || melhor.get(k).nota < it.nota) melhor.set(k, it);
    }
    const top = [...melhor.values()].sort((a, b) => b.nota - a.nota).slice(0, 20).map(({ nome, nota }) => ({ nome, nota }));
    return json({ total: itens.length, top });
  } catch (e) {
    console.error(e);
    return json({ total: 0, top: [] });
  }
};

export const config = { path: "/api/ranking" };
