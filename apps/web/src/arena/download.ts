// download.ts — el único módulo de `arena/` que toca el navegador.
//
// La frontera es deliberada, igual que `export/browser.ts` en el visualizador:
// armar el replay es puro y se testea en Node; bajarlo al disco necesita DOM y
// no se testea, así que se mantiene lo más delgado posible.

/** Dispara la descarga de un texto como archivo. */
export function downloadText(fileName: string, contents: string, mime = "application/json"): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Sin esto el blob queda retenido hasta que se descargue el documento entero.
  URL.revokeObjectURL(url);
}
