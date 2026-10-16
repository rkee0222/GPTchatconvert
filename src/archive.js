import {
  ZipReader,
  BlobReader,
  TextWriter,
  BlobWriter,
  configure,
} from "@zip.js/zip.js";
import { parseExport, assetCandidates } from "./parser.js";
configure({ useWebWorkers: false });
const MAX_JSON = 256 * 1024 * 1024,
  MAX_IMAGE = 30 * 1024 * 1024,
  MAX_TOTAL = 300 * 1024 * 1024;
export class ExportArchive {
  constructor(file) {
    this.reader = new ZipReader(new BlobReader(file));
    this.urls = new Map();
    this.total = 0;
  }
  async load(onProgress) {
    onProgress("ZIP 목차를 읽는 중…");
    try {
      this.entries = (await this.reader.getEntries()).filter(
        (e) => !e.directory,
      );
    } catch {
      throw new Error(
        "ZIP 목차를 읽을 수 없습니다. 파일이 손상되었거나 ZIP 형식이 아닙니다. 압축을 다시 받거나 ChatGPT에서 다시 내보낸 뒤 선택해 주세요.",
      );
    }
    const jsons = this.entries.filter(
      (e) =>
        /(^|\/)conversations\.json$/i.test(e.filename) &&
        !e.filename.startsWith("__MACOSX/"),
    );
    if (jsons.length !== 1)
      throw new Error(
        jsons.length
          ? "conversations.json이 여러 개입니다. 내보내기 ZIP 하나만 사용해 주세요."
          : "ZIP에서 conversations.json을 찾지 못했습니다. chat.html만 있는 파일이나 개별 대화 ZIP은 지원하지 않습니다. ChatGPT의 전체 데이터 내보내기를 사용해 주세요.",
      );
    const entry = jsons[0];
    if (entry.uncompressedSize > MAX_JSON)
      throw new Error(
        "conversations.json이 256 MiB를 넘습니다. 메모리가 충분한 PC에서 파일을 분할하는 별도 도구가 필요합니다. 이 페이지에서는 이 크기를 지원하지 않습니다.",
      );
    let source;
    try {
      source = await entry.getData(new TextWriter(), {
        checkSignature: true,
        onprogress: (n, t) =>
          onProgress(
            "대화 JSON 압축을 해제하는 중…",
            t ? Math.round((n / t) * 85) : undefined,
          ),
      });
    } catch (e) {
      throw new Error(
        `대화 파일을 읽을 수 없습니다. ZIP 손상 또는 암호화 여부를 확인하고 다시 내보내 주세요. (${e.message})`,
      );
    }
    onProgress("대화 목록을 분석하는 중…", 90);
    await new Promise((r) => setTimeout(r, 30));
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error(
        "conversations.json을 JSON으로 해석할 수 없습니다. 손상되지 않은 원본 내보내기 ZIP을 선택해 주세요.",
      );
    }
    return parseExport(parsed);
  }
  async image(pointer) {
    const matches = assetCandidates(
      pointer,
      this.entries.map((e) => e.filename),
    );
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? "같은 이름의 파일이 여러 개라 연결할 수 없습니다."
          : "ZIP 안에 연결할 수 있는 이미지 파일이 없습니다.",
      );
    const name = matches[0];
    if (this.urls.has(name)) return this.urls.get(name);
    const entry = this.entries.find((e) => e.filename === name);
    if (
      entry.uncompressedSize > MAX_IMAGE ||
      this.total + entry.uncompressedSize > MAX_TOTAL
    )
      throw new Error(
        "이미지 메모리 한도를 초과했습니다 (파일 30 MiB, 합계 300 MiB).",
      );
    const blob = await entry.getData(new BlobWriter(), {
      checkSignature: true,
    });
    if (this.closed) throw new Error("다른 ZIP 파일로 전환되었습니다.");
    // Only raster image signatures are accepted. SVG/HTML can contain active content.
    const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const s = String.fromCharCode(...b);
    const type =
      b[0] === 137 && s.slice(1, 4) === "PNG"
        ? "image/png"
        : b[0] === 255 && b[1] === 216 && b[2] === 255
          ? "image/jpeg"
          : s.startsWith("GIF8")
            ? "image/gif"
            : s.startsWith("RIFF") && s.slice(8, 12) === "WEBP"
              ? "image/webp"
              : null;
    if (!type)
      throw new Error(
        "지원하지 않는 이미지 형식입니다. PNG, JPEG, GIF, WebP만 표시합니다.",
      );
    this.total += blob.size;
    const url = URL.createObjectURL(new Blob([blob], { type }));
    this.urls.set(name, url);
    return url;
  }
  releaseImages() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.total = 0;
  }
  async close() {
    this.closed = true;
    this.releaseImages();
    await this.reader.close();
  }
}
