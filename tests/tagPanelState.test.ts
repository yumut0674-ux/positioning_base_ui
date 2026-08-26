import assert from "node:assert/strict";
import test from "node:test";
import {
  addRecentTagId,
  formatLocationDuration,
  nextTagLocationEntry,
  parseRecentTagIds,
  persistRecentTagIds,
  readRecentTagIds,
} from "../src/features/tracking/services/tagPanelState";
import { useIpsStore } from "../src/app/store/useIpsStore";

function tag(overrides: Partial<{ id: string; x: number; y: number; timestamp: number }> = {}) {
  return {
    id: overrides.id ?? "TAG-001",
    name: "Test Tag",
    color: "#00a896",
    status: "active" as const,
    x: overrides.x ?? 9,
    y: overrides.y ?? 17,
    timestamp: overrides.timestamp ?? 1_000,
  };
}

test("recent tags remain unique, newest first, and limited to five", () => {
  let recent = ["TAG-001", "TAG-002", "TAG-003", "TAG-004", "TAG-005"];
  recent = addRecentTagId(recent, "TAG-003");
  assert.deepEqual(recent, ["TAG-003", "TAG-001", "TAG-002", "TAG-004", "TAG-005"]);
  assert.deepEqual(addRecentTagId(recent, "TAG-006"), ["TAG-006", "TAG-003", "TAG-001", "TAG-002", "TAG-004"]);
});

test("recent tags serialize and restore through browser storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  persistRecentTagIds(storage, ["TAG-004", "TAG-003", "TAG-004"]);
  assert.deepEqual(readRecentTagIds(storage), ["TAG-004", "TAG-003"]);
  assert.deepEqual(parseRecentTagIds("invalid"), []);
});

test("location entry time is retained in the same area and reset after an area change", () => {
  const first = nextTagLocationEntry(undefined, tag({ x: 9, y: 17, timestamp: 1_000 }));
  const sameArea = nextTagLocationEntry(first, tag({ x: 10, y: 18, timestamp: 9_000 }));
  const differentArea = nextTagLocationEntry(sameArea, tag({ x: 31, y: 16, timestamp: 12_000 }));

  assert.equal(sameArea.enteredAt, 1_000);
  assert.equal(differentArea.enteredAt, 12_000);
  assert.notEqual(differentArea.locationLabel, first.locationLabel);
  assert.equal(formatLocationDuration(1_000, 1_123_000), "18 dk 42 sn");
  assert.equal(formatLocationDuration(1_000, 8_041_000), "2 sa 14 dk");
});

test("tag selection records the visit and creates one map focus request", () => {
  const original = useIpsStore.getState();
  useIpsStore.setState({ selectedTagId: null, recentTagIds: [], mapFocusRequest: 12 });
  try {
    useIpsStore.getState().selectTagAndFocus("TAG-014");
    const state = useIpsStore.getState();
    assert.equal(state.selectedTagId, "TAG-014");
    assert.deepEqual(state.recentTagIds, ["TAG-014"]);
    assert.equal(state.mapFocusRequest, 13);
  } finally {
    useIpsStore.setState({
      selectedTagId: original.selectedTagId,
      recentTagIds: original.recentTagIds,
      mapFocusRequest: original.mapFocusRequest,
    });
  }
});
