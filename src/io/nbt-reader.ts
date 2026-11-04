export type NbtTag = {
  type: number;
  value: number | bigint | string | NbtTag[] | Record<string, NbtTag>;
  element?: number;
};
export const NBT_MAX_BYTES = 32 * 1024 ** 2;

/** Java big-endian named NBT. Long values never pass through Number. */
export function readNbt(bytes: Uint8Array): NbtTag {
  if (bytes.byteLength > NBT_MAX_BYTES)
    throw new Error("NBT exceeds 32 MiB decompressed limit");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0,
    nodes = 0;
  const need = (count: number) => {
    if (count < 0 || count > bytes.length - cursor)
      throw new Error("Truncated NBT input");
  };
  const u8 = () => {
    need(1);
    return view.getUint8(cursor++);
  };
  const i32 = () => {
    need(4);
    const value = view.getInt32(cursor);
    cursor += 4;
    return value;
  };
  const text = () => {
    need(2);
    const length = view.getUint16(cursor);
    cursor += 2;
    need(length);
    const end = cursor + length,
      units: number[] = [];
    while (cursor < end) {
      const a = u8();
      if (a < 128) {
        units.push(a);
        continue;
      }
      const continuation = () => {
        if (cursor >= end) throw new Error("Truncated NBT string");
        const b = u8();
        if ((b & 192) !== 128) throw new Error("Invalid NBT string");
        return b & 63;
      };
      if ((a & 224) === 192) {
        const b = continuation(),
          code = ((a & 31) << 6) | b;
        if (code < 128 && !(a === 192 && b === 0))
          throw new Error("Invalid NBT string");
        units.push(code);
      } else if ((a & 240) === 224) {
        const code = ((a & 15) << 12) | (continuation() << 6) | continuation();
        if (code < 2048) throw new Error("Invalid NBT string");
        units.push(code);
      } else if ((a & 248) === 240) {
        const code =
          ((a & 7) << 18) |
          (continuation() << 12) |
          (continuation() << 6) |
          continuation();
        if (code < 65536 || code > 0x10ffff)
          throw new Error("Invalid NBT string");
        units.push(
          0xd800 + ((code - 65536) >> 10),
          0xdc00 + ((code - 65536) & 1023),
        );
      } else throw new Error("Invalid NBT string");
    }
    let result = "";
    for (let offset = 0; offset < units.length; offset += 8192)
      result += String.fromCharCode(...units.slice(offset, offset + 8192));
    return result;
  };
  const length = () => {
    const count = i32();
    if (count < 0 || count > 1000000)
      throw new Error("NBT collection length exceeds limits");
    return count;
  };
  function payload(type: number, depth: number): NbtTag {
    if (++nodes > 2000000 || depth > 64)
      throw new Error("NBT exceeds depth/work limits");
    if (type < 1 || type > 12) throw new Error(`Unsupported NBT tag ${type}`);
    let value: NbtTag["value"];
    switch (type) {
      case 1:
        need(1);
        value = view.getInt8(cursor++);
        break;
      case 2:
        need(2);
        value = view.getInt16(cursor);
        cursor += 2;
        break;
      case 3:
        value = i32();
        break;
      case 4:
        need(8);
        value = view.getBigInt64(cursor);
        cursor += 8;
        break;
      case 5:
        need(4);
        value = view.getFloat32(cursor);
        cursor += 4;
        break;
      case 6:
        need(8);
        value = view.getFloat64(cursor);
        cursor += 8;
        break;
      case 8:
        value = text();
        break;
      case 10: {
        const fields: Record<string, NbtTag> = Object.create(null);
        for (let child = u8(); child !== 0; child = u8()) {
          const name = text();
          if (Object.hasOwn(fields, name))
            throw new Error(`Duplicate NBT field: ${name}`);
          fields[name] = payload(child, depth + 1);
        }
        value = fields;
        break;
      }
      default: {
        const element =
            type === 9 ? u8() : type === 7 ? 1 : type === 11 ? 3 : 4,
          count = length();
        if (element === 0 && count !== 0)
          throw new Error("Nonempty TAG_End list");
        if (element > 12) throw new Error("Invalid NBT list tag");
        const minimum = [0, 1, 2, 4, 8, 4, 8, 4, 2, 5, 1, 4, 4][element];
        need(count * minimum);
        const items: NbtTag[] = [];
        for (let i = 0; i < count; i++) items.push(payload(element, depth + 1));
        return { type, value: items, element };
      }
    }
    return { type, value };
  }
  if (u8() !== 10)
    throw new Error("Structure NBT requires a named root compound");
  text();
  const root = payload(10, 0);
  if (cursor !== bytes.length) throw new Error("Trailing bytes after NBT root");
  return root;
}
export async function decodeNbtFile(input: Uint8Array): Promise<NbtTag> {
  if (input.length > 16 * 1024 ** 2)
    throw new Error("NBT file must be at most 16 MiB");
  if (input[0] !== 31 || input[1] !== 139) return readNbt(input);
  if (typeof DecompressionStream === "undefined")
    throw new Error("This browser does not support gzip decompression");
  const reader = new Blob([new Uint8Array(input).buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > NBT_MAX_BYTES)
        throw new Error("NBT exceeds 32 MiB decompressed limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return readNbt(output);
}
