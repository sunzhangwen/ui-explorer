import { randomBytes } from "node:crypto";

export type ExtractedTextFrames = {
  messages: string[];
  remaining: Buffer;
  closed: boolean;
};

export function encodeClientTextFrame(payload: string, mask = randomBytes(4)): Buffer {
  return encodeClientFrame(0x1, Buffer.from(payload, "utf8"), mask);
}

export function encodeClientCloseFrame(mask = randomBytes(4)): Buffer {
  return encodeClientFrame(0x8, Buffer.alloc(0), mask);
}

export function extractServerTextFrames(buffer: Buffer): ExtractedTextFrames {
  const messages: string[] = [];
  let offset = 0;
  let closed = false;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      if (high !== 0) {
        throw new Error("WebSocket frame is too large.");
      }
      payloadLength = low;
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;
    if (offset + frameLength > buffer.length) {
      break;
    }

    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + payloadLength));
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    if (opcode === 0x1) {
      messages.push(payload.toString("utf8"));
    } else if (opcode === 0x8) {
      closed = true;
    }

    offset += frameLength;
  }

  return {
    messages,
    remaining: buffer.subarray(offset),
    closed
  };
}

function encodeClientFrame(opcode: number, payload: Buffer, mask: Buffer): Buffer {
  if (mask.length !== 4) {
    throw new Error("WebSocket mask must be 4 bytes.");
  }

  const lengthBytes = getLengthBytes(payload.length);
  const header = Buffer.alloc(2 + lengthBytes.length + 4);
  header[0] = 0x80 | opcode;

  if (payload.length < 126) {
    header[1] = 0x80 | payload.length;
  } else if (payload.length <= 0xffff) {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payload.length, 6);
  }

  mask.copy(header, 2 + lengthBytes.length);
  const maskedPayload = Buffer.from(payload);
  for (let index = 0; index < maskedPayload.length; index += 1) {
    maskedPayload[index] ^= mask[index % 4];
  }

  return Buffer.concat([header, maskedPayload]);
}

function getLengthBytes(payloadLength: number): Buffer {
  if (payloadLength < 126) {
    return Buffer.alloc(0);
  }

  if (payloadLength <= 0xffff) {
    return Buffer.alloc(2);
  }

  return Buffer.alloc(8);
}
