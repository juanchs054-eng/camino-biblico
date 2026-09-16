// functions/api/premium_verify.js
// Ruta en Cloudflare Pages: /api/premium_verify
//
// Acepta { transactionId } que puede ser:
//   - el id de Wompi (ej: 01-903100443-27458 o 1532177-1789436309-10716)
//   - la referencia del pago (ej: outfit-jose-8ed1bf3c)
// Si la búsqueda por id falla, intenta automáticamente por referencia.

export async function onRequestPost({ request, env }) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'El cuerpo de la petición no es JSON válido' }, { status: 400 });
    }

    const { transactionId } = body || {};
    if (!transactionId) {
      return Response.json({ error: 'Falta el id o la referencia de la transacción' }, { status: 400 });
    }

    // .trim() evita que un espacio o salto de línea invisible al pegar la llave
    // haga que Wompi no reconozca al comercio.
    const publicKey = (env.WOMPI_PUBLIC_KEY || '').trim();
    if (!publicKey) {
      return Response.json({ error: 'Falta configurar WOMPI_PUBLIC_KEY en Cloudflare' }, { status: 500 });
    }
    const keyHint = publicKey.slice(0, 9) + '…' + publicKey.slice(-4) + ' (' + publicKey.length + ' chars)';

    const host = publicKey.startsWith('pub_test_')
      ? 'https://sandbox.wompi.co'
      : 'https://production.wompi.co';

    const entrada = String(transactionId).trim();
    // Si empieza con "outfit-" o con el prefijo del paquete, es una referencia, no un id.
    const pareceReferencia = /^(outfit|bundle|todo)-/i.test(entrada);

    const attempts = [];

    async function pedir(url, etiqueta) {
      let res;
      try {
        res = await fetch(url, { headers: { Authorization: `Bearer ${publicKey}` } });
      } catch (e) {
        attempts.push(`${etiqueta}: sin conexión (${e.message})`);
        return null;
      }
      const raw = await res.text();
      if (!res.ok) {
        attempts.push(`${etiqueta}: ${res.status}`);
        return null;
      }
      try {
        return JSON.parse(raw);
      } catch {
        attempts.push(`${etiqueta}: respuesta no es JSON`);
        return null;
      }
    }

    let tx = null;

    // 1) Búsqueda por id (la vía oficial y documentada).
    if (!pareceReferencia) {
      const porId = await pedir(`${host}/v1/transactions/${encodeURIComponent(entrada)}`, 'por-id');
      if (porId?.data) tx = porId.data;
    }

    // 2) Búsqueda por referencia. No está en la documentación pública de Wompi,
    //    así que puede no funcionar; si no funciona el diagnóstico lo dirá.
    if (!tx) {
      const porRef = await pedir(
        `${host}/v1/transactions?reference=${encodeURIComponent(entrada)}`,
        'por-referencia'
      );
      const lista = porRef?.data;
      if (Array.isArray(lista) && lista.length) {
        // Si hay varias con la misma referencia, preferimos la aprobada.
        tx = lista.find((t) => t.status === 'APPROVED') || lista[0];
      } else if (lista && !Array.isArray(lista)) {
        tx = lista;
      }
    }

    if (!tx) {
      return Response.json(
        {
          error:
            'Wompi no encontró la transacción. ' +
            `Llave: ${keyHint}. Buscado: "${entrada}". ` +
            `Intentos: ${attempts.join(' | ')}`,
        },
        { status: 502 }
      );
    }

    const status = tx.status; // APPROVED | DECLINED | PENDING | ERROR | VOIDED
    const reference = tx.reference || '';
    const match = reference.match(/^outfit-(.+)-[a-z0-9]{8}$/i);
    const outfitId = match ? match[1] : null;

    if (status === 'APPROVED' && outfitId) {
      return Response.json({ paid: true, outfitId, status });
    }
    return Response.json({ paid: false, status: status || 'UNKNOWN', reference });
  } catch (err) {
    return Response.json({ error: 'Error interno: ' + (err?.message || String(err)) }, { status: 500 });
  }
}
