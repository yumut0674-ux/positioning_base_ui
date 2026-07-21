const endpoint = process.env.TRACKING_INGEST_URL ?? "http://localhost:3000/api/tracking/ingest";

const tags = [
  { tagId: "TAG-001", x: 8.8, y: 7.8, phase: 0 },
  { tagId: "TAG-014", x: 21.4, y: 12.4, phase: 2.1 },
  { tagId: "TAG-028", x: 31.2, y: 4.2, phase: 4.2 },
  { tagId: "TAG-036", x: 14.6, y: 18.3, phase: 5.6 },
];

let tick = 0;

async function publish() {
  tick += 0.13;
  const positions = tags.map((tag, index) => ({
    type: "position",
    tag_id: tag.tagId,
    x: Number((tag.x + Math.cos(tick + tag.phase) * (0.7 + index * 0.12)).toFixed(2)),
    y: Number((tag.y + Math.sin(tick * 0.8 + tag.phase) * (0.55 + index * 0.1)).toFixed(2)),
    timestamp: new Date().toISOString(),
  }));

  try {
    const responses = await Promise.all(positions.map((position) => fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(position),
    })));
    const failedResponse = responses.find((response) => !response.ok);
    if (failedResponse) throw new Error(await failedResponse.text());
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
