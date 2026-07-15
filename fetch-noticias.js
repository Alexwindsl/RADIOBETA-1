#!/usr/bin/env node
/* =====================================================================
   JHC · Agregador de titulares por RSS
   ---------------------------------------------------------------------
   Qué hace:  lee los feeds RSS públicos de cada medio y arma noticias.json
              con TITULAR + BAJADA CORTA + MEDIO + ENLACE a la nota original.
   Qué NO hace: no copia el cuerpo de las notas ni las fotos de los medios.
                El clic va al medio. Eso es lo que hace legal y sostenible
                el agregador (y lo que evita un reclamo por derechos).
   Uso:       node fetch-noticias.js        →  genera ./noticias.json
   ===================================================================== */

const fs = require('fs');
const path = require('path');

/* ---------- FUENTES ----------
   RPP está verificado y funcionando.
   Los demás son candidatos: si un feed falla, el script lo salta y avisa.
   Verifica cada URL abriéndola en el navegador antes de confiar en ella. */
const FUENTES = [
  { medio: 'RPP Noticias',  url: 'https://rpp.pe/rss',                  verificado: true  },
  { medio: 'Andina',        url: 'https://andina.pe/agencia/rss.aspx',  verificado: false },
  { medio: 'La República',  url: 'https://larepublica.pe/rss/lima/',    verificado: false },
  { medio: 'Exitosa',       url: 'https://www.exitosanoticias.pe/feed', verificado: false }
];

/* Palabras que marcan una nota como "de la región".
   Si una nota no contiene ninguna, va al bloque nacional. */
const REGION = [
  'lambayeque','chiclayo','ferreñafe','ferrenafe','monsefú','monsefu','pimentel',
  'lambayecano','olmos','motupe','túcume','tucume','zaña','zana','reque',
  'jayanca','illimo','íllimo','chongoyape','oyotún','oyotun','pucalá','pucala',
  'tumán','tuman','pomalca','eten','santa rosa','mórrope','morrope','salas',
  'cañaris','canaris','incahuasi','picsi','pátapo','patapo','nueva arica'
];

const MAX_POR_FUENTE = 6;
const MAX_TOTAL      = 12;

/* ---------- utilidades de parseo (sin dependencias) ---------- */
const limpiar = (s='') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

const campo = (bloque, tag) => {
  const m = bloque.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? limpiar(m[1]) : '';
};

/* Bajada corta: primera oración, tope 160 caracteres, sin cortar palabras. */
function bajada(texto) {
  const t = limpiar(texto);
  if (!t) return '';
  const primera = (t.match(/^[\s\S]{15,200}?[.!?](?=\s|$)/) || [t])[0].trim();
  if (primera.length <= 160) return primera;
  return primera.slice(0, 157).replace(/\s+\S*$/, '') + '…';
}

const esRegional = (txt) => {
  const t = txt.toLowerCase();
  return REGION.some(k => t.includes(k));
};

/* ---------- lectura de un feed ---------- */
async function leerFeed(fuente) {
  try {
    const res = await fetch(fuente.url, {
      headers: { 'User-Agent': 'RadioJHC-Agregador/1.0 (+https://www.radiojhc.com)' },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();

    const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    const out = [];

    for (const it of items) {
      const titulo = campo(it, 'title');
      const enlace = campo(it, 'link') || campo(it, 'guid');
      const desc   = campo(it, 'description');
      const fecha  = campo(it, 'pubDate');
      if (!titulo || !enlace) continue;

      const blob = titulo + ' ' + desc;
      out.push({
        titulo,
        resumen:   bajada(desc),
        medio:     fuente.medio,
        enlace,
        fecha:     fecha ? new Date(fecha).toISOString() : new Date().toISOString(),
        regional:  esRegional(blob)
      });
      if (out.length >= MAX_POR_FUENTE * 4) break;
    }

    console.log(`✓ ${fuente.medio}: ${out.length} items`);
    return out;
  } catch (e) {
    console.warn(`✗ ${fuente.medio} (${fuente.url}) → ${e.message}`);
    return [];
  }
}

/* ---------- principal ---------- */
(async () => {
  const lotes = await Promise.all(FUENTES.map(leerFeed));

  // dedupe por titular normalizado
  const vistos = new Set();
  const todo = [];
  for (const lote of lotes) {
    let n = 0;
    for (const it of lote) {
      const k = it.titulo.toLowerCase().replace(/[^a-z0-9áéíóúñ ]/gi, '').slice(0, 60);
      if (vistos.has(k)) continue;
      vistos.add(k);
      todo.push(it);
      if (++n >= MAX_POR_FUENTE) break;
    }
  }

  // regionales primero, luego por fecha
  todo.sort((a, b) =>
    (b.regional - a.regional) || (new Date(b.fecha) - new Date(a.fecha))
  );

  const salida = {
    actualizado: new Date().toISOString(),
    nota: 'Titulares de terceros. Cada tarjeta enlaza a la nota original en su medio.',
    items: todo.slice(0, MAX_TOTAL)
  };

  const destino = path.join(process.cwd(), 'noticias.json');
  fs.writeFileSync(destino, JSON.stringify(salida, null, 2), 'utf8');

  const reg = salida.items.filter(i => i.regional).length;
  console.log(`\n→ noticias.json: ${salida.items.length} titulares (${reg} de Lambayeque)`);

  if (salida.items.length === 0) {
    console.error('Ningún feed respondió. No se sobrescribe con vacío.');
    process.exit(1);
  }
})();
