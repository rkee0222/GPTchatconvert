import { Marked } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import { messageParts } from "./parser.js";
for (const [n, l] of Object.entries({ javascript, python, json, bash }))
  hljs.registerLanguage(n, l);
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const mathHTML = (value, display) =>
  `<span class="math-source${display ? " math-display" : ""}" data-math="${escape(encodeURIComponent(value))}" data-display="${display}"></span>`;
const markdown = new Marked({ gfm: true, breaks: false });
markdown.use({
  renderer: {
    html: (token) =>
      `<pre class="raw-html" aria-label="실행하지 않은 원문 HTML">${escape(token.text)}</pre>`,
    link(token) {
      const label = this.parser.parseInline(token.tokens);
      if (!/^(https?:|mailto:|#)/i.test(token.href))
        return `${label} <span class="notice">(지원하지 않는 링크: <code>${escape(token.href)}</code>)</span>`;
      return `<a href="${escape(token.href)}"${token.title ? ` title="${escape(token.title)}"` : ""}>${label}</a>`;
    },
    image: (token) =>
      `<span class="image-slot" data-image="${escape(token.href)}" data-alt="${escape(token.text || "대화 이미지")}"></span>`,
  },
  extensions: [
    {
      name: "mathBlock",
      level: "block",
      start: (s) => s.search(/\$\$|\\\[/),
      tokenizer(s) {
        const m = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:\n|$)/.exec(s);
        if (m) return { type: "mathBlock", raw: m[0], text: m[1] ?? m[2] };
      },
      renderer: (t) => mathHTML(t.text, true),
    },
    {
      name: "mathInline",
      level: "inline",
      start: (s) => s.search(/\$|\\\(/),
      tokenizer(s) {
        const m =
          /^(?:\\\(([\s\S]+?)\\\)|\$\$([\s\S]+?)\$\$|\$(?!\s)([^$\n]*?[^\s$])\$(?!\d))/.exec(
            s,
          );
        if (m)
          return {
            type: "mathInline",
            raw: m[0],
            text: m[1] ?? m[2] ?? m[3],
            display: m[2] != null,
          };
      },
      renderer: (t) => mathHTML(t.text, t.display || false),
    },
  ],
});
function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
export function unsupported(value, title = "지원하지 않는 요소 · 원문 데이터") {
  const box = node("details", "unsupported");
  box.open = true;
  box.append(
    node("summary", "", title),
    node("pre", "", JSON.stringify(value, null, 2) ?? String(value)),
  );
  return box;
}
async function renderImage(slot, pointer, alt, archive) {
  try {
    const url = await archive.image(pointer),
      img = node("img", "conversation-image");
    img.alt = alt;
    img.src = url;
    await Promise.race([
      img.decode(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("이미지 디코딩 시간이 초과되었습니다.")),
          15000,
        ),
      ),
    ]);
    slot.replaceChildren(img, node("figcaption", "", alt));
  } catch (e) {
    slot.classList.add("missing-image");
    slot.replaceChildren(
      node("strong", "", "이미지를 표시할 수 없습니다"),
      node("p", "", `${alt} · ${e.message}`),
      node("code", "", pointer),
    );
  }
}
async function renderMarkdown(text, archive) {
  const el = node("div", "markdown");
  el.innerHTML = DOMPurify.sanitize(markdown.parse(text), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      "style",
      "svg",
      "math",
      "iframe",
      "form",
      "input",
      "video",
      "audio",
      "object",
    ],
    FORBID_ATTR: ["style", "src", "srcset"],
    ALLOW_DATA_ATTR: true,
  });
  for (const link of el.querySelectorAll("a")) {
    const href = link.getAttribute("href") || "";
    if (!/^(https?:|mailto:|#)/i.test(href)) {
      link.removeAttribute("href");
      link.title = "지원하지 않는 링크 주소";
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  for (const math of el.querySelectorAll("[data-math]")) {
    const source = decodeURIComponent(math.dataset.math);
    try {
      katex.render(source, math, {
        displayMode: math.dataset.display === "true",
        throwOnError: true,
        trust: false,
        strict: "warn",
        maxExpand: 1000,
        maxSize: 20,
        output: "htmlAndMathml",
      });
    } catch {
      math.replaceChildren(
        node("span", "math-error", "수식 렌더링 불가 · 원문: "),
        node("code", "", source),
      );
    }
  }
  for (const code of el.querySelectorAll("pre code")) {
    const lang = [...code.classList]
      .find((c) => c.startsWith("language-"))
      ?.slice(9);
    if (lang && hljs.getLanguage(lang))
      code.innerHTML = hljs.highlight(code.textContent, {
        language: lang,
      }).value;
  }
  for (const slot of el.querySelectorAll("[data-image]"))
    await renderImage(slot, slot.dataset.image, slot.dataset.alt, archive);
  return el;
}
const roles = {
  user: "사용자",
  assistant: "ChatGPT",
  system: "시스템",
  developer: "개발자",
  tool: "도구",
  function: "함수",
};
export async function renderMessage(message, archive) {
  const section = node("section", "message"),
    role = message.author?.role || "unknown";
  section.dataset.role = role;
  const header = node("div", "message-heading");
  header.append(
    node("span", "role-tag", roles[role] || `알 수 없는 발화자 (${role})`),
  );
  if (message.author?.name)
    header.append(node("span", "author-name", message.author.name));
  if (message.recipient && message.recipient !== "all")
    header.append(node("span", "recipient", `→ ${message.recipient}`));
  section.append(header);
  const parts = messageParts(message);
  if (!parts.length)
    section.append(node("p", "notice", "이 메시지는 내용이 비어 있습니다."));
  for (const part of parts) {
    if (part.type === "markdown")
      section.append(await renderMarkdown(part.value, archive));
    else if (part.type === "code") {
      const pre = node("pre", "plain-code");
      pre.append(node("code", "", part.value));
      section.append(pre);
    } else if (part.type === "image") {
      const fig = node("figure", "image-slot");
      await renderImage(fig, part.value, "첨부 이미지", archive);
      section.append(fig);
    } else section.append(unsupported(part.value));
  }
  const content = message.content;
  if (
    content &&
    ["text", "multimodal_text"].includes(content.content_type) &&
    Array.isArray(content.parts)
  ) {
    const extras = Object.fromEntries(
      Object.entries(content).filter(
        ([k]) => !["content_type", "parts"].includes(k),
      ),
    );
    if (Object.keys(extras).length)
      section.append(unsupported(extras, "추가 콘텐츠 필드 · 원문 데이터"));
  }
  const metadata = message.metadata || {};
  for (const key of [
    "attachments",
    "citations",
    "content_references",
    "search_result_groups",
  ])
    if (
      metadata[key] &&
      (!Array.isArray(metadata[key]) || metadata[key].length)
    )
      section.append(
        unsupported({ [key]: metadata[key] }, "첨부·참조 자료 · 원문 데이터"),
      );
  return section;
}
export function fitMath(container) {
  for (const wrapper of container.querySelectorAll(".math-source")) {
    wrapper.style.removeProperty("height");
    const k = wrapper.querySelector(".katex");
    if (!k) continue;
    k.style.removeProperty("font-size");
    const width =
      wrapper.closest(".markdown")?.clientWidth || container.clientWidth;
    const natural = k.getBoundingClientRect().width;
    if (natural > width - 12)
      k.style.fontSize = `${Math.max(0.001, (width - 12) / natural) * 1.21}em`;
  }
}
