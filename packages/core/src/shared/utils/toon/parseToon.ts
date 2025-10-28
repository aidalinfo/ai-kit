import { DELIMITERS, type Delimiter } from "@byjohann/toon";

type JsonValue = unknown;

const INDENT_WIDTH = 2;
const DEFAULT_DELIMITER = DELIMITERS.comma;

interface ParsedLine {
  readonly text: string;
  readonly indent: number;
  readonly content: string;
  readonly lineNumber: number;
}

class LineReader {
  private readonly lines: ParsedLine[];
  private index = 0;

  constructor(lines: string[]) {
    this.lines = lines.map((line, idx) => {
      const normalized = line.replace(/\r$/, "").replace(/\s+$/, "");
      const leadingSpaces = countLeadingSpaces(normalized);

      if (leadingSpaces % INDENT_WIDTH !== 0) {
        throw new Error(`Invalid indentation on line ${idx + 1}.`);
      }

      const indent = leadingSpaces / INDENT_WIDTH;

      return {
        text: normalized,
        indent,
        content: normalized.slice(leadingSpaces),
        lineNumber: idx + 1,
      } satisfies ParsedLine;
    });
  }

  peek(skipEmpty = false): ParsedLine | undefined {
    let cursor = this.index;
    while (cursor < this.lines.length) {
      const line = this.lines[cursor];
      if (skipEmpty && line.content === "") {
        cursor += 1;
        continue;
      }
      return line;
    }
    return undefined;
  }

  next(skipEmpty = false): ParsedLine | undefined {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      this.index += 1;
      if (skipEmpty && line.content === "") {
        continue;
      }
      return line;
    }
    return undefined;
  }

  skipEmptyLines() {
    while (this.index < this.lines.length) {
      if (this.lines[this.index].content !== "") {
        break;
      }
      this.index += 1;
    }
  }
}

export function parseToon<T = unknown>(source: string): T {
  if (typeof source !== "string") {
    throw new TypeError("Toon content must be a string.");
  }

  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const reader = new LineReader(lines);

  reader.skipEmptyLines();
  const value = parseDocument(reader);
  reader.skipEmptyLines();

  const leftover = reader.peek(true);
  if (leftover) {
    throw new Error(
      `Unexpected content after end of document on line ${leftover.lineNumber}.`,
    );
  }

  return value as T;
}

function parseDocument(reader: LineReader): JsonValue {
  const first = reader.peek(true);
  if (!first) {
    return {};
  }

  if (first.content.startsWith("[")) {
    const headerLine = reader.next(true)!;
    return parseArrayFromHeader(reader, first.indent, headerLine.content);
  }

  if (first.content.startsWith("-")) {
    return parseImplicitList(reader, first.indent);
  }

  if (!hasUnescapedColon(first.content)) {
    reader.next(true);
    return parsePrimitiveToken(first.content);
  }

  return parseObject(reader, first.indent);
}

function parseObject(reader: LineReader, indent: number): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};

  while (true) {
    const peeked = reader.peek(true);
    if (!peeked) {
      break;
    }

    if (peeked.indent < indent) {
      break;
    }

    if (peeked.indent > indent) {
      throw new Error(`Unexpected indentation on line ${peeked.lineNumber}.`);
    }

    if (peeked.content === "") {
      reader.next(true);
      continue;
    }

    const line = reader.next(true)!;
    const { key, remainder } = parseKeyToken(line.content);

    if (key === undefined) {
      throw new Error(`Missing key on line ${line.lineNumber}.`);
    }

    if (remainder.startsWith("[")) {
      result[key] = parseArrayFromHeader(reader, indent, remainder);
      continue;
    }

    if (!remainder.startsWith(":")) {
      throw new Error(`Expected ':' after key on line ${line.lineNumber}.`);
    }

    const valuePart = remainder.slice(1).trim();

    if (valuePart !== "") {
      result[key] = parsePrimitiveToken(valuePart);
      continue;
    }

    const nextLine = reader.peek(true);
    if (!nextLine || nextLine.indent <= indent) {
      result[key] = {};
      continue;
    }

    result[key] = parseObject(reader, indent + 1);
  }

  return result;
}

function parseArrayFromHeader(
  reader: LineReader,
  indent: number,
  header: string,
): JsonValue {
  const { delimiter, fields, inlineValues } = parseArrayHeader(header);

  if (inlineValues !== undefined) {
    return inlineValues;
  }

  if (fields) {
    return parseTabularArray(reader, indent + 1, fields, delimiter);
  }

  return parseListArray(reader, indent + 1, delimiter);
}

