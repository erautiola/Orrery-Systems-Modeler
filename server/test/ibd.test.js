"use strict";
// Unit tests for the "Create IBD from a block" model logic (pure, no DOM).
const { test } = require("node:test");
const assert = require("node:assert");
const Model = require("../../public/js/model.js");

// small helper: a model with a Car block composed of Wheel (x4) and Engine,
// aggregating a Radio, plus a pre-existing owned part.
function carModel() {
  const m = Model.newModel();
  const car = Model.newElement("block"); car.name = "Car";
  const wheel = Model.newElement("block"); wheel.name = "Wheel";
  const engine = Model.newElement("block"); engine.name = "Engine";
  const radio = Model.newElement("block"); radio.name = "Radio";
  m.elements.push(car, wheel, engine, radio);

  const comp1 = Model.newRelationship("composition", car.id, wheel.id);
  comp1.targetRole = "frontWheel"; comp1.targetMult = "2";
  const comp2 = Model.newRelationship("composition", car.id, engine.id); // no role -> derived
  const agg = Model.newRelationship("aggregation", car.id, radio.id);
  m.relationships.push(comp1, comp2, agg);

  return { m, car, wheel, engine, radio };
}

test("blockParts enumerates composition + aggregation targets", () => {
  const { m, car } = carModel();
  const rows = Model.blockParts(m, car.id);
  assert.equal(rows.length, 3);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  // explicit role wins
  assert.ok(byName.frontWheel);
  assert.equal(byName.frontWheel.typeName, "Wheel");
  assert.equal(byName.frontWheel.mult, "2");
  assert.equal(byName.frontWheel.source, "composition");
  // derived name = lower-cased type name
  assert.ok(byName.engine, "engine derived from Engine");
  // aggregation included
  assert.equal(byName.radio.source, "aggregation");
});

test("blockParts includes pre-existing owned parts and de-dupes", () => {
  const { m, car } = carModel();
  const existing = Model.newElement("part");
  existing.name = "gps"; existing.ownerId = car.id;
  existing.attributes = [Object.assign(Model.newAttribute(""), { name: "", type: "Gps" })];
  m.elements.push(existing);

  const rows = Model.blockParts(m, car.id);
  const owned = rows.find((r) => r.source === "owned");
  assert.ok(owned, "owned part surfaced");
  assert.equal(owned.name, "gps");
  assert.equal(owned.typeName, "Gps");
  assert.equal(owned.existingPartId, existing.id);
});

test("blockParts is empty for a block with no structure", () => {
  const m = Model.newModel();
  const b = Model.newElement("block"); b.name = "Lonely"; m.elements.push(b);
  assert.deepEqual(Model.blockParts(m, b.id), []);
});

test("createIbdFromBlock builds a tagged ibd with typed, owned parts", () => {
  const { m, car } = carModel();
  const rows = Model.blockParts(m, car.id);
  const before = m.elements.length;
  const d = Model.createIbdFromBlock(m, car.id, rows, "Car IBD");

  assert.equal(d.type, "ibd");
  assert.equal(d.blockId, car.id, "diagram tagged with owning block");
  assert.equal(d.name, "Car IBD");
  assert.ok(m.diagrams.includes(d), "diagram added to model");

  // one node per chosen row
  assert.equal(d.nodes.length, rows.length);
  // three new part elements created (one per row, none reused)
  assert.equal(m.elements.length, before + rows.length);

  for (const n of d.nodes) {
    const part = Model.elementById(m, n.elementId);
    assert.equal(part.type, "part");
    assert.equal(part.ownerId, car.id, "part owned by the block");
    assert.ok(part.attributes[0].type, "part carries a type");
    // node has geometry
    assert.equal(typeof n.x, "number");
    assert.equal(typeof n.w, "number");
  }
});

test("createIbdFromBlock reuses existing owned parts instead of duplicating", () => {
  const { m, car } = carModel();
  const existing = Model.newElement("part");
  existing.name = "gps"; existing.ownerId = car.id;
  m.elements.push(existing);

  const rows = Model.blockParts(m, car.id);
  const ownedRow = rows.find((r) => r.existingPartId === existing.id);
  const before = m.elements.length;
  const d = Model.createIbdFromBlock(m, car.id, [ownedRow], "Reuse");

  // no new element created for the reused part
  assert.equal(m.elements.length, before);
  assert.equal(d.nodes.length, 1);
  assert.equal(d.nodes[0].elementId, existing.id);
});

test("blockPorts lists boundary ports and ports nested on the block's parts", () => {
  const { m, car } = carModel();
  // a boundary port on the Car block
  const bp = Model.newElement("port"); bp.name = "power"; bp.ownerId = car.id;
  // a part owned by Car, with a port on it
  const part = Model.newElement("part"); part.name = "enginePart"; part.ownerId = car.id;
  const np = Model.newElement("port"); np.name = "fuelIn"; np.ownerId = part.id;
  // an unrelated free port (should not appear)
  const free = Model.newElement("port"); free.name = "loose"; free.ownerId = null;
  m.elements.push(bp, part, np, free);

  const ports = Model.blockPorts(m, car.id);
  assert.equal(ports.length, 2);
  const boundary = ports.find((p) => p.scope === "boundary");
  const nested = ports.find((p) => p.scope === "part");
  assert.equal(boundary.name, "power");
  assert.equal(boundary.onId, car.id);
  assert.equal(nested.name, "fuelIn");
  assert.equal(nested.onName, "enginePart");
  assert.ok(!ports.some((p) => p.name === "loose"), "free port excluded");
});

test("boundaryBand detects the frame-edge band (for boundary ports)", () => {
  const r = { x: 100, y: 100, w: 200, h: 120 }; // 100..300 x, 100..220 y
  const m = 26;
  // on the left edge -> in band
  assert.equal(Model.boundaryBand(100, 160, r, m), true);
  // just inside the top edge -> in band
  assert.equal(Model.boundaryBand(200, 110, r, m), true);
  // a corner -> in band
  assert.equal(Model.boundaryBand(300, 220, r, m), true);
  // deep interior -> not in band
  assert.equal(Model.boundaryBand(200, 160, r, m), false);
  // far outside -> not in band
  assert.equal(Model.boundaryBand(500, 160, r, m), false);
  // just outside the edge but within margin -> in band
  assert.equal(Model.boundaryBand(90, 160, r, m), true);
});

test("createIbdFromBlock with no parts still yields an empty ibd", () => {
  const m = Model.newModel();
  const b = Model.newElement("block"); b.name = "Empty"; m.elements.push(b);
  const d = Model.createIbdFromBlock(m, b.id, [], null);
  assert.equal(d.type, "ibd");
  assert.equal(d.blockId, b.id);
  assert.equal(d.nodes.length, 0);
  assert.match(d.name, /Empty/);
});
