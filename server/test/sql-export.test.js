"use strict";
// Unit tests for SQL DDL generation (public/js/sql-export.js).
const { test } = require("node:test");
const assert = require("node:assert");
const { toSql } = require("../../public/js/sql-export.js");

const tbl = (id, name, columns) => ({ type: "dbtable", id, name, columns });

test("empty model produces a comment, not DDL", () => {
  assert.match(toSql({ elements: [], relationships: [] }), /No database tables/);
});

test("CREATE TABLE emits columns, PK, NOT NULL, UNIQUE, DEFAULT", () => {
  const sql = toSql({
    elements: [tbl("c", "customer", [
      { name: "id", dataType: "INT", pk: true, nullable: false },
      { name: "email", dataType: "VARCHAR(255)", nullable: false, unique: true },
      { name: "status", dataType: "TEXT", defaultValue: "'new'" },
    ])],
    relationships: [],
  });
  assert.match(sql, /CREATE TABLE customer \(/);
  assert.match(sql, /id INT NOT NULL/);
  assert.match(sql, /email VARCHAR\(255\) NOT NULL UNIQUE/);
  assert.match(sql, /status TEXT DEFAULT 'new'/);
  assert.match(sql, /PRIMARY KEY \(id\)/);
});

test("composite primary key lists all PK columns", () => {
  const sql = toSql({
    elements: [tbl("l", "link", [
      { name: "a_id", dataType: "INT", pk: true, nullable: false },
      { name: "b_id", dataType: "INT", pk: true, nullable: false },
    ])],
    relationships: [],
  });
  assert.match(sql, /PRIMARY KEY \(a_id, b_id\)/);
});

test("reserved-word table names are quoted", () => {
  const sql = toSql({
    elements: [tbl("o", "order", [{ name: "id", dataType: "INT", pk: true, nullable: false }])],
    relationships: [],
  });
  assert.match(sql, /CREATE TABLE "order"/);
});

test("foreign keys emit ALTER TABLE ... REFERENCES", () => {
  const sql = toSql({
    elements: [
      tbl("c", "customer", [{ name: "id", dataType: "INT", pk: true, nullable: false }]),
      tbl("o", "orders", [
        { name: "id", dataType: "INT", pk: true, nullable: false },
        { name: "customer_id", dataType: "INT", nullable: false },
      ]),
    ],
    relationships: [{ type: "fk", sourceId: "o", targetId: "c", fkColumn: "customer_id", refColumn: "id" }],
  });
  assert.match(sql, /ALTER TABLE orders ADD CONSTRAINT \S+ FOREIGN KEY \(customer_id\) REFERENCES customer \(id\);/);
});

test("missing data type falls back to TEXT", () => {
  const sql = toSql({ elements: [tbl("t", "t", [{ name: "x" }])], relationships: [] });
  assert.match(sql, /x TEXT/);
});
