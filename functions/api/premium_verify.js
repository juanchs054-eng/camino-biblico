// functions/api/premium_verify.js
// Ruta resultante en Cloudflare Pages: /api/premium_verify
// El HTML del juego llama a esta ruta con POST { transactionId }
// tras volver del checkout de Wompi (usa el ?id=... que Wompi agrega a la URL de retorno).

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
      return Response.json({ error: 'Falta el id de la transacción' }, { status: 400 });
    }

    // Wompi documenta consultar el estado de una transacción usando la LLAVE PÚBLICA
    // (no la privada, que es solo para operaciones que crean/modifican datos).
    // .trim() es importante: al copiar/pegar la llave es muy fácil arrastrar un espacio
    // o un salto de línea invisible, y Wompi entonces no reconoce al comercio.
    const publicKey = (env.WOMPI_PUBLIC_KEY || '').trim();
    if (!publicKey) {
      return Response.json({ error: 'Falta configurar WOMPI_PUBLIC_KEY en Cloudflare' }, { status: 500 });
    }

    // Pista de diagnóstico que NO revela la llave: solo el prefijo y la longitud.
    const keyHint = publicKey.slice(0, 9) + '…(' + publicKey.length + ' chars)';

    // Sandbox y producción son API COMPLETAMENTE distintas en Wompi, con dominios
    // distintos. Probamos primero el que corresponde al prefijo de la llave, pero si
    // ahí no aparece la transacción intentamos el otro, para que una llave mal
    // configurada nunca haga que un pago real quede sin entregar.
    const primaryHost = publicKey.startsWith('pub_test_')
      ? 'https://sandbox.wompi.co'
      : 'https://production.wompi.co';
    const secondaryHost = primaryHost === 'https://production.wompi.co'
      ? 'https://sandbox.wompi.co'
      : 'https://production.wompi.co';

    const id = String(transactionId).trim();
    const attempts = [];
    let wompiData = null;
    let usedHost = null;

    for (const host of [primaryHost, secondaryHost]) {
      let res;
      try {
        res = await fetch(`${host}/v1/transactions/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${publicKey}` },
        });
      } catch (fetchErr) {
        attempts.push({ host, error: 'No se pudo conectar: ' + fetchErr.message });
        continue;
      }

      const rawText = await res.text();

      if (res.ok) {
        try {
          wompiData = JSON.parse(rawText);
          usedHost = host;
          break;
        } catch {
          attempts.push({ host, status: res.status, error: 'Respuesta no es JSON', body: rawText.slice(0, 200) });
          continue;
        }
      }

      attempts.push({ host, status: res.status, body: rawText.slice(0, 200) });
    }

    if (!wompiData) {
      return Response.json(
        {
          error: 'Wompi no encontró la transacción en ninguno de los dos ambientes',
          // Diagnóstico: con esto sabes si el problema es la llave o el id.
          keyHint,
          idConsultado: id,
          intentos: attempts,
        },
        { status: 502 }
      );
    }

    const tx = wompiData.data;
    const status = tx?.status; // 'APPROVED' | 'DECLINED' | 'PENDING' | 'ERROR' | 'VOIDED'
    const reference = tx?.reference || '';

    // La referencia tiene forma "outfit-<id>-<token>", recuperamos el <id>.
    const match = reference.match(/^outfit-(.+)-[a-z0-9]{8}$/i);
    const outfitId = match ? match[1] : null;

    if (status === 'APPROVED' && outfitId) {
      return Response.json({ paid: true, outfitId, status, host: usedHost });
    }
    return Response.json({ paid: false, status: status || 'UNKNOWN', reference, host: usedHost });
  } catch (err) {
    return Response.json({ error: 'Error interno: ' + (err?.message || String(err)) }, { status: 500 });
  }
}
