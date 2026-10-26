// Preserve the complete content after the envelope's first delimiter.
export function decodeMessage(message) {
  return message.slice(message.indexOf(':')+1);
}
