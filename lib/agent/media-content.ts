/**
 * The ONE media interpretation path (04-RESEARCH.md Open Question 3). The
 * WhatsApp pipeline calls this after `downloadMedia` (lib/whatsapp/media.ts);
 * any future direct-upload channel (web chat) calls it with the bytes it
 * already has. Do not build a second image/audio pipeline — both channels
 * must read the same way through the model.
 *
 * LD-07: only the current turn's media becomes model-visible content this
 * way. A transcript gets written back into the inbound message's
 * `text_body` (plan 04-07) so later turns read it as plain text; historical
 * images render as the placeholder string below (plan 04-04's
 * `toAnthropicMessages`), never re-downloaded.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { transcribeAudio } from "../voice/transcribe";

export type InterpretedMedia =
  | { kind: "text"; text: string }
  | { kind: "image"; block: Anthropic.Messages.ImageBlockParam; altText: string };

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;
type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

function isImageMimeType(mimeType: string): mimeType is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** Same placeholder string lib/agent/to-anthropic-messages.ts uses for
 * historical images, so a live image and its later history entry read
 * consistently to the model. */
export const IMAGE_PLACEHOLDER_TEXT = "[imagen enviada por el usuario]";

export async function interpretMedia(media: { buffer: Buffer; mimeType: string }): Promise<InterpretedMedia> {
  const { buffer, mimeType } = media;

  if (mimeType.startsWith("audio/")) {
    const result = await transcribeAudio(buffer, mimeType);
    if (result.transcript) {
      return { kind: "text", text: result.transcript };
    }
    return { kind: "text", text: "[nota de voz recibida, no se pudo transcribir]" };
  }

  if (isImageMimeType(mimeType)) {
    return {
      kind: "image",
      block: {
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data: buffer.toString("base64"),
        },
      },
      altText: IMAGE_PLACEHOLDER_TEXT,
    };
  }

  return { kind: "text", text: "[archivo no soportado]" };
}
