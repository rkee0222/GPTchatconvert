import test from "node:test";
import assert from "node:assert/strict";
import {
  parseExport,
  getBranches,
  getPath,
  messageParts,
  assetCandidates,
} from "../src/parser.js";
const m = (text) => ({
  author: { role: "assistant" },
  content: { content_type: "text", parts: [text] },
});
const c = {
  title: "합성 분기",
  current_node: "b",
  mapping: {
    root: { parent: null, message: null },
    u: { parent: "root", message: m("질문") },
    a: { parent: "u", message: m("이전 답변") },
    b: { parent: "u", message: m("현재 답변") },
  },
};
test("current_node의 조상만 복원하고 재생성된 형제 답변은 제외한다", () => {
  assert.equal(getBranches(c).selected, "b");
  assert.deepEqual(
    getPath(c, "b").map((x) => x.content.parts[0]),
    ["질문", "현재 답변"],
  );
});
test("현재 경로가 없고 분기가 여러 개면 자동으로 고르지 않는다", () => {
  const branches = getBranches({ ...c, current_node: "missing" });
  assert.equal(branches.selected, null);
  assert.equal(branches.reason, "choose");
  assert.deepEqual(branches.options, ["a", "b"]);
});
test("단일 경로와 빈 mapping을 구분한다", () => {
  assert.equal(
    getBranches({ mapping: { a: { parent: null, message: m("끝") } } })
      .selected,
    "a",
  );
  assert.deepEqual(getBranches({ mapping: {} }).options, []);
});
test("순환 및 누락 부모를 오류로 처리한다", () => {
  assert.throws(
    () => getPath({ mapping: { a: { parent: "b" }, b: { parent: "a" } } }, "a"),
    /순환/,
  );
  assert.throws(
    () => getPath({ mapping: { a: { parent: "missing" } } }, "a"),
    /부모/,
  );
  assert.throws(() => getBranches({ mapping: { a: { parent: "a" } } }), /순환/);
});
test("현재 노드가 잎이 아니어도 그 지점까지만 복원한다", () => {
  assert.equal(getBranches({ ...c, current_node: "u" }).selected, "u");
  assert.equal(getPath(c, "u").length, 1);
});
test("지원하는 래퍼만 허용하고 잘못된 대화를 조용히 버리지 않는다", () => {
  assert.equal(parseExport([c])[0].title, c.title);
  assert.equal(parseExport({ conversations: [c] })[0].key, "0");
  assert.throws(() => parseExport({ foo: [] }), /지원하는 형식/);
  assert.throws(() => parseExport([c, { title: "오류" }]), /2번째/);
  assert.throws(() => parseExport([]), /대화가 없습니다/);
});
test("텍스트·이미지·미지원 콘텐츠 순서를 보존한다", () => {
  const value = {
    content: {
      content_type: "multimodal_text",
      parts: [
        "먼저",
        {
          content_type: "image_asset_pointer",
          asset_pointer: "file-service://file-123",
        },
        { content_type: "audio_asset_pointer", audio_asset_pointer: "x" },
        "끝",
      ],
    },
  };
  const parts = messageParts(value);
  assert.deepEqual(
    parts.map((p) => p.type),
    ["markdown", "image", "unsupported", "markdown"],
  );
  assert.equal(parts[2].value.audio_asset_pointer, "x");
});
test("이미지 매칭은 정확하거나 명확한 파일 ID만 허용한다", () => {
  const names = [
    "nested/file-123-photo.png",
    "other/image.png",
    "same/image.png",
  ];
  assert.deepEqual(assetCandidates("file-service://file-123", names), [
    names[0],
  ]);
  assert.equal(assetCandidates("image.png", names).length, 2);
  assert.deepEqual(assetCandidates("https://example.com/image.png", names), []);
  assert.deepEqual(assetCandidates("../image.png", names), []);
  assert.deepEqual(assetCandidates("file-service://file-12", names), []);
});
