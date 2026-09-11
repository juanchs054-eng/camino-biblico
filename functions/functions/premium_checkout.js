// functions/functions/premium_verify.js
// Ruta resultante en Cloudflare Pages: /functions/premium_verify
// El HTML del juego llama a esta ruta con POST { transactionId }
// tras volver del checkout de Wompi (usa el ?id=... que Wompi agrega a la URL de retorno).

export async function onRequestPost({ request, env }) {
  try {
    const { transactionId } = await request.json();
    if (!transactionId) {
      return Response.json({ error: 'Falta el id de la transacción' }, { status: 400 });
    }

    const privateKey = env.WOMPI_PRIVATE_KEY;
    if (!privateKey) {
      return Response.json(
        { error: 'Falta configurar WOMPI_PRIVATE_KEY en Cloudflare' },
        { status: 500 }
      );
    }

    // Wompi expone esta consulta de forma pública (sin necesitar la llave privada
    // en la cabecera), pero la enviamos igual por si tu cuenta la exige.
    const wompiRes = await fetch(`https://production.wompi.co/v1/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${privateKey}` },
    });

    if (!wompiRes.ok) {
      return Response.json({ error: 'No se pudo consultar la transacción en Wompi' }, { status: 502 });
    }

    const wompiData = await wompiRes.json();
    const tx = wompiData.data;
    const status = tx?.status; // 'APPROVED' | 'DECLINED' | 'PENDING' | 'ERROR' | 'VOIDED'
    const reference = tx?.reference || '';

    // La referencia tiene forma "outfit-<id>-<token>", recuperamos el <id>.
    const match = reference.match(/^outfit-(.+)-[a-z0-9]{8}$/i);
    const outfitId = match ? match[1] : null;

    if (status === 'APPROVED' && outfitId) {
      return Response.json({ paid: true, outfitId, status });
    }
    return Response.json({ paid: false, status: status || 'UNKNOWN' });
  } catch (err) {
    return Response.json({ error: 'Error interno: ' + err.message }, { status: 500 });
  }
}
