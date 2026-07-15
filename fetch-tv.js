#!/usr/bin/env node
/* =====================================================================
   JHC · Detector de transmisión en vivo de Facebook
   ---------------------------------------------------------------------
   Pregunta a la Graph API si alguna de tus páginas está EN VIVO ahora
   y escribe tv.json. La web lee ese archivo y muestra el video solo.

   Por qué así y no desde el navegador:
   Facebook NO permite consultar el estado en vivo sin un token. Y un
   token JAMÁS puede ir en el HTML de GitHub Pages: sería público y
   cualquiera podría publicar en tu página. Por eso la consulta corre
   aquí, en GitHub Actions, donde el token vive como Secret.

   Variables de entorno (Secrets del repo):
     FB_TOKEN → token de acceso de página, de larga duración
     FB_PAGES → "IDPAGINA:Nombre,IDPAGINA:Nombre"
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const API     = 'https://graph.facebook.com/v21.0';
const TOKEN   = process.env.FB_TOKEN || '';
const PAGES   = (process.env.FB_PAGES || '').split(',').map(s => s.trim()).filter(Boolean);
const DESTINO = path.join(process.cwd(), 'tv.json');

function escribir(obj) {
  obj.actualizado = new Date().toISOString();
  fs.writeFileSync(DESTINO, JSON.stringify(obj, null, 2), 'utf8');
  console.log(JSON.stringify(obj, null, 2));
}

/* Nunca dejamos el archivo sin escribir: si algo falla, sale enVivo:false
   y la web muestra el mensaje de siempre en vez de romperse. */
function apagado(motivo) {
  escribir({ enVivo: false, motivo });
  process.exit(0);
}

(async () => {
  if (!TOKEN)        return apagado('Falta el secret FB_TOKEN');
  if (!PAGES.length) return apagado('Falta el secret FB_PAGES');

  for (const entrada of PAGES) {
    const [id, ...resto] = entrada.split(':');
    const nombre = resto.join(':') || id;

    try {
      const url = `${API}/${id}/live_videos`
                + `?fields=id,status,permalink_url,title,embeddable`
                + `&limit=5&access_token=${encodeURIComponent(TOKEN)}`;

      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();

      if (j.error) {
        console.warn(`✗ ${nombre}: ${j.error.message} (código ${j.error.code})`);
        continue;
      }

      const vivo = (j.data || []).find(v => v.status === 'LIVE');
      if (vivo) {
        console.log(`● ${nombre} ESTÁ EN VIVO → ${vivo.permalink_url}`);
        return escribir({
          enVivo:  true,
          pagina:  nombre,
          titulo:  vivo.title || 'Transmisión en vivo',
          url:     'https://www.facebook.com' + vivo.permalink_url,
          videoId: vivo.id
        });
      }
      console.log(`○ ${nombre}: sin transmisión`);
    } catch (e) {
      console.warn(`✗ ${nombre}: ${e.message}`);
    }
  }

  escribir({ enVivo: false, motivo: 'Ninguna página transmitiendo' });
})();