function parseArrayHeader(header: string) {
  if (!header.startsWith("[")) {
    throw new Error("Array header must start with '['.");
  }

  const closingBracket = header.indexOf("]");
  if (closingBracket === -1) {
    throw new Error("Unterminated array header.");
  }

  let inside = header.slice(1, closingBracket);
  let delimiter: Delimiter = DEFAULT_DELIMITER;

  if (inside.endsWith(DELIMITERS.pipe)) {
    delimiter = DELIMITERS.pipe;
    inside = inside.slice(0, -1);
  } else if (inside.endsWith(DELIMITERS.tab)) {
    delimiter = DELIMITERS.tab;
    inside = inside.slice(0, -1);
  } else if (inside.endsWith(DELIMITERS.comma)) {
    delimiter = DELIMITERS.comma;
    inside = inside.slice(0, -1);
  }

  if (inside.startsWith("#")) {
    inside = inside.slice(1);
  }

  const lengthPart = inside.trim();
  if (lengthPart && !/^\d+$/.test(lengthPart)) {
    throw new Error("Invalid array length marker.");
  }

  let rest = header.slice(closingBracket + 1).trimStart();
  let fields: string[] | undefined;

  if (rest.startsWith("{")) {
    const closingBrace = rest.indexOf("}");
    if (closingBrace === -1) {
      throw new Error("Unterminated array field list.");
    }

    const fieldContent = rest.slice(1, closingBrace);
    const fieldTokens =
      fieldContent.length > 0 ? splitTokens(fieldContent, delimiter) : [];
    fields = fieldTokens.map((token) => parseFieldToken(token));
    rest = rest.slice(closingBrace + 1).trimStart();
  }

  if (!rest.startsWith(":")) {
    throw new Error("Array header must end with a colon.");
  }

  const inlinePart = rest.slice(1).trim();

  if (inlinePart.length === 0) {
    return { delimiter, fields, inlineValues: undefined as JsonValue[] | undefined };
  }

  const tokens = splitTokens(inlinePart, delimiter);
  const inlineValues = tokens.map((token) => parsePrimitiveToken(token));

  return { delimiter, fields, inlineValues };
}

function parseTabularArray(
  reader: LineReader,
  indent: number,
  fields: string[],
  delimiter: Delimiter,
): JsonValue {
  const rows: Record<string, JsonValue>[] = [];

  while (true) {
    const peeked = reader.peek(true);
    if (!peeked) {
      break;
    }

    if (peeked.indent < indent) {
      break;
    }

    if (peeked.indent > indent) {
      throw new Error(`Unexpected indentation on line ${peeked.lineNumber}.`);
    }

    if (peeked.content === "") {
      reader.next(true);
      continue;
    }

    const line = reader.next(true)!;
    const tokens = splitTokens(line.content, delimiter);

    if (tokens.length !== fields.length) {
      throw new Error(
        `Unexpected number of columns on line ${line.lineNumber}: expected ${fields.length}, received ${tokens.length}.`,
      );
    }

    const entry: Record<string, JsonValue> = {};
    for (let index = 0; index < fields.length; index += 1) {
      entry[fields[index]] = parsePrimitiveToken(tokens[index]);
    }

    rows.push(entry);
  }

  return rows;
}

function parseListArray(
  reader: LineReader,
  indent: number,
  delimiter: Delimiter,
): JsonValue {
  const items: JsonValue[] = [];

  while (true) {
    const peeked = reader.peek(true);
    if (!peeked) {
      break;
    }

    if (peeked.indent < indent) {
      break;
    }

    if (peeked.content === "") {
      reader.next(true);
      continue;
    }

    if (!peeked.content.startsWith("-")) {
      throw new Error(`Expected list item on line ${peeked.lineNumber}.`);
    }

    const line = reader.next(true)!;
    items.push(parseListItem(reader, indent, delimiter, line));
  }

  return items;
}

function parseListItem(
  reader: LineReader,
  indent: number,
  delimiter: Delimiter,
  line: ParsedLine,
): JsonValue {
  let content = line.content.slice(1);
  if (content.startsWith(" ")) {
    content = content.slice(1);
  }
  content = content.trim();

  if (content === "") {
    return {};
  }

  if (content.startsWith("[")) {
    const { delimiter: innerDelimiter, fields, inlineValues } =
      parseArrayHeader(content);

    if (inlineValues !== undefined) {
      return inlineValues;
    }

    if (fields) {
      return parseTabularArray(reader, indent + 1, fields, innerDelimiter);
    }

    return parseListArray(reader, indent + 1, innerDelimiter);
  }

  if (isKeyValueStart(content)) {
    const collected: string[] = [createLineFromContent(content, indent)];

    while (true) {
      const peeked = reader.peek(false);
      if (!peeked) {
        break;
      }

      if (peeked.content === "") {
        reader.next(false);
        continue;
      }

      if (peeked.indent <= indent) {
        break;
      }

      collected.push(reader.next(false)!.text);
    }

    const baseIndentSpaces = indent * INDENT_WIDTH;
    const normalized = collected.map((lineText, lineIndex) => {
      const removal =
        lineIndex === 0
          ? baseIndentSpaces
          : baseIndentSpaces + INDENT_WIDTH;
      return removeLeadingSpaces(lineText, removal);
    });

    const subReader = new LineReader(normalized);
    subReader.skipEmptyLines();
    const value = parseObject(subReader, 0);
    subReader.skipEmptyLines();

    if (subReader.peek()) {
      throw new Error("Unexpected trailing content within list item object.");
    }

    return value;
  }

  return parsePrimitiveToken(content);
}

