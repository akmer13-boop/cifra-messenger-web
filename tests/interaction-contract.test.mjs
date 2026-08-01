import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

async function parsePage() {
  const source = await readFile(pageUrl, "utf8");
  return {
    source,
    file: ts.createSourceFile(
      pageUrl.pathname,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  };
}

function jsxAttributes(node) {
  return new Map(
    node.attributes.properties
      .filter(ts.isJsxAttribute)
      .map((attribute) => [attribute.name.text, attribute]),
  );
}

test("every button is wired to an action", async () => {
  const { file } = await parsePage();
  const missing = [];
  let buttonCount = 0;

  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (opening.tagName.getText(file) === "button") {
        buttonCount += 1;
        const attributes = jsxAttributes(opening);
        const hasAction = ["onClick", "onPointerDown", "onSubmit"].some(
          (name) => attributes.has(name),
        );
        const type = attributes.get("type")?.initializer?.getText(file) ?? "";
        if (!hasAction && !type.includes("submit")) {
          const position = file.getLineAndCharacterOfPosition(
            opening.getStart(file),
          );
          missing.push(position.line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  assert.ok(buttonCount >= 110, `Expected full UI coverage, found ${buttonCount}`);
  assert.deepEqual(missing, []);
});

test("interface symbols remain valid UTF-8 and icon imports compile", async () => {
  const { source } = await parsePage();

  assert.doesNotMatch(source, /\uFFFD/);
  assert.match(source, /const emojiSets: Record<EmojiCategory, string\[]>/);
  assert.match(source, /ArchiveRestore/);
  assert.match(source, /MicOff/);
  assert.match(source, /VideoOff/);
  assert.match(source, /VolumeX/);
});

test("every text entry has an accessible name or enclosing label", async () => {
  const { file } = await parsePage();
  const missing = [];

  function visit(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      ["input", "textarea"].includes(node.tagName.getText(file))
    ) {
      const attributes = jsxAttributes(node);
      let parent = node.parent;
      let enclosedByLabel = false;
      while (parent && !ts.isSourceFile(parent)) {
        if (
          ts.isJsxElement(parent) &&
          parent.openingElement.tagName.getText(file) === "label"
        ) {
          enclosedByLabel = true;
          break;
        }
        parent = parent.parent;
      }
      const named =
        attributes.has("aria-label") ||
        attributes.has("aria-labelledby") ||
        attributes.has("hidden") ||
        enclosedByLabel;
      if (!named) {
        const position = file.getLineAndCharacterOfPosition(node.getStart(file));
        missing.push(position.line + 1);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  assert.deepEqual(missing, []);
});

test("messages are scoped to the selected chat", async () => {
  const { source } = await parsePage();

  assert.match(source, /initialMessagesByChat/);
  assert.match(
    source,
    /const \[messagesByChat, setMessagesByChat\][\s\S]*initialMessagesByChat/,
  );
  assert.match(
    source,
    /const sendMessage = \(\s*chatId: string,\s*text: string,\s*options: SendMessageOptions/,
  );
  assert.match(source, /\[chatId\]: \[[\s\S]*current\[chatId\]/);
  assert.match(source, /const clearMessages = \(chatId: string\)/);
  assert.doesNotMatch(source, /useState<Message\[]>\(initialMessages\)/);
});

test("calls keep the selected participants and expose working controls", async () => {
  const { source } = await parsePage();

  assert.match(source, /onClick=\{\(\) => onCall\(call\.participantIds\)\}/);
  assert.match(source, /selectedChat\.memberIds \?\? \[\]/);
  assert.match(source, /const \[micOn, setMicOn\] = useState\(true\)/);
  assert.match(source, /const \[speakerOn, setSpeakerOn\] = useState\(true\)/);
  assert.match(source, /const \[cameraOn, setCameraOn\] = useState\(true\)/);
  assert.match(source, /aria-label=\{micOn \? "Выключить микрофон"/);
  assert.match(source, /aria-label=\{cameraOn \? "Выключить камеру"/);
});

test("media, files and voice messages all have interactive previews", async () => {
  const { source } = await parsePage();

  assert.match(source, /function ContentPreview/);
  assert.match(source, /onOpen=\{openMediaPreview\}/);
  assert.match(source, /setPreviewContent\(\{[\s\S]*kind: "file"/);
  assert.match(source, /playingVoiceId === message\.id/);
  assert.match(source, /<Pause size=\{13\}/);
  assert.match(source, /<Play size=\{13\}/);
});

test("global notification modes persist and the one-hour mode expires", async () => {
  const { source } = await parsePage();

  assert.match(source, /"cifra-notification-mode"/);
  assert.match(source, /"cifra-notification-until"/);
  assert.match(source, /Date\.now\(\) \+ 60 \* 60 \* 1000/);
  assert.match(source, /Math\.max\(remaining, 0\)/);
  assert.match(source, /notificationsEnabled=\{notificationMode === "on"\}/);
  assert.match(source, /onNotificationModeChange\(option\.id\)/);
});

test("admin audit is read-only, selected-user scoped and server backed", async () => {
  const { source } = await parsePage();

  assert.match(source, /messagesByChat: Record<string, Message\[]>/);
  assert.match(source, /selectedAuditMessages/);
  assert.match(source, /buildLocalAuditDataset\(/);
  assert.match(source, /buildComplianceAuditDataset\(/);
  assert.match(source, /dataset\.chats\.map\(\(chat\) =>/);
  assert.match(source, /client\.searchComplianceMetadata\(\{/);
  assert.match(source, /author_id: user\.backendId/);
  assert.match(source, /topic_id: topicId/);
  assert.match(source, /onClick=\{\(\) => onAudit\(user\)\}/);
  assert.doesNotMatch(source, /onClick=\{\(\) => onAudit\(draft\)\}/);
  assert.match(source, /Только чтение/);
  assert.match(source, /текст сообщений текущим API не раскрывается/);
});

test("admin form validates identity fields before saving", async () => {
  const { source } = await parsePage();

  assert.match(source, /const normalizedDraft: MessengerUser/);
  assert.match(source, /const canSave =/);
  assert.match(source, /disabled=\{!canSave \|\| saving\}/);
  assert.match(source, /await onSave\(normalizedDraft\)/);
});

test("hidden swipe actions stay outside keyboard navigation", async () => {
  const { source } = await parsePage();

  assert.match(source, /tabIndex=\{showPin \? 0 : -1\}/);
  assert.match(source, /tabIndex=\{showMute \? 0 : -1\}/);
  assert.match(source, /tabIndex=\{showDelete \? 0 : -1\}/);
  assert.match(source, /tabIndex=\{showArchive \? 0 : -1\}/);
  assert.match(source, /data-swipe-limit="0\.40"/);
});

test("iOS CSS includes safe areas, Safari prefixes and 44px search actions", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(css, /padding-top: env\(safe-area-inset-top\)/);
  assert.match(css, /padding-bottom: env\(safe-area-inset-bottom\)/);
  assert.match(css, /-webkit-backdrop-filter:/);
  assert.match(css, /-webkit-mask-image:/);
  assert.match(css, /-webkit-text-size-adjust: 100%/);
  assert.match(
    css,
    /\.search-field > button\s*\{[^}]*width: 44px;[^}]*height: 44px/s,
  );
  assert.match(
    css,
    /@media \(max-width: 600px\)[\s\S]*?\.tab-bar\s*\{\s*margin-bottom: 8px;/,
  );
  assert.match(
    css,
    /\.media-tabs\s*\{[^}]*grid-template-columns: repeat\(2, 1fr\)/s,
  );
});
