// Deliberate demo bug: splitting every delimiter discards the rest of the value.
// The envelope contract preserves the complete content after the first colon.
export function decodeMessage(message) {
  return message.split(':')[1];
}
