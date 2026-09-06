import { test } from "node:test";
import assert from "node:assert/strict";
import { findMatches, foldForSearch, nearestMatch, stepMatch } from "@/lib/shared";

const SENTENCES = [
  "The café was quiet that morning.",
  "She ordered a coffee and sat down.",
  "The CAFE across the street was not.",
  "Nothing else happened.",
];
const folded = SENTENCES.map(foldForSearch);

test("finds sentences containing the query", () => {
  assert.deepEqual(findMatches(folded, "coffee"), [1]);
});

test("ignores case", () => {
  assert.deepEqual(findMatches(folded, "NOTHING"), [3]);
});

test("ignores accents in either direction", () => {
  // "cafe" finds "café", and "café" finds "CAFE".
  assert.deepEqual(findMatches(folded, "cafe"), [0, 2]);
  assert.deepEqual(findMatches(folded, "café"), [0, 2]);
});

test("an empty or whitespace query matches nothing", () => {
  assert.deepEqual(findMatches(folded, ""), []);
  assert.deepEqual(findMatches(folded, "   "), []);
});

test("a query with no matches returns an empty list", () => {
  assert.deepEqual(findMatches(folded, "zebra"), []);
});

test("matches inside a word count", () => {
  assert.deepEqual(findMatches(folded, "orning"), [0]);
});

test("starts from the match nearest where the reader is", () => {
  const matches = [2, 9, 14];
  assert.equal(nearestMatch(matches, 0), 0, "before every match");
  assert.equal(nearestMatch(matches, 9), 1, "sitting exactly on one");
  assert.equal(nearestMatch(matches, 10), 2, "between two");
  assert.equal(nearestMatch(matches, 99), 2, "past the last one, stays on it");
  assert.equal(nearestMatch([], 5), 0, "no matches at all");
});

test("stepping through matches wraps at both ends", () => {
  const matches = [2, 9, 14];
  assert.equal(stepMatch(matches, 0, 1), 1);
  assert.equal(stepMatch(matches, 2, 1), 0, "forward past the end wraps to the start");
  assert.equal(stepMatch(matches, 0, -1), 2, "back past the start wraps to the end");
  assert.equal(stepMatch([], 0, 1), 0, "no matches is not an error");
});

test("folding leaves ordinary text alone", () => {
  assert.equal(foldForSearch("plain text 123"), "plain text 123");
});
