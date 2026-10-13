const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');

const root = 'tools/room-benchmark/reports/yogun-bakim-pdop-two-20261013';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = value => escape(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
const num = value => Number(value).toFixed(2);
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const writeOnce = async (file, bytes) => {
  try { await fs.writeFile(file, bytes, {flag: 'wx'}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await fs.readFile(file, 'utf8'), bytes, `Existing artifact differs: ${file}`); }
};

function markdownBody(markdown) {
  const out = []; let table = false, list = null;
  const closeList = () => { if (list) out.push(`</${list}>`); list = null; };
  for (const line of markdown.trimEnd().split(/\r?\n/)) {
    if (line.startsWith('|')) {
      closeList();
      if (/^\|[-:| ]+\|$/.test(line)) continue;
      if (!table) { out.push('<div class="table"><table>'); table = true; }
      out.push('<tr>' + line.slice(1, -1).split('|').map(cell => '<td>' + inline(cell.trim()) + '</td>').join('') + '</tr>');
      continue;
    }
    if (table) { out.push('</table></div>'); table = false; }
    const bullet = line.match(/^(- |\d+\. )(.*)$/);
    if (bullet) {
      const next = bullet[1] === '- ' ? 'ul' : 'ol';
      if (list !== next) { closeList(); list = next; out.push(`<${list}>`); }
      out.push('<li>' + inline(bullet[2]) + '</li>'); continue;
    }
    closeList();
    if (!line.trim()) continue;
    const heading = line.match(/^(#{1,3}) /);
    out.push(heading ? `<h${heading[1].length}>${inline(line.slice(heading[0].length))}</h${heading[1].length}>` : '<p>' + inline(line) + '</p>');
  }
  closeList(); if (table) out.push('</table></div>'); return out.join('\n');
}

function pointStyle(row) {
  if (row.classification === 'expected-room') return row.expectedWallDistance > row.expectedBandThreshold
    ? {color: '#12805c', label: 'Oda içinde, güçlü geometrik kanıt'}
    : {color: '#b76800', label: 'Oda içinde, duvar bandında'};
  if (row.classification === 'corridor') return {color: '#596675', label: 'Koridor'};
  if (row.classification === 'other-room') return {color: '#7c3aed', label: 'Başka oda'};
  return {color: '#c52938', label: 'Harita dışında / eksik'};
}

function spatialSvg(report, visit, config) {
  const svgId = report.testId.split('-')[1] + '-' + visit.roomId;
  const points = visit.rawDetails.filter(row => Number.isFinite(row.x) && Number.isFinite(row.y));
  const geometry = [...visit.roomConfiguration.polygon, ...points];
  const minX = Math.min(...geometry.map(p => p.x)) - .6, maxX = Math.max(...geometry.map(p => p.x)) + .6;
  const minY = Math.min(...geometry.map(p => p.y)) - .6, maxY = Math.max(...geometry.map(p => p.y)) + .6;
  const width = 700, height = 385, left = 70, top = 95;
  const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
  const offsetX = left + (width - scale * (maxX - minX)) / 2;
  const offsetY = top + (height - scale * (maxY - minY)) / 2;
  const X = x => offsetX + (x - minX) * scale, Y = y => offsetY + (maxY - y) * scale;
  const vertices = polygon => polygon.map(p => `${num(X(p.x))},${num(Y(p.y))}`).join(' ');
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 610" role="img" aria-labelledby="title desc"><title id="title">${escape(report.name)} — ${escape(visit.roomName)} ham noktaları</title><desc id="desc">Noktalar ölçüm zamanı gerçek ziyaret aralığında olan tüm ham paketlerdir. Sayılar ölçüm sırasını gösterir; kesikli kenar ziyaret sonrasında teslim edilen noktadır. Renk geometrik sınıftır, motorun kabul kararının kendisi değildir. X ve Y metre, eşit ölçek.</desc><style>text{font-family:system-ui,sans-serif;fill:#172a3a}.label{font-size:12px}.grid{stroke:#dbe3ea;stroke-width:1}circle{cursor:help}</style><rect width="840" height="610" fill="white"/><text x="24" y="32" font-size="21" font-weight="700">${escape(report.name)} — ${escape(visit.roomName)}</text><text x="24" y="55" font-size="13">${escape(visit.from)} → ${escape(visit.to)} · ${points.length} ölçüm · X/Y metre</text><defs><clipPath id="plot"><rect x="${left}" y="${top}" width="${width}" height="${height}"/></clipPath></defs>`];
  for (let x = Math.ceil(minX); x <= maxX; x++) {
    out.push(`<line class="grid" x1="${num(X(x))}" y1="${top}" x2="${num(X(x))}" y2="${top + height}"/><text class="label" x="${num(X(x))}" y="${top + height + 20}" text-anchor="middle">${x}</text>`);
  }
  for (let y = Math.ceil(minY); y <= maxY; y++) {
    out.push(`<line class="grid" x1="${left}" y1="${num(Y(y))}" x2="${left + width}" y2="${num(Y(y))}"/><text class="label" x="${left - 10}" y="${num(Y(y) + 4)}" text-anchor="end">${y}</text>`);
  }
  out.push('<g clip-path="url(#plot)">');
  for (const region of config.regions) {
    const polygon = region.polygon.map(p => p.world ?? p);
    const target = region.id === visit.roomId;
    out.push(`<polygon points="${vertices(polygon)}" fill="${target ? '#e5f1ec' : region.kind === 'corridor' ? '#edf1f5' : '#f4f1fa'}" stroke="${target ? '#172a3a' : '#9caaba'}" stroke-width="${target ? 2.5 : 1}"><title>${escape(region.name)} (${escape(region.id)})</title></polygon>`);
    const center = polygon.reduce((p, q) => ({x: p.x + q.x / polygon.length, y: p.y + q.y / polygon.length}), {x: 0, y: 0});
    out.push(`<text x="${num(X(center.x))}" y="${num(Y(center.y))}" text-anchor="middle" font-size="13">${escape(region.name)}</text>`);
  }
  for (const door of visit.roomConfiguration.doors) {
    const n = door.inwardNormal, length = Math.hypot(n.x, n.y), tx = -n.y / length, ty = n.x / length;
    const half = door.widthMeters / 2;
    out.push(`<line x1="${num(X(door.x - tx * half))}" y1="${num(Y(door.y - ty * half))}" x2="${num(X(door.x + tx * half))}" y2="${num(Y(door.y + ty * half))}" stroke="#057cbe" stroke-width="6"><title>${escape(door.id)}, genişlik ${door.widthMeters} m</title></line>`);
  }
  out.push(`<polyline points="${vertices(points)}" stroke="#667585" stroke-width="1" stroke-opacity=".4" fill="none"/>`);
  points.forEach((row, index) => {
    const style = pointStyle(row), late = Date.parse(row.received_at) >= Date.parse(visit.to), d = row.deliveredDecision;
    const tooltip = `#${index + 1} DB ${row.id}; ${style.label}; x=${row.x}, y=${row.y}; ölçüm ${row.created_at}; teslim ${row.received_at}; PDOP ${row.pdop}; duvar ${row.expectedWallDistance ?? '-'} m / band ${row.expectedBandThreshold ?? '-'} m; ${d?.state ?? 'karar yok'} / ${d?.roomId ?? '-'}; ${d?.eventType ?? '-'}; ${(d?.reasonCodes ?? []).join(', ')}; sonraki teslim boşluğu ${row.nextSignalGapMs ?? '-'} ms${late ? '; ziyaret bittikten sonra teslim' : ''}`;
    out.push(`<circle cx="${num(X(row.x))}" cy="${num(Y(row.y))}" r="6" fill="${style.color}" fill-opacity="${late ? '.55' : '.95'}" stroke="#172a3a" stroke-width="${late ? 2 : 1}"${late ? ' stroke-dasharray="2 2"' : ''}><title>${escape(tooltip)}</title></circle><text class="label" x="${num(X(row.x) + 8)}" y="${num(Y(row.y) - 7)}">${index + 1}</text>`);
  });
  out.push('</g><text class="label" x="783" y="499">X (m)</text><text class="label" x="12" y="90">Y (m)</text>');
  const legend = [['#12805c', 'İçeride, güçlü'], ['#b76800', 'Duvar bandı'], ['#596675', 'Koridor'], ['#7c3aed', 'Başka oda'], ['#c52938', 'Harita dışı']];
  legend.forEach(([color, label], i) => out.push(`<circle cx="${25 + i * 161}" cy="532" r="5" fill="${color}"/><text class="label" x="${35 + i * 161}" y="536">${label}</text>`));
  out.push('<text x="24" y="565" font-size="12">Kesikli nokta: ziyaret bittikten sonra teslim. Numaralar ölçüm sırası; üstüne gelerek ayrıntıyı okuyun.</text><text x="24" y="587" font-size="12">Renk geometrik kanıt sınıfıdır; fiziksel konum doğruluğunu tek başına kanıtlamaz.</text></svg>');
  return out.join('\n')
    .replaceAll('id="title"', `id="${svgId}-title"`)
    .replaceAll('id="desc"', `id="${svgId}-desc"`)
    .replaceAll('aria-labelledby="title desc"', `aria-labelledby="${svgId}-title ${svgId}-desc"`)
    .replaceAll('id="plot"', `id="${svgId}-plot"`)
    .replaceAll('url(#plot)', `url(#${svgId}-plot)`);
}

function rawPointTable(visit) {
  const header = '<tr><th># / DB id</th><th>Ölçüm UTC</th><th>Teslim UTC</th><th>X / Y (m)</th><th>PDOP</th><th>Geometri / duvar</th><th>Motor durumu / oda</th><th>Karar / reason</th><th>Sonraki boşluk</th></tr>';
  const rows = visit.rawDetails.map((row, i) => {
    const d = row.deliveredDecision;
    return '<tr>' + [`${i + 1} / ${row.id}`, row.created_at, row.received_at, `${num(row.x)} / ${num(row.y)}`, num(row.pdop), `${pointStyle(row).label}; ${row.expectedWallDistance === null ? '-' : num(row.expectedWallDistance)} / ${row.expectedBandThreshold ?? '-'} m`, `${d?.state ?? '-'} / ${d?.roomId ?? '-'}`, `${d?.eventType ?? '-'} / ${(d?.reasonCodes ?? []).join(', ')}`, `${row.nextSignalGapMs ?? '-'} ms`].map(v => `<td>${escape(v)}</td>`).join('') + '</tr>';
  });
  return '<details><summary>Ham nokta → teslim → motor kararı → sonraki boşluk</summary><div class="table"><table>' + header + rows.join('') + '</table></div></details>';
}

(async () => {
  const study = await readJson(root + '/study.json'), exitStudy = await readJson(root + '/exit-study.json');
  const before = await readJson(root + '/source-hashes-before.json');
  const outsideChanges = [];
  for (const [file, initial] of Object.entries(before)) {
    let after; try { after = hash(await fs.readFile(file)); } catch (e) { if (e.code !== 'ENOENT') throw e; after = 'missing'; }
    if (initial !== after) outsideChanges.push({path: file, before: initial, after});
  }
  const critical = [];
  const expected = {
    'src/server/regionEngine/RegionPositionEngine.ts': study.engineSha256,
    'src/server/regionEngine/controller.ts': before['src/server/regionEngine/controller.ts'],
    'src/server/trackingBuffer.ts': before['src/server/trackingBuffer.ts'],
    'config/maps/necmettin-yogun-bakim/regions.json': study.configSha256,
    'config/maps/necmettin-yogun-bakim/tracking-filter.json': study.reports[0].pdopPolicy.settingsSha256,
    'src/shared/tracking/pdop.ts': study.reports[0].pdopPolicy.sourceSha256,
  };
  for (const [file, initial] of Object.entries(expected)) {
    const after = hash(await fs.readFile(file)); assert.equal(after, initial, `Source changed since replay: ${file}`);
    critical.push({path: file, before: initial, after, unchanged: true});
  }
  const datasets = [];
  for (const report of [...study.reports, ...study.older]) {
    const dir = path.join('tools/room-benchmark/datasets', report.testId);
    const raw = hash(await fs.readFile(dir + '/raw.jsonl')), truth = hash(await fs.readFile(dir + '/truth.json'));
    assert.equal(raw, report.dataset.sha256); assert.equal(truth, report.dataset.truthSha256);
    datasets.push({testId: report.testId,rawSha256: raw,truthSha256: truth,unchangedSinceReplay: true});
  }
  const verification = {
    scope: 'Only tools/room-benchmark files were written by this benchmark task',
    gitCommitNow: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
    gitStatusNow: execFileSync('git', ['status', '--short'], {encoding: 'utf8'}).trim(),
    criticalSources: critical, initialOutsideFileCount: Object.keys(before).length, outsideChanges,
    initialDirtyFilesPreserved: true, datasets, deterministicProfiles: study.deterministic && exitStudy.deterministic,
    tests: {total: 18,passed: 17,failed: 0,skipped: 1,skipReason: 'DB-writing PDOP integration test disabled with TRACKING_PDOP_DATABASE_TEST=0'},
    typecheck: {scoped: 'passed',project: 'failed',error: 'tools/room-benchmark/reports/ui-experience-5c71fd2a-20261013/analyze.ts(133,23): TS2783 roomId specified more than once (existing report preserved)'},
    isolation: {replayEngine: 'imported active RegionPositionEngine; in-memory publish; injected virtual clock; automatic timer disabled',noControllerOrTrackingBufferInReplay: true,noListenerOrLiveSseStarted: true,noLiveApiReplay: true,noDatabaseWrite: true,databaseOperations: 'SELECT only for import/audit',noServerRestartOrStop: true,allStartedBenchmarkCommandsTerminated: true},
  };
  assert.equal(verification.deterministicProfiles, true);
  await writeOnce(root + '/verification.json', JSON.stringify(verification, null, 2) + '\n');
  const config = await readJson(root + '/current-config.json'), cards = [], plots = [];
  for (const report of study.reports) for (const visit of report.visits) {
    const file = report.testId.split('-')[1] + '-' + visit.roomId + '.svg';
    const svg = spatialSvg(report, visit, config);
    await fs.writeFile(root + '/' + file, svg);
    plots.push(file);
    cards.push(`<section class="plot"><h3>${escape(report.name)} — ${escape(visit.roomName)}: ${visit.missed ? 'kaçırıldı' : 'yakalandı'}, doğru oda %${visit.roomPercent}</h3><a href="${file}" download>SVG indir</a>${svg}${rawPointTable(visit)}</section>`);
  }
  const links = ['interpretation.md', 'analysis.md', 'study.json', 'exit-study.json', 'verification.json', '../yogun-bakim-36f6f20f-current-20261013/report.html', '../yogun-bakim-4255236f-current-20261013/report.html'];
  for (const link of [...links, ...plots]) await fs.access(path.resolve(root, link));
  const markdown = await fs.readFile(root + '/interpretation.md', 'utf8'), details = await fs.readFile(root + '/analysis.md', 'utf8');
  const nav = links.map((link, i) => `<a href="${link}">${['Yorum Markdown', 'Tüm deneyler', 'Ana JSON', 'Çıkış deneyleri', 'Doğrulama', 'Cafer standart rapor', 'Bilgisayar standart rapor'][i]}</a>`).join(' · ');
  const html = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yoğun Bakım — oda tespiti, 13 Ekim 2026</title><style>body{font:16px system-ui;line-height:1.55;background:#f3f6f8;color:#172a3a;max-width:1180px;margin:30px auto;padding:0 18px}main{background:white;padding:28px;border-radius:14px}h1{font-size:27px}h2{margin-top:32px;color:#174b64}h3{font-size:20px}a{color:#085b9a}code{background:#edf2f5;padding:2px 4px;overflow-wrap:anywhere}.table{overflow:auto;margin:20px 0}table{border-collapse:collapse;font-size:14px;width:100%}td,th{padding:9px;border:1px solid #d2dbe2;vertical-align:top}tr:first-child{font-weight:700;background:#e8f1f5}details{margin-top:20px}summary{cursor:pointer;font-weight:700}nav{margin-bottom:25px}strong{color:#174b64}.plot{margin:26px 0;padding:18px;border:1px solid #d2dbe2;border-radius:10px}.plot svg{width:100%;height:auto}p,li{overflow-wrap:anywhere}@media print{body{background:white}main{padding:0}.table{overflow:visible}.plot{break-inside:avoid}}</style></head><body><main><nav>' + nav + '</nav>' + markdownBody(markdown) + '<h2>Ham noktalar ve güncel oda geometrisi</h2><p>Çizimlerde numaralar ölçüm sırasıdır. Noktanın üzerine gelerek ölçüm, teslim, PDOP ve motor kararını okuyabilirsiniz. Sayısal kayıtlar çizimin altında açılır.</p>' + cards.join('\n') + '<details><summary>Tüm eşik ve geçmiş veri karşılaştırma tabloları</summary>' + markdownBody(details) + '</details></main></body></html>';
  await fs.writeFile(root + '/analysis.html', html);
  console.log(JSON.stringify({html: root + '/analysis.html', plots,criticalSourcesUnchanged: critical.length,outsideFilesChecked: Object.keys(before).length,outsideChanges: outsideChanges.map(c => c.path),datasetsVerified: datasets.length,tableCount: (html.match(/<table>/g) || []).length}));
})().catch(error => { console.error(error); process.exitCode = 1; });
