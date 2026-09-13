/**
 * Deepgram Nova-3 transcription of a WhatsApp voice note (WA-05, LD-10).
 *
 * LD-10: Deepgram is the primary and only coded transcriber this phase —
 * Whisper as a second provider is scope this phase does not need. If
 * `DEEPGRAM_API_KEY` is unset, or Deepgram itself fails, this function
 * degrades to `{ transcript: null, reason }` instead of throwing: a
 * degraded turn (T-04-25) is better than a lost one. The reason string is
 * always safe to log — it is either a static message this module writes or
 * Deepgram's own error text, NEVER the API key.
 *
 * No guard against non-server import: scripts/verify-agent-media.ts imports
 * this module under plain `tsx`. The module is still unusable in a browser
 * — it reads a secret from process.env.
 *
 * @deepgram/sdk v5's real call shape (confirmed against
 * node_modules/@deepgram/sdk/dist/cjs/**\/*.d.ts, NOT the
 * `listen.prerecorded.transcribeFile` shape 04-RESEARCH.md guessed at):
 *   new DeepgramClient({ apiKey })
 *     .listen.v1.media.transcribeFile({ data: buffer, contentType: mimeType }, { model, language, smart_format })
 *   -> { results: { channels: [{ alternatives: [{ transcript }] }] } }
 * `MediaTranscribeRequestOctetStream` (the second argument) has no
 * `mimetype` field — the content type is carried on the uploadable itself
 * via `{ data, contentType }`, not in the request body.
 */
import { DeepgramClient } from "@deepgram/sdk";

export type TranscribeAudioResult = { transcript: string } | { transcript: null; reason: string };

let hasWarnedMissingKey = false;

export async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<TranscribeAudioResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    if (!hasWarnedMissingKey) {
      console.warn("[lib/voice/transcribe.ts] DEEPGRAM_API_KEY is not set — voice notes will not be transcribed.");
      hasWarnedMissingKey = true;
    }
    return { transcript: null, reason: "DEEPGRAM_API_KEY is not set" };
  }

  const client = new DeepgramClient({ apiKey });

  try {
    const response = await client.listen.v1.media.transcribeFile(
      { data: buffer, contentType: mimeType },
      { model: "nova-3", language: "es", smart_format: true },
    );

    if (!("results" in response)) {
      // ListenV1AcceptedResponse — an async/callback response shape, not
      // applicable to this synchronous call pattern.
      return { transcript: null, reason: "Deepgram returned an accepted (async) response, not a transcript" };
    }

    const transcript = response.results.channels[0]?.alternatives?.[0]?.transcript;
    if (!transcript || transcript.trim().length === 0) {
      return { transcript: null, reason: "empty transcript" };
    }

    return { transcript };
  } catch (err) {
    // Deepgram's own error message only — never anything from `apiKey`,
    // which is passed as a header and never appears in an error message.
    const reason = err instanceof Error ? err.message : String(err);
    return { transcript: null, reason };
  }
}
