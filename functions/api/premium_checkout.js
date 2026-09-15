// functions/api/premium_checkout.js
// Ruta resultante en Cloudflare Pages: /api/premium_checkout
// El HTML del juego llama a esta ruta con POST { outfitId }

// Debe coincidir EXACTO con la lista PREMIUM_OUTFITS del HTML (id y price).
const PREMIUM_OUTFITS = {
  'armadura-Dios': 14000,
  'jesus': 12000,
  'moises': 9000,
  'elias': 9000,
  'david': 9000,
  'ester': 9000,
  'rut': 9000,
  'raquel': 7000,
  'maria': 6000,
  'saulo': 6000,
  'pablo': 4000,
  'jose': 2000,
  // Paquete "Todo Incluido": debe coincidir con BUNDLE_PRODUCT.price en el HTML.
  'todo-incluido': 39900,
};

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function onRequestPost({ request, env }) {
  try {
    const { outfitId } = await request.json();

    const priceCop = PREMIUM_OUTFITS[outfitId];
    if (!priceCop) {
      return Response.json({ error: 'Traje premium no válido' }, { status: 400 });
    }

    const publicKey = env.WOMPI_PUBLIC_KEY;
    const integritySecret = env.WOMPI_INTEGRITY_SECRET;
    if (!publicKey || !integritySecret) {
      return Response.json(
        { error: 'Faltan configurar las llaves de Wompi en Cloudflare (Settings > Environment variables)' },
        { status: 500 }
      );
    }

    // La referencia incluye el outfitId para poder recuperarlo luego en premium_verify,
    // más un token aleatorio para que cada intento de compra sea único.
    const randomToken = crypto.randomUUID().slice(0, 8);
    const reference = `outfit-${outfitId}-${randomToken}`;

    const amountInCents = priceCop * 100; // Wompi trabaja en centavos
    const currency = 'COP';

    // Firma de integridad exigida por Wompi: sha256(referencia + monto + moneda + secreto)
    const signature = await sha256Hex(`${reference}${amountInCents}${currency}${integritySecret}`);

    const redirectUrl = new URL(request.url);
    redirectUrl.pathname = '/'; // vuelve a la página principal del juego tras pagar
    redirectUrl.search = '';

    const checkoutUrl = new URL('https://checkout.wompi.co/p/');
    checkoutUrl.searchParams.set('public-key', publicKey);
    checkoutUrl.searchParams.set('currency', currency);
    checkoutUrl.searchParams.set('amount-in-cents', String(amountInCents));
    checkoutUrl.searchParams.set('reference', reference);
    checkoutUrl.searchParams.set('signature:integrity', signature);
    checkoutUrl.searchParams.set('redirect-url', redirectUrl.toString());

    return Response.json({ url: checkoutUrl.toString() });
  } catch (err) {
    return Response.json({ error: 'Error interno: ' + err.message }, { status: 500 });
  }
}
