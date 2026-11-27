const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const ANSI_OSC_RE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');
const ACTIONS_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/;
const ACTIONS_GROUP_RE = /^##\[group\](.+)$/;
const ACTIONS_ERROR_RE = /^##\[error\](.*)$/;

const ALLOWED_LOG_REDIRECT_HOST_SUFFIXES = [
  '.githubusercontent.com',
  '.github.com',
  '.blob.core.windows.net',
  '.vsassets.io',
];

export const MAX_LOG_STREAM_BYTES = 8 * 1024 * 1024;
export const MAX_LOG_TAIL_BYTES = 256 * 1024;
const DEFAULT_MAX_EXCERPT_LINES = 80;
const ERROR_CONTEXT_BEFORE = 10;
const ERROR_CONTEXT_AFTER = 12;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_OSC_RE, '').replace(ANSI_CSI_RE, '');
}

export function isSafeLogRedirectUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'github.com' ||
      ALLOWED_LOG_REDIRECT_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

export interface ExtractedLogExcerpt {
  failedStep: string | null;
  excerpt: string;
  truncated: boolean;
}

export function extractLogExcerpt(
  rawLog: string,
  options: { maxLines?: number; inputWasTruncated?: boolean } = {},
): ExtractedLogExcerpt {
  const maxLines = options.maxLines ?? DEFAULT_MAX_EXCERPT_LINES;
  const cleaned = stripAnsi(rawLog).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = cleaned.split('\n');
  const lines: string[] = [];

  let currentGroup: string | null = null;
  let failedStep: string | null = null;
  const errorIndices: number[] = [];

  for (const rawLine of rawLines) {
    const line = rawLine.replace(ACTIONS_TIMESTAMP_RE, '');
    const groupMatch = ACTIONS_GROUP_RE.exec(line);
    if (groupMatch?.[1]) {
      currentGroup = groupMatch[1].trim();
    }
    const trimmedEnd = line.trimEnd();
    if (trimmedEnd.length === 0 && lines.length === 0) {
      continue;
    }
    const idx = lines.length;
    lines.push(trimmedEnd);

    if (ACTIONS_ERROR_RE.test(trimmedEnd)) {
      errorIndices.push(idx);
      if (currentGroup) {
        failedStep = currentGroup;
      }
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  if (lines.length === 0) {
    return {
      failedStep,
      excerpt: '',
      truncated: Boolean(options.inputWasTruncated),
    };
  }

  if (lines.length <= maxLines) {
    return {
      failedStep,
      excerpt: lines.join('\n'),
      truncated: Boolean(options.inputWasTruncated),
    };
  }

  if (errorIndices.length > 0) {
    const lastErrorIdx = errorIndices[errorIndices.length - 1]!;
    const firstRelevantIdx = errorIndices[0]!;
    const spanStart = Math.max(0, firstRelevantIdx - ERROR_CONTEXT_BEFORE);
    const spanEnd = Math.min(lines.length, lastErrorIdx + ERROR_CONTEXT_AFTER + 1);

    if (spanEnd - spanStart <= maxLines) {
      return {
        failedStep,
        excerpt: lines.slice(spanStart, spanEnd).join('\n'),
        truncated: true,
      };
    }

    const tailStart = Math.max(0, lastErrorIdx - (maxLines - ERROR_CONTEXT_AFTER - 1));
    const tailEnd = Math.min(lines.length, tailStart + maxLines);
    return {
      failedStep,
      excerpt: lines.slice(tailStart, tailEnd).join('\n'),
      truncated: true,
    };
  }

  return {
    failedStep,
    excerpt: lines.slice(-maxLines).join('\n'),
    truncated: true,
  };
}

export async function readBoundedLogTail(
  response: Response,
  options: { maxStreamBytes?: number; maxTailBytes?: number } = {},
): Promise<{ text: string; truncated: boolean }> {
  const maxStreamBytes = options.maxStreamBytes ?? MAX_LOG_STREAM_BYTES;
  const maxTailBytes = options.maxTailBytes ?? MAX_LOG_TAIL_BYTES;

  if (!response.body) {
    const full = await response.text();
    const bytes = new TextEncoder().encode(full);
    if (bytes.byteLength <= maxTailBytes) {
      return { text: full, truncated: false };
    }
    const sliced = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(-maxTailBytes));
    return { text: sliced, truncated: true };
  }

  const reader = response.body.getReader();
  const tailChunks: Uint8Array[] = [];
  let tailBytes = 0;
  let totalReadBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }

      let chunk = value;
      const remainingStream = maxStreamBytes - totalReadBytes;
      if (chunk.byteLength >= remainingStream) {
        chunk = chunk.subarray(0, remainingStream);
        totalReadBytes += chunk.byteLength;
        truncated = true;
      } else {
        totalReadBytes += chunk.byteLength;
      }

      if (chunk.byteLength >= maxTailBytes) {
        tailChunks.length = 0;
        tailChunks.push(chunk.subarray(-maxTailBytes));
        tailBytes = maxTailBytes;
        truncated = true;
      } else {
        tailChunks.push(chunk);
        tailBytes += chunk.byteLength;
        while (tailBytes > maxTailBytes && tailChunks.length > 0) {
          const overflow = tailBytes - maxTailBytes;
          const oldest = tailChunks[0]!;
          if (oldest.byteLength <= overflow) {
            tailChunks.shift();
            tailBytes -= oldest.byteLength;
          } else {
            tailChunks[0] = oldest.subarray(overflow);
            tailBytes -= overflow;
          }
          truncated = true;
        }
      }

      if (totalReadBytes >= maxStreamBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(tailBytes);
  let offset = 0;
  for (const chunk of tailChunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text = new TextDecoder('utf-8', { fatal: false }).decode(combined);
  if (truncated) {
    // Drop a potentially mid-line partial first line after tail slicing.
    const firstNewline = text.indexOf('\n');
    if (firstNewline >= 0 && firstNewline < text.length - 1) {
      text = text.slice(firstNewline + 1);
    }
  }

  return { text, truncated };
}
