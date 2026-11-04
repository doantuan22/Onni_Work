import { StringDecoder } from 'node:string_decoder';

/**
 * Turn the byte chunks of ONE stream into text without splitting a multi-byte character that
 * straddles two chunks into two U+FFFD (`chunk.toString('utf8')` per chunk does exactly that).
 * One collector per stream: stdout and stderr each carry their own half-character.
 */
export function utf8Collector(onText: (text: string) => void): { write: (chunk: Buffer | string) => void; end: () => void } {
  const decoder = new StringDecoder('utf8');
  return {
    write: (chunk) => {
      const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
      if (text) onText(text);
    },
    end: () => {
      const rest = decoder.end();
      if (rest) onText(rest);
    },
  };
}
