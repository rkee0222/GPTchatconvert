import "./styles.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import { ExportArchive } from "./archive.js";
import { getBranches, getPath, branchLabel } from "./parser.js";
import { renderMessage, fitMath } from "./render.js";
const $ = (s) => document.querySelector(s);
const fileInput = $("#zip-file"),
  status = $("#upload-status"),
  progress = $("#progress"),
  error = $("#error"),
  doc = $("#document"),
  printButton = $("#print");
let archive = null,
  conversations = [],
  selected = null,
  generation = 0,
  rendered = false,
  listLimit = 100;
const yieldUI = () => new Promise((r) => setTimeout(r, 0));
function showError(message) {
  error.textContent = message;
  error.hidden = !message;
}
function showProgress(message, value) {
  status.textContent = message;
  progress.hidden = false;
  if (value == null) progress.removeAttribute("value");
  else progress.value = value;
}
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  generation++;
  rendered = false;
  printButton.disabled = true;
  fileInput.disabled = true;
  showError("");
  $("#reader").hidden = true;
  doc.replaceChildren();
  doc.hidden = true;
  $("#render-status").textContent = "";
  $("#empty-preview").hidden = false;
  conversations = [];
  selected = null;
  if (archive) await archive.close();
  archive = new ExportArchive(file);
  try {
    showProgress(
      file.size > 512 * 1024 * 1024
        ? "큰 ZIP 파일입니다. iPhone·iPad의 메모리가 부족하면 PC를 이용해 주세요. ZIP 목차를 읽는 중…"
        : "ZIP 목차를 읽는 중…",
    );
    conversations = await archive.load(showProgress);
    status.textContent = `${file.name} · ${conversations.length.toLocaleString("ko-KR")}개 대화`;
    $("#reader").hidden = false;
    $("#intro").hidden = true;
    $("#how-to").hidden = true;
    $("#search").value = "";
    listLimit = 100;
    updateList();
  } catch (e) {
    showError(
      e.message ||
        "파일을 읽지 못했습니다. 올바른 ZIP인지 확인한 뒤 다시 선택해 주세요.",
    );
    status.textContent = "파일을 불러오지 못했습니다.";
    await archive.close();
    archive = null;
  } finally {
    progress.hidden = true;
    fileInput.disabled = false;
    fileInput.value = "";
  }
});
function updateList() {
  const query = $("#search").value.trim().toLocaleLowerCase("ko-KR");
  const filtered = conversations.filter((c) =>
    c.title.toLocaleLowerCase("ko-KR").includes(query),
  );
  $("#conversation-count").textContent =
    conversations.length.toLocaleString("ko-KR");
  $("#search-count").textContent =
    `${filtered.length.toLocaleString("ko-KR")}개 대화${filtered.length > listLimit ? ` · ${listLimit}개 표시` : ""}`;
  const list = $("#conversation-list");
  list.replaceChildren();
  for (const c of filtered.slice(0, listLimit)) {
    const button = document.createElement("button");
    button.className = "conversation-item";
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected?.key === c.key));
    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = c.title;
    const date = document.createElement("span");
    date.className = "conversation-date";
    const d =
      typeof c.create_time === "number" ? new Date(c.create_time * 1000) : null;
    date.textContent =
      d && !isNaN(d) ? d.toLocaleDateString("ko-KR") : "날짜 정보 없음";
    button.append(title, date);
    button.addEventListener("click", () => selectConversation(c));
    list.append(button);
  }
  if (!filtered.length) {
    const p = document.createElement("p");
    p.className = "notice";
    p.textContent = "검색 결과가 없습니다. 다른 제목으로 검색해 주세요.";
    list.append(p);
  }
  $("#load-more").hidden = filtered.length <= listLimit;
}
$("#search").addEventListener("input", () => {
  listLimit = 100;
  updateList();
});
$("#load-more").addEventListener("click", () => {
  listLimit += 100;
  updateList();
});
function selectConversation(c) {
  selected = c;
  generation++;
  rendered = false;
  printButton.disabled = true;
  showError("");
  updateList();
  doc.hidden = true;
  doc.replaceChildren();
  $("#empty-preview").hidden = true;
  $("#branch-panel").hidden = true;
  try {
    const branches = getBranches(c),
      select = $("#branch");
    select.replaceChildren();
    if (!branches.options.length) {
      $("#render-status").textContent = "이 대화에는 메시지가 없습니다.";
      return;
    }
    if (!branches.selected) {
      const option = new Option("경로를 선택해 주세요", "");
      option.disabled = true;
      option.selected = true;
      select.add(option);
    }
    branches.options.forEach((id, i) =>
      select.add(new Option(branchLabel(c, id, i), id)),
    );
    $("#branch-panel").hidden = branches.options.length <= 1;
    $("#branch-help").textContent =
      branches.reason === "current"
        ? "내보내기의 current_node를 기준으로 현재 선택된 경로를 표시합니다. 다른 경로도 선택할 수 있습니다."
        : branches.reason === "choose"
          ? "현재 경로를 확인할 수 없습니다. 마지막 메시지를 보고 경로 하나를 선택해 주세요. 서로 다른 경로는 합치지 않습니다."
          : "단일 경로를 표시합니다.";
    if (branches.selected) {
      select.value = branches.selected;
      renderPath(branches.selected);
    } else
      $("#render-status").textContent =
        "여러 대화 경로가 있습니다. 표시할 경로를 선택해 주세요.";
  } catch (e) {
    $("#render-status").textContent = "";
    showError(e.message);
  }
}
$("#branch").addEventListener("change", (e) => renderPath(e.target.value));
async function renderPath(leaf) {
  const token = ++generation,
    c = selected,
    localArchive = archive;
  rendered = false;
  printButton.disabled = true;
  doc.hidden = true;
  doc.replaceChildren();
  showError("");
  try {
    const messages = getPath(c, leaf);
    if (!messages.length) {
      $("#render-status").textContent = "선택한 경로에는 메시지가 없습니다.";
      return;
    }
    const title = document.createElement("h1");
    title.className = "document-title";
    title.textContent = c.title;
    const meta = document.createElement("p");
    meta.className = "document-meta";
    meta.textContent = `ChatGPT 대화 · ${messages.length}개 메시지 · ${leaf === c.current_node ? "내보내기의 현재 경로" : "사용자가 선택한 경로"}`;
    doc.append(title, meta);
    for (let i = 0; i < messages.length; i++) {
      if (token !== generation) return;
      $("#render-status").textContent =
        `대화와 이미지를 준비하는 중… ${i + 1} / ${messages.length}`;
      const message = await renderMessage(messages[i], localArchive);
      if (token !== generation) return;
      doc.append(message);
      if (i % 8 === 0) await yieldUI();
    }
    if (token !== generation) return;
    doc.hidden = false;
    doc.getBoundingClientRect(); // Trigger font loading for the newly visible document.
    $("#render-status").textContent = "글꼴과 수식을 준비하는 중…";
    await document.fonts.ready;
    if (token !== generation) return;
    fitMath(doc);
    rendered = true;
    printButton.disabled = false;
    const missing = doc.querySelectorAll(
      ".missing-image,.unsupported,.math-error",
    ).length;
    $("#render-status").textContent = missing
      ? `미리보기 준비 완료 · 표시할 수 없는 요소 또는 원문 데이터 ${missing}개를 확인해 주세요.`
      : "미리보기 준비 완료 · 이미지·글꼴·수식 준비됨";
    document.title = `${c.title} · 대화 한 권`;
  } catch (e) {
    if (token === generation) {
      doc.hidden = true;
      $("#render-status").textContent = "";
      showError(e.message);
    }
  }
}
let previousTitle = "";
function beforePrint() {
  document.body.classList.toggle("has-document", rendered);
  if (rendered) {
    if (!previousTitle) previousTitle = document.title;
    document.title = selected.title;
    doc.querySelectorAll("details").forEach((x) => {
      if (!("wasOpen" in x.dataset)) x.dataset.wasOpen = String(x.open);
      x.open = true;
    });
    fitMath(doc);
  }
}
function afterPrint() {
  if (previousTitle) {
    document.title = previousTitle;
    previousTitle = "";
  }
  doc.querySelectorAll("details[data-was-open]").forEach((x) => {
    x.open = x.dataset.wasOpen === "true";
    delete x.dataset.wasOpen;
  });
  fitMath(doc);
}
window.addEventListener("beforeprint", beforePrint);
window.addEventListener("afterprint", afterPrint);
printButton.addEventListener("click", () => {
  if (rendered) {
    beforePrint();
    window.print();
  }
});
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => fitMath(doc), 150);
});
