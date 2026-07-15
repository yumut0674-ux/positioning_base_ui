const endpoint = process.env.TRACKING_INGEST_URL ?? "http://localhost:3000/api/tracking/ingest";

const tags = [
  { tagCode: "TAG-001", x: 8.8, y: 7.8, battery: 86, phase: 0 },
  { tagCode: "TAG-014", x: 21.4, y: 12.4, battery: 71, phase: 2.1 },
  { tagCode: "TAG-028", x: 31.2, y: 4.2, battery: 94, phase: 4.2 },
  { tagCode: "TAG-036", x: 14.6, y: 18.3, battery: 63, phase: 5.6 },
];

let tick = 0;

async function publish() {
  tick += 0.13;
  const positions = tags.map((tag, index) => ({
    tagCode: tag.tagCode,
    x: Number((tag.x + Math.cos(tick + tag.phase) * (0.7 + index * 0.12)).toFixed(2)),
    y: Number((tag.y + Math.sin(tick * 0.8 + tag.phase) * (0.55 + index * 0.1)).toFixed(2)),
    battery: Number(Math.max(5, tag.battery - tick * 0.03).toFixed(1)),
  }));

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positions }),
    });
    if (!response.ok) throw new Error(await response.text());
    console.log(`[${new Date().toLocaleTimeString()}] ${positions.length} konum gönderildi`);
  } catch (error) {
    console.error("Konum gönderilemedi:", error.message);
  }
}

console.log(`UWB konum simülasyonu başlatıldı: ${endpoint}`);
void publish();
const timer = setInterval(() => { void publish(); }, 500);
process.on("SIGINT", () => {
  clearInterval(timer);
  console.log("Simülasyon durduruldu.");
  process.exit(0);
});
