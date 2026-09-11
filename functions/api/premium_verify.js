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
    const publicKey = env.WOMPI_PUBLIC_KEY;
    if (!publicKey) {
      return Response.json({ error: 'Falta configurar WOMPI_PUBLIC_KEY en Cloudflare' }, { status: 500 });
    }

    // Sandbox y producción son API COMPLETAMENTE distintas en Wompi, con dominios
    // distintos. Elegimos el dominio según el prefijo de la llave configurada.
    const wompiHost = publicKey.startsWith('pub_test_')
      ? 'https://sandbox.wompi.co'
      : 'https://production.wompi.co';

    let wompiRes;
    try {
      wompiRes = await fetch(`${wompiHost}/v1/transactions/${transactionId}`, {
        headers: { Authorization: `Bearer ${publicKey}` },
      });
    } catch (fetchErr) {
      return Response.json(
        { error: 'No se pudo conectar con Wompi: ' + fetchErr.message },
        { status: 502 }
      );
    }

    const rawText = await wompiRes.text();

    if (!wompiRes.ok) {
      return Response.json(
        {
          error: 'Wompi respondió con error al consultar la transacción',
          wompiStatus: wompiRes.status,
          wompiBody: rawText.slice(0, 500), // recorte por si es HTML largo
        },
        { status: 502 }
      );
    }

    let wompiData;
    try {
      wompiData = JSON.parse(rawText);
    } catch {
      return Response.json(
        {
          error: 'La respuesta de Wompi no fue JSON válido',
          wompiBody: rawText.slice(0, 500),
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
      return Response.json({ paid: true, outfitId, status });
    }
    return Response.json({ paid: false, status: status || 'UNKNOWN', reference });
  } catch (err) {
    return Response.json({ error: 'Error interno: ' + (err?.message || String(err)) }, { status: 500 });
  }
}
