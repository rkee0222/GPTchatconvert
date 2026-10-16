export function parseExport(value) {
  const data = Array.isArray(value)
    ? value
    : value && Array.isArray(value.conversations)
      ? value.conversations
      : null;
  if (!data)
    throw new Error(
      "지원하는 형식이 아닙니다. conversations.json의 최상위는 대화 배열 또는 { conversations: [...] }이어야 합니다. ChatGPT 데이터 내보내기 ZIP인지 확인해 주세요.",
    );
  if (!data.length)
    throw new Error(
      "conversations.json에 대화가 없습니다. 다른 내보내기 파일을 선택해 주세요.",
    );
  return data.map((c, index) => {
    if (
      !c ||
      typeof c !== "object" ||
      !c.mapping ||
      Array.isArray(c.mapping) ||
      typeof c.mapping !== "object"
    )
      throw new Error(
        `${index + 1}번째 대화에 mapping이 없습니다. 지원하지 않는 내보내기 구조입니다. 파일을 임의로 변환하지 말고 ChatGPT에서 다시 내보내 주세요.`,
      );
    return {
      ...c,
      title:
        typeof c.title === "string" && c.title.trim()
          ? c.title
          : "제목 없는 대화",
      key: String(index),
    };
  });
}
export function getBranches(conversation) {
  const mapping = conversation.mapping;
  const ids = Object.keys(mapping);
  if (!ids.length) return { options: [], selected: null, reason: "empty" };
  const parents = new Set(
    ids
      .map((id) => mapping[id]?.parent)
      .filter((p) => typeof p === "string" && mapping[p]),
  );
  const leaves = ids.filter((id) => !parents.has(id));
  const current =
    typeof conversation.current_node === "string" &&
    Object.hasOwn(mapping, conversation.current_node) &&
    mapping[conversation.current_node];
  const options = [
    ...new Set([...(current ? [conversation.current_node] : []), ...leaves]),
  ];
  if (!options.length)
    throw new Error(
      "대화 경로가 순환하거나 손상되었습니다. 원본 내보내기 파일을 다시 확인해 주세요.",
    );
  return {
    options,
    selected: current
      ? conversation.current_node
      : options.length === 1
        ? options[0]
        : null,
    reason: current ? "current" : options.length === 1 ? "single" : "choose",
  };
}
export function getPath(conversation, leaf) {
  const messages = [],
    visited = new Set();
  let id = leaf;
  while (id != null) {
    if (visited.has(id))
      throw new Error(
        "순환하는 대화 경로입니다. 다른 경로를 선택하거나 파일을 다시 내보내 주세요.",
      );
    visited.add(id);
    const node = Object.hasOwn(conversation.mapping, id)
      ? conversation.mapping[id]
      : null;
    if (!node || typeof node !== "object")
      throw new Error(
        "부모 메시지를 찾을 수 없어 대화 경로를 복원할 수 없습니다. 원본 파일을 확인해 주세요.",
      );
    if (node.message != null) messages.push(node.message);
    id = node.parent;
  }
  return messages.reverse();
}
export function branchLabel(c, id, index) {
  const node = c.mapping[id],
    m = node?.message;
  const parts = m?.content?.parts;
  const preview = Array.isArray(parts)
    ? parts
        .filter((x) => typeof x === "string")
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 65)
    : "";
  return `경로 ${index + 1}${id === c.current_node ? " · 현재 선택된 경로" : ""} — ${preview || id}`;
}
export function messageParts(message) {
  const c = message?.content;
  if (!c || typeof c !== "object")
    return [{ type: "unsupported", value: message }];
  if (
    ["text", "multimodal_text"].includes(c.content_type) &&
    Array.isArray(c.parts)
  ) {
    return c.parts.map((part) => {
      if (typeof part === "string") return { type: "markdown", value: part };
      if (
        part?.content_type === "image_asset_pointer" &&
        typeof part.asset_pointer === "string"
      )
        return { type: "image", value: part.asset_pointer, original: part };
      return { type: "unsupported", value: part };
    });
  }
  if (c.content_type === "code" && typeof c.text === "string")
    return [{ type: "code", value: c.text, language: c.language }];
  if (
    ["execution_output", "system_error"].includes(c.content_type) &&
    typeof c.text === "string"
  )
    return [{ type: "code", value: c.text }];
  return [{ type: "unsupported", value: c }];
}
export function assetCandidates(pointer, filenames) {
  let path = String(pointer);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Keep the original path for diagnostics. */
  }
  path = path
    .replace(/^sandbox:\/mnt\/data\//, "")
    .replace(/^(?:file-service|sediment|attachment):\/\//, "")
    .replace(/^\.\//, "");
  if (
    /^(?:https?:|data:|javascript:|\/)/i.test(path) ||
    path.split("/").includes("..")
  )
    return [];
  const exact = filenames.filter(
    (name) => name === path || name.endsWith("/" + path),
  );
  if (exact.length) return exact;
  const base = path.split("/").pop();
  return filenames.filter((name) => {
    const n = name.split("/").pop();
    return (
      n === base ||
      (/^file[-_]/.test(base) &&
        (n.startsWith(base + "-") || n.startsWith(base + ".")))
    );
  });
}