function parseImplicitList(reader: LineReader, indent: number): JsonValue {
  const items: JsonValue[] = [];

  while (true) {
    const peeked = reader.peek(true);
    if (!peeked) {
      break;
    }

    if (peeked.indent !== indent || !peeked.content.startsWith("-")) {
      break;
    }

    const line = reader.next(true)!;
    items.push(parseListItem(reader, indent, DEFAULT_DELIMITER, line));
  }

  return items;
}

function parsePrimitiveToken(token: string): JsonValue {
  const trimmed = token.trim();

  if (trimmed === "") {
    return "";
  }

  if (trimmed === "null") {
    return null;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return parseQuotedString(trimmed);
  }

  if (isNumberLiteral(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}

function parseQuotedString(token: string): string {
  let result = "";

  for (let index = 1; index < token.length - 1; index += 1) {
    const char = token[index];
    if (char === "\\") {
      index += 1;
      const next = token[index];
      if (next === undefined) {
        throw new Error("Invalid escape sequence in quoted string.");
      }
      result += unescapeCharacter(next);
      continue;
    }

    result += char;
  }

  return result;
}

function unescapeCharacter(char: string) {
  switch (char) {
    case "\\":
      return "\\";
    case "\"":
      return "\"";
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      return char;
  }
}

function parseKeyToken(content: string): { key?: string; remainder: string } {
  if (content.startsWith("[")) {
    return { key: undefined, remainder: content };
  }

  if (content.startsWith("\"")) {
    const { segment, endIndex } = readQuotedSegment(content, 0);
    const key = parseQuotedString(segment);
    const remainder = content.slice(endIndex).trimStart();
    return { key, remainder };
  }

  const terminatorIndex = findKeyTerminator(content);
  if (terminatorIndex === -1) {
    throw new Error("Key must be followed by ':' or '[' in TOON content.");
  }

  const key = content.slice(0, terminatorIndex).trim();
  const remainder = content.slice(terminatorIndex);

  if (!key) {
    throw new Error("Object key cannot be empty.");
  }

  return { key, remainder };
}

function readQuotedSegment(text: string, start: number) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\"" && !isEscaped(text, index)) {
      return { segment: text.slice(start, index + 1), endIndex: index + 1 };
    }
    index += 1;
  }
  throw new Error("Unterminated quoted string.");
}

function findKeyTerminator(content: string) {
  let index = 0;
  while (index < content.length) {
    const char = content[index];
    if (char === ":" || char === "[") {
      return index;
    }
    index += 1;
  }
  return -1;
}

function isNumberLiteral(token: string) {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(token);
}

function splitTokens(text: string, delimiter: Delimiter): string[] {
  if (text === "") {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === "\"" && !isEscaped(text, index)) {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      tokens.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  tokens.push(current.trim());
  return tokens;
}

function parseFieldToken(token: string): string {
  const value = parsePrimitiveToken(token);
  if (typeof value === "string") {
    return value;
  }
  return String(value ?? "");
}

function createLineFromContent(content: string, indent: number) {
  return `${" ".repeat(indent * INDENT_WIDTH)}${content}`;
}

function isKeyValueStart(text: string): boolean {
  const colonIndex = findCharOutsideQuotes(text, ":");
  if (colonIndex === -1) {
    return false;
  }

  const remainder = text.slice(colonIndex + 1);
  if (remainder === "") {
    return true;
  }

  const first = remainder[0];
  return first === " " || first === "\"" || first === "[" || first === "-";
}

function hasUnescapedColon(text: string): boolean {
  return findCharOutsideQuotes(text, ":") !== -1;
}

function findCharOutsideQuotes(text: string, target: string): number {
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\"" && !isEscaped(text, index)) {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === target) {
      return index;
    }
  }
  return -1;
}

function isEscaped(text: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (text[cursor] !== "\\") {
      break;
    }
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function countLeadingSpaces(value: string) {
  let count = 0;
  while (count < value.length && value[count] === " ") {
    count += 1;
  }
  return count;
}

function removeLeadingSpaces(value: string, count: number) {
  if (count <= 0) {
    return value;
  }

  let index = 0;
  let removed = 0;

  while (index < value.length && removed < count && value[index] === " ") {
    index += 1;
    removed += 1;
  }

  return value.slice(index);
}
