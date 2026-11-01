/**
 * Normalize a file's line endings to `\n` before comparing its content.
 *
 * Git for Windows checks text files out with CRLF by default, so a fixture that appends a `\n`
 * line (a check script, an agent writing a file) produces mixed endings even though the content
 * is exactly what the test wrote. The property under test is the content, not the checkout.
 */
export function lf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}
