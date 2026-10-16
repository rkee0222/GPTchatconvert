import {
  ZipWriter,
  Uint8ArrayWriter,
  TextReader,
  Uint8ArrayReader,
} from "@zip.js/zip.js";
import { deflateSync } from "node:zlib";
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  t.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, data])), data.length + 8);
  return out;
}
function png() {
  const w = 400,
    h = 180,
    raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = 36 + Math.round(x / 4);
      raw[i + 1] = 92 + Math.round(y / 3);
      raw[i + 2] = 69;
    }
  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(w);
  hdr.writeUInt32BE(h, 4);
  hdr[8] = 8;
  hdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", hdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export const markdown = String.raw`# 합성 테스트: 한국어와 수식
이 대화는 **자동 검증용 합성 데이터**입니다. 실제 사용자 대화가 아닙니다.

## 서식과 링크
문단과 *기울임*, **강조**, ~~취소선~~, [참고 링크](https://example.com)를 보존합니다.

- 첫 번째 항목
- 두 번째 항목
  - 중첩 항목

1. 순서 하나
2. 순서 둘

> 인용문입니다. 한국어와 English를 함께 씁니다.

| 구분 | 내용 |
| --- | --- |
| 한국어 | 표가 페이지 너비를 넘지 않아야 합니다. |
| 긴 값 | abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789 |

코드의 들여쓰기:

\`\`\`python
for i in range(3):
    print("안녕하세요", i)
    if i == 2:
        print("마지막 줄")
\`\`\`

인라인 수식 $E = mc^2$, \(a^2+b^2=c^2\) 그리고 한 글자 $x$.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

\[
A = \begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}
\]

![ZIP 이미지](file-service://file-test-image)

![없는 이미지](file-service://file-not-found)

![외부 이미지](https://tracking.invalid/pixel.png)

<script>window.__xss = true</script>
<img src="https://tracking.invalid/raw.png" onerror="window.__xss=true">
[위험 링크](javascript:alert(1))

마지막 텍스트 보존 END-FORMATTING`.replaceAll("\\`", "`");
const message = (role, parts, extra = {}) => ({
  author: { role },
  content: { content_type: "multimodal_text", parts },
  ...extra,
});
export function conversations() {
  const map = {
    root: { parent: null, message: null },
    user: {
      parent: "root",
      message: message("user", ["합성 테스트 질문입니다."]),
    },
    old: {
      parent: "user",
      message: message("assistant", ["이전 분기: 표시되면 안 됨 OLD-BRANCH"]),
    },
    answer: {
      parent: "user",
      message: message("assistant", [
        markdown,
        {
          content_type: "image_asset_pointer",
          asset_pointer: "file-service://file-test-image",
        },
        {
          content_type: "audio_asset_pointer",
          audio_asset_pointer: "unavailable-audio",
        },
      ]),
    },
  };
  const ambiguous = {
    title: "합성 경로 선택",
    mapping: {
      r: { parent: null, message: message("user", ["공통 질문"]) },
      a: {
        parent: "r",
        message: message("assistant", ["첫 번째 분기 ONLY-A"]),
      },
      b: {
        parent: "r",
        message: message("assistant", ["두 번째 분기 ONLY-B"]),
      },
    },
  };
  const long = {
    title: "합성 긴 대화 160개",
    current_node: "n159",
    mapping: {},
  };
  for (let i = 0; i < 160; i++)
    long.mapping[`n${i}`] = {
      parent: i ? `n${i - 1}` : null,
      message: message(i % 2 ? "assistant" : "user", [
        `메시지 ${i} · ${"한국어 긴 대화의 줄바꿈과 페이지 나눔을 검증합니다. ".repeat(6)}\n\n${i === 159 ? "LONG-DOCUMENT-END" : "순서 보존."}`,
      ]),
    };
  // A single table/code/message substantially taller than a page exercises fragmentation.
  long.mapping.n159.message.content.parts.push(
    "\n\n| 행 | 값 |\n| --- | --- |\n" +
      Array.from(
        { length: 100 },
        (_, i) => `| ${i} | 긴 표 행 TABLE-${i} |`,
      ).join("\n") +
      "\n\n```text\n" +
      Array.from(
        { length: 160 },
        (_, i) => `    code-line-${i} ${"long-code-".repeat(15)}`,
      ).join("\n") +
      "\n```\n\nFINAL-PRINT-END",
  );
  return [
    {
      id: "synthetic",
      title: "합성 한국어 · 수식 · 표 · 이미지",
      create_time: 1700000000,
      current_node: "answer",
      mapping: map,
    },
    ambiguous,
    long,
  ];
}
export async function zipFixture(
  data = conversations(),
  filename = "export/conversations.json",
) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  });
  await writer.add(filename, new TextReader(JSON.stringify(data)));
  await writer.add(
    "export/file-test-image-picture.png",
    new Uint8ArrayReader(png()),
  );
  return Buffer.from(await writer.close());
}
