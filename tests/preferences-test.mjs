import assert from "node:assert/strict";
import { createPreferences } from "../src/client/preferences.js";
let stored = null;
const storage = {
  getItem: () => stored,
  setItem: (_, value) => {
    stored = value;
  },
};
const preferences = createPreferences(storage);
assert.equal(preferences.snapshot(), false);
let notifications = 0;
const dispose = preferences.subscribe(() => notifications++);
preferences.setKeepOriginal(true);
assert.equal(createPreferences(storage).snapshot(), true);
preferences.setKeepOriginal(false);
assert.equal(createPreferences(storage).snapshot(), false);
assert.equal(notifications, 2);
dispose();
stored = "broken";
assert.equal(createPreferences(storage).snapshot(), false);
const blocked = createPreferences({
  getItem: () => null,
  setItem() {
    throw Error("storage unavailable");
  },
});
assert.throws(() => blocked.setKeepOriginal(true));
assert.equal(blocked.snapshot(), false);
console.log(
  "PASS default off, preference persistence, malformed storage and failed save",
);
