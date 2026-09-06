import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Reader from "@/app/Reader";
import { VOICES, segmentMarkdown, segmentText } from "@/lib/shared";

// A smoke test, not a UI test: it renders the reader the way the server does
// and checks the controls are there. There is no DOM here, so effects and
// interaction are out of reach — but this does catch a component that throws on
// its first render, which the type checker cannot.

function render(props: Partial<Parameters<typeof Reader>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(Reader, {
      title: "A document",
      paragraphs: segmentText("Hello there. How are you today?\n\nA second paragraph."),
      voice: VOICES[0].id,
      voices: VOICES,
      onClose: () => {},
      text: "Hello there. How are you today?\n\nA second paragraph.",
      documentId: 1,
      ...props,
    })
  );
}

test("the reader renders its document", () => {
  const html = render();
  assert.match(html, /Hello there\./);
  assert.match(html, /A second paragraph\./);
  assert.match(html, /A document/, "the title is shown");
});

test("the reader offers its controls", () => {
  const html = render();
  for (const label of [
    "Play",
    "Next sentence",
    "Previous sentence",
    "Find in document",
    "Keyboard shortcuts",
    "Reading settings",
    "Download MP3",
    "Download text",
  ]) {
    assert.match(html, new RegExp(`aria-label="${label}"`), `missing control: ${label}`);
  }
});

test("a Markdown document offers a Markdown download", () => {
  const html = render({
    isMarkdown: true,
    paragraphs: segmentMarkdown("# Heading\n\nSome prose."),
    text: "# Heading\n\nSome prose.",
  });
  assert.match(html, /aria-label="Download Markdown"/);
  assert.match(html, /Heading/);
});

test("a document opened without a library entry hides what it can't save", () => {
  // No documentId means nothing to write back to: no editing, no bookmarks.
  const html = render({ documentId: null, text: undefined });
  assert.doesNotMatch(html, /aria-label="Edit text"/);
  assert.doesNotMatch(html, /aria-label="Bookmarks and highlights"/);
  assert.match(html, /aria-label="Play"/, "but it still plays");
});

test("an empty document renders without controls that would do nothing", () => {
  const html = render({ paragraphs: [], text: "" });
  assert.doesNotMatch(html, /aria-label="Download MP3"/);
});
