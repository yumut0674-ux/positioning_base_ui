import { Worker } from "node:worker_threads";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

// pdfmake layout/font processing is CPU intensive. Run it outside the live engine's event loop.
// The inline CommonJS worker also works in the production bundle without deploying a TS loader.
const source = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const path = require('node:path');
const { readFileSync } = require('node:fs');
try {
  const appRequire = createRequire(path.join(workerData.root, 'package.json'));
  const PdfPrinter = appRequire('pdfmake');
  const assets = path.join(workerData.root, 'src', 'server', 'reports', 'assets');
  const regular = readFileSync(path.join(assets, 'Roboto-Regular.ttf'));
  const bold = readFileSync(path.join(assets, 'Roboto-Medium.ttf'));
  const printer = new PdfPrinter({ Roboto: { normal: regular, bold, italics: regular, bolditalics: bold } });
  const definition = workerData.definition;
  const headerTemplate = definition.header;
  if (headerTemplate) definition.header = () => structuredClone(headerTemplate);
  const margin = Array.isArray(definition.pageMargins) ? definition.pageMargins : [28, 65, 28, 35];
  definition.footer = (page, total) => ({ text: 'Sayfa ' + page + ' / ' + total, alignment: 'right', fontSize: 8, color: '#555555', margin: [margin[0], 10, margin[2], 0] });
  const document = printer.createPdfKitDocument(definition, { tableLayouts: {
    reportGrid: { hLineColor: () => '#CBD5DF', vLineColor: () => '#CBD5DF', hLineWidth: () => .5, vLineWidth: () => .5 }
  } });
  const chunks = [];
  document.on('data', chunk => chunks.push(Buffer.from(chunk)));
  document.on('error', error => parentPort.postMessage({ error: error.message }));
  document.on('end', () => {
    const bytes = Uint8Array.from(Buffer.concat(chunks));
    parentPort.postMessage({ bytes }, [bytes.buffer]);
  });
  document.end();
} catch (error) { parentPort.postMessage({ error: error.message }); }
`;

export function renderReportPdf(definition: TDocumentDefinitions): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { root: process.cwd(), definition } });
    let completed = false;
    const timeout = setTimeout(() => finish(new Error("PDF hazırlama süresi aşıldı. Daha kısa bir aralık seçin.")), 120_000);
    timeout.unref?.();
    const finish = (error?: Error, bytes?: Uint8Array) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      void worker.terminate();
      if (error) reject(error); else resolve(bytes!);
    };
    worker.once("message", (result: { bytes?: Uint8Array; error?: string }) => {
      if (result.bytes) finish(undefined, result.bytes);
      else finish(new Error(result.error ?? "PDF oluşturulamadı."));
    });
    worker.once("error", error => finish(error));
    worker.once("exit", code => { if (!completed) finish(new Error(`PDF işlemi tamamlanamadı (${code}).`)); });
  });
}
